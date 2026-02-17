// api_openclaw.js
const { chromium } = require('playwright');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { db } = require('./firebaseConfig');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 사용자 데이터(로그인 쿠키 등)를 저장할 폴더 경로
// 프로젝트 루트에 'user_data' 폴더가 자동으로 생성됩니다.
const USER_DATA_DIR = path.join(__dirname, 'user_data');

// 나무위키 트렌드 자동 갱신 스케줄 저장
let namuwikiScheduleJob = null;

module.exports = {
    // 1. 유튜브 제목 가져오기 (OpenClaw 스타일)
    getYoutubeTitles: async (req, res) => {
        let browserContext = null;

        try {
            // user_data 디렉토리 확인
            const userDataExists = fs.existsSync(USER_DATA_DIR);
            
            if (!userDataExists) {
                console.log('[OpenClaw] ⚠️  user_data 디렉토리가 없습니다. 새로 생성 후 로그인 대기...');
                fs.mkdirSync(USER_DATA_DIR, { recursive: true });
            }

            console.log('[OpenClaw] 브라우저 실행 중...');
            console.log('[OpenClaw] 저장된 로그인 정보:', userDataExists ? '있음' : '없음');
            
            // 1. 브라우저 실행 (로그인 정보 유지를 위해 launchPersistentContext 사용)
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: false, // 브라우저가 뜨는 것을 눈으로 확인 (로그인 위해 필수)
                viewport: { width: 1280, height: 720 },
                timeout: 300000, // 300초 타임아웃 (브라우저 실행)
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });

            console.log('[OpenClaw] 브라우저 실행 완료. persistent context 페이지 수:', browserContext.pages().length);
            
            // 2. 첫 번째 페이지 사용 (또는 새 페이지 생성)
            let page = browserContext.pages()[0];
            if (!page) {
                console.log('[OpenClaw] 새 페이지 생성 중...');
                page = await browserContext.newPage();
            }

            // 3. 유튜브 접속
            console.log('[OpenClaw] 유튜브 접속...');
            try {
                await page.goto('https://www.youtube.com', { 
                    waitUntil: 'networkidle',
                    timeout: 60000 
                });
            } catch (navError) {
                console.warn('[OpenClaw] 네비게이션 경고 (무시하고 계속):', navError.message);
                // 계속 진행
            }
            
            // 4. 로그인 상태 감지 + 대기
            console.log('[OpenClaw] 로그인 상태 확인 중...');
            
            // 첫 로그인이 필요한 경우: 로그인 페이지가 뜨면 최대 120초 대기
            if (!userDataExists) {
                console.log('[OpenClaw] 📢 첫 로그인입니다! 브라우저 창에서 Google 계정으로 로그인해주세요.');
                console.log('[OpenClaw] ⏱️  대기 시간: 최대 120초');
                
                try {
                    // 로그인 후 프로필 이미지나 로그인 버튼이 사라질 때까지 대기
                    await page.waitForTimeout(120000); // 120초 대기
                } catch (e) {
                    console.log('[OpenClaw] 대기 시간 종료');
                }
            } else {
                console.log('[OpenClaw] 저장된 세션 사용 중...');
                await page.waitForTimeout(3000); // 페이지 로드 확인용 3초
            }

            // 5. 페이지 새로고침 (로그인 후 콘텐츠 로드)
            console.log('[OpenClaw] 페이지 새로고침...');
            try {
                await page.reload({ 
                    waitUntil: 'networkidle',
                    timeout: 30000 
                });
            } catch (reloadError) {
                console.warn('[OpenClaw] 새로고침 경고 (계속 진행):', reloadError.message);
            }

            // 6. 영상 타이틀 요소 로드 대기
            console.log('[OpenClaw] 영상 제목 요소 대기 중...');
            try {
                await page.waitForSelector('#video-title', { timeout: 10000 });
                console.log('[OpenClaw] 영상 제목 요소 감지됨');
            } catch (selectorError) {
                console.warn('[OpenClaw] 영상 제목 요소를 찾을 수 없음. 계속 진행...');
            }

            // 7. 현재 화면의 텍스트 추출
            const pageContent = await page.evaluate(() => {
                // #video-title 요소들로부터 텍스트 추출
                const titles = Array.from(document.querySelectorAll('#video-title'))
                    .map(el => el.innerText.trim())
                    .filter(text => text.length > 0);
                
                console.log('[Evaluate] 추출된 타이틀 개수:', titles.length);
                return titles.join('\n');
            });

            console.log('[OpenClaw] 추출된 텍스트 길이:', pageContent.length);
            console.log('[OpenClaw] 추출된 텍스트 미리보기:', pageContent.substring(0, 200));

            // 8. 추출된 내용이 없으면 대체 방법 시도
            let finalContent = pageContent;
            if (!finalContent || finalContent.length === 0) {
                console.log('[OpenClaw] ⚠️  타이틀 추출 실패, 대체 방법 시도...');
                finalContent = await page.evaluate(() => {
                    // h3 태그로 시도
                    const h3Titles = Array.from(document.querySelectorAll('h3'))
                        .map(el => el.innerText.trim())
                        .filter(text => text.length > 0 && text.length < 200);
                    return h3Titles.join('\n');
                });
                console.log('[OpenClaw] h3 태그 추출 길이:', finalContent.length);
            }

            // 9. LLM에게 분석 요청
            console.log('[OpenClaw] AI 분석 시작...');
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "너는 웹페이지 텍스트에서 유튜브 영상 제목만 정확하게 추출하는 에이전트야. 광고나 잡다한 메뉴는 제외하고, 순수 영상 제목만 JSON 배열로 반환해. 만약 텍스트가 비어있거나 제목이 없으면 빈 배열을 반환해."
                    },
                    {
                        role: "user",
                        content: `다음은 유튜브 메인 페이지의 텍스트 데이터야. 영상 제목들을 추출해줘:\n\n${finalContent || '(텍스트 없음)'}`
                    }
                ],
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(completion.choices[0].message.content);
            console.log('[OpenClaw] 분석 완료:', result);

            res.json({
                success: true,
                count: result.titles ? result.titles.length : 0,
                titles: result.titles || [],
                debug: {
                    textLength: finalContent.length,
                    sessionLoaded: userDataExists
                }
            });

        } catch (error) {
            console.error('[OpenClaw] 에러 발생:', error.message);
            console.error('[OpenClaw] 스택:', error.stack);
            res.status(500).json({ 
                success: false, 
                error: error.message,
                hint: 'Playwright 브라우저가 정상 종료되지 않았을 수 있습니다. 수동으로 프로세스를 종료하세요.'
            });
        } finally {
            // 브라우저 종료
            if (browserContext) {
                try {
                    console.log('[OpenClaw] 브라우저 종료 중...');
                    await browserContext.close();
                    console.log('[OpenClaw] 브라우저 종료 완료');
                } catch (closeError) {
                    console.error('[OpenClaw] 브라우저 종료 중 에러:', closeError.message);
                }
            }
        }
    },

    // [신규] 나무위키 실시간 검색어 가져오기 및 Firestore 저장
    getNamuwikiTrend: async (req, res) => {
        let browserContext = null;

        try {
            console.log('[OpenClaw] 나무위키 접속 시도...');

            // 1. 브라우저 실행 (Cloudflare 우회를 위해 Headless: false 권장)
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: false, // 보안 뚫기 위해 브라우저 노출
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });

            const page = await browserContext.newPage();

            // 2. 나무위키 메인 접속
            // (타임아웃을 넉넉히 줍니다. Cloudflare 챌린지가 뜰 수 있음)
            await page.goto('https://namu.wiki/w/%EB%82%98%EB%AC%B4%EC%9C%84%ED%82%A4:%EB%8C%80%EB%AC%B8', { 
                waitUntil: 'domcontentloaded',
                timeout: 60000 
            });
            
            // 3. 로딩 대기 (Cloudflare 통과 및 데이터 로딩)
            await page.waitForTimeout(5000); 

            // 4. 텍스트 추출
            // 전체 텍스트를 가져오되, 너무 길면 토큰 비용이 드니 '실시간' 관련 키워드 주변을 자르거나
            // 혹은 그냥 body 전체 텍스트를 가져와서 LLM에게 맡깁니다.
            const pageText = await page.evaluate(() => document.body.innerText);
            
            // 텍스트 길이 최적화 (너무 길 경우 앞뒤 10000자만 보낸다거나 하는 전략 가능)
            // 여기서는 일단 단순화해서 보냅니다.
            console.log('[OpenClaw] 텍스트 추출 완료. 길이:', pageText.length);

            // 5. LLM에게 분석 요청
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // 빠르고 저렴한 모델
                messages: [
                    {
                        role: "system",
                        content: `
                        너는 웹페이지 텍스트에서 '실시간 검색어' 또는 '인기 검색어' 순위를 추출하는 에이전트야.
                        잡다한 문서 내용은 무시하고, 1위부터 10위(또는 그 이상)까지의 검색어 키워드만 뽑아서 JSON 리스트로 반환해.
                        형식: { "rankings": ["키워드1", "키워드2", ...] }
                        만약 순위를 찾을 수 없으면 빈 리스트를 반환해.
                        `
                    },
                    {
                        role: "user",
                        content: `다음 텍스트에서 실시간 검색어 순위를 찾아줘:\n\n${pageText.substring(0, 15000)}` // 텍스트가 너무 길면 앞부분에 주로 있음
                    }
                ],
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(completion.choices[0].message.content);
            console.log('[OpenClaw] 분석 결과:', result);

            // 6. Firestore에 저장
            const rankings = result.rankings || [];
            const timestamp = new Date();
            
            await db.collection('wikiTrend').doc('current').set({
                rankings: rankings,
                updatedAt: timestamp,
                source: 'namuwiki'
            });
            
            console.log('[OpenClaw] Firestore 저장 완료:', rankings.length, '개 항목');

            res.json({
                success: true,
                source: "namuwiki",
                data: rankings,
                saved: true,
                timestamp: timestamp
            });

        } catch (error) {
            console.error('[OpenClaw] 나무위키 에러:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (browserContext) await browserContext.close();
        }
    },

    // 나무위키 트렌드 자동 갱신 시작 (1시간마다)
    startNamuwikiSchedule: async () => {
        console.log('[OpenClaw] 나무위키 트렌드 자동 갱신 스케줄 시작...');

        // 기존 스케줄 제거 (중복 방지)
        if (namuwikiScheduleJob) {
            namuwikiScheduleJob.stop();
        }

        // 1시간마다 실행 (매 정시: 0분)
        namuwikiScheduleJob = cron.schedule('0 * * * *', async () => {
            console.log('[OpenClaw] 나무위키 트렌드 자동 갱신 실행:', new Date());
            
            let browserContext = null;
            try {
                browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                    headless: false,
                    viewport: { width: 1280, height: 720 },
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                });

                const page = await browserContext.newPage();

                await page.goto('https://namu.wiki/w/%EB%82%98%EB%AC%B4%EC%9C%84%ED%82%A4:%EB%8C%80%EB%AC%B8', { 
                    waitUntil: 'domcontentloaded',
                    timeout: 60000 
                });
                
                await page.waitForTimeout(5000);
                const pageText = await page.evaluate(() => document.body.innerText);
                
                console.log('[OpenClaw] 스케줄 - 텍스트 추출 완료. 길이:', pageText.length);

                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `
                            너는 웹페이지 텍스트에서 '실시간 검색어' 또는 '인기 검색어' 순위를 추출하는 에이전트야.
                            잡다한 문서 내용은 무시하고, 1위부터 10위(또는 그 이상)까지의 검색어 키워드만 뽑아서 JSON 리스트로 반환해.
                            형식: { "rankings": ["키워드1", "키워드2", ...] }
                            만약 순위를 찾을 수 없으면 빈 리스트를 반환해.
                            `
                        },
                        {
                            role: "user",
                            content: `다음 텍스트에서 실시간 검색어 순위를 찾아줘:\n\n${pageText.substring(0, 15000)}`
                        }
                    ],
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0].message.content);
                const rankings = result.rankings || [];
                const timestamp = new Date();
                
                await db.collection('wikiTrend').doc('current').set({
                    rankings: rankings,
                    updatedAt: timestamp,
                    source: 'namuwiki'
                });
                
                console.log('[OpenClaw] 스케줄 - Firestore 저장 완료:', rankings.length, '개 항목');

            } catch (error) {
                console.error('[OpenClaw] 스케줄 실행 중 에러:', error.message);
            } finally {
                if (browserContext) {
                    try {
                        await browserContext.close();
                    } catch (closeError) {
                        console.error('[OpenClaw] 브라우저 종료 중 에러:', closeError.message);
                    }
                }
            }
        });

        console.log('[OpenClaw] 나무위키 트렌드 자동 갱신 스케줄 설정 완료 (매 정시)');
    },

    // 나무위키 트렌드 자동 갱신 중지
    stopNamuwikiSchedule: () => {
        if (namuwikiScheduleJob) {
            namuwikiScheduleJob.stop();
            console.log('[OpenClaw] 나무위키 트렌드 자동 갱신 중지');
        }
    }
};