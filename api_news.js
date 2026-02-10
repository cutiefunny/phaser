const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const { callGemini, callOpenAI } = require('./llmHelpers');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const parser = new Parser();
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const moment = require('moment');

// ==========================================
// 헬퍼 함수
// ==========================================

// 두 문자열 유사도 (Dice Coefficient)
function getSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const bigrams = (str) => {
        const result = new Set();
        for (let i = 0; i < str.length - 1; i++) {
            result.add(str.substring(i, i + 2));
        }
        return result;
    };
    const set1 = bigrams(str1.replace(/\s+/g, ''));
    const set2 = bigrams(str2.replace(/\s+/g, ''));
    if (set1.size === 0 || set2.size === 0) return 0.0;
    let intersection = 0;
    set1.forEach(item => { if (set2.has(item)) intersection++; });
    return (2.0 * intersection) / (set1.size + set2.size);
}

// 연속된 문자 겹침 확인
function checkKeywordOverlap(str1, str2, length = 3) {
    if (!str1 || !str2) return false;
    const s1 = str1.replace(/\s+/g, '').toLowerCase();
    const s2 = str2.replace(/\s+/g, '').toLowerCase();
    if (s1.length < length || s2.length < length) return false;
    for (let i = 0; i <= s1.length - length; i++) {
        const chunk = s1.substring(i, i + length);
        if (s2.includes(chunk)) return true;
    }
    return false;
}

/**
 * 고도화된 정치/부적절 콘텐츠 필터링 함수
 * @param {string} title 기사 제목
 * @param {string} content 기사 본문
 * @returns {Promise<boolean>} true면 스킵, false면 통과
 */
async function shouldSkipArticle(title, content) {
    const combinedText = (title + " " + content).toLowerCase();

    // 1. 하드 키워드 필터링 (LLM 호출 전 비용/시간 절약)
    const criticalKeywords = [
        '대통령', '정당', '국민의힘', '더불어민주당', '의원', '공천', '총선', '대선', 
        '개혁신당', '조국혁신당', '정치권', '지방선거', '국회', '상임위', '본회의'
    ];
    
    // 제목에 명확한 정치 키워드가 있으면 즉시 스킵
    if (criticalKeywords.some(k => title.includes(k))) {
        return true;
    }

    // 2. LLM을 통한 정밀 맥락 분석
    const filterPrompt = `
        당신은 뉴스 편집 전문가입니다. 다음 기사가 '정치', '정책 홍보', '광고' 카테고리에 해당하시는지 판단하세요.
        
        [판단 기준]
        - 정치: 정당, 국회, 대통령, 선거, 정치인 행보 관련 기사.
        - 정책 홍보: 특정 지자체나 정부 부처의 단순 성과 자랑이나 홍보성 기사.
        - 광고/알림: 쿠폰, 이벤트, 단순 행사 알림, 체험단 모집.
        - 사회/일반: 정치적 편향성 없는 일반적인 사회 현상, 사고, 생활 정보 (이 경우는 PASS).

        기사 제목: ${title}
        기사 본문 요약: ${content.substring(0, 800)}

        위 기준 중 하나라도 해당하면 "SKIP"이라고 답하고, 일반적인 정보성 기사라면 "PASS"라고 답하세요.
        오직 한 단어(SKIP 또는 PASS)로만 대답하세요.
    `;

    try {
        let result = "";
        try {
            result = await callGemini(filterPrompt);
        } catch {
            result = await callOpenAI(filterPrompt);
        }

        return result.trim().toUpperCase().includes("SKIP");
    } catch (err) {
        logger.error(`[shouldSkipArticle] Error: ${err.message}`);
        // 에러 발생 시 안전하게 스킵하거나, 정책에 따라 통과 (여기선 통과)
        return false; 
    }
}

// ==========================================
// API Exports
// ==========================================

// 뉴스 수집 (10분마다 실행될 로직)
exports.getNews = async function(req, res) {
    const COLLECTION_NAME = 'eink-news';
    
    const SOURCES = [
        { type: 'naver', category: 'society', sid: '102', name: '네이버사회' },
    ];

    logger.info(`[getNews] Starting news collection from ${SOURCES.length} sources...`);

    try {
        const cutoffDate = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        
        // 1. 오래된 뉴스 삭제
        const oldNewsQuery = await db.collection(COLLECTION_NAME).where('createdAt', '<', cutoffDate).get();
        if (!oldNewsQuery.empty) {
            const batch = db.batch();
            oldNewsQuery.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            logger.info(`[getNews] Cleaned up ${oldNewsQuery.size} old items.`);
        }

        // 2. 현재 기사 제목 로드 (필터링용)
        const activeNewsSnap = await db.collection(COLLECTION_NAME).select('title').get();
        let existingTitles = activeNewsSnap.docs.map(doc => doc.data().title);
        logger.info(`[getNews] Initial loaded titles: ${existingTitles.length}`);

        let totalProcessed = 0;

        for (const source of SOURCES) {
            try {
                let itemsToProcess = [];

                if (source.type === 'naver') {
                    const naverUrl = `https://news.naver.com/main/list.naver?mode=LSD&mid=sec&sid1=${source.sid}`;
                    const response = await axios.get(naverUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const $ = cheerio.load(response.data);
                    $('.list_body ul li').slice(0, 5).each((i, elem) => {
                        const linkTag = $(elem).find('dl dt a').first();
                        const href = linkTag.attr('href');
                        const title = linkTag.text().trim() || $(elem).find('dl dt:not(.photo) a').text().trim();
                        if (href && title) itemsToProcess.push({ title, link: href, isoDate: new Date().toISOString() });
                    });
                }

                for (const item of itemsToProcess) {
                    // [중복 체크 1] 링크
                    const checkQuery = await db.collection(COLLECTION_NAME).where('originalLink', '==', item.link).get();
                    if (!checkQuery.empty) continue;

                    // [중복 체크 2] 제목 유사도/키워드
                    const conflictTitle = existingTitles.find(savedTitle => {
                        if (getSimilarity(item.title, savedTitle) > 0.6) return true;
                        if (checkKeywordOverlap(item.title, savedTitle, 3)) return true;
                        const lowerTitle = item.title.toLowerCase();
                        const adKeywords = ['알림', '광고', '공지', '쿠폰', '체험단', '리뷰', '후기', '신간'];
                        if (adKeywords.some(keyword => lowerTitle.includes(keyword))) return true;
                        return false;
                    });
                    
                    if (conflictTitle) {
                        logger.warn(`[getNews] Skip: "${item.title}" (Conflict with: "${conflictTitle}")`);
                        continue;
                    }

                    // [본문 추출]
                    const response = await axios.get(item.link, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
                    const dom = new JSDOM(response.data, { url: item.link });
                    const reader = new Readability(dom.window.document);
                    const article = reader.parse();
                    
                    if (!article || !article.textContent) continue;

                    // [고도화된 정치 필터링 적용]
                    const isPolitical = await shouldSkipArticle(article.title, article.textContent);
                    if (isPolitical) {
                        logger.info(`[getNews] Filtered Political/Ad Article: ${article.title}`);
                        continue;
                    }

                    // [LLM 요약 요청]
                    const contentSnippet = article.textContent.substring(0, 3000);
                    const summaryPrompt = `
                        다음 뉴스 기사를 E-ink 단말기용으로 500자 이내로 요약해주세요.
                        [제목]: ${article.title}
                        [본문]: ${contentSnippet}

                        요구사항:
                        1. 특수문자 사용을 자제하고 평어체로 작성.
                        2. 핵심 사실 위주로 3문장 이내로 요약.
                        3. 한국어로 간결하게 작성.
                    `;

                    let summaryText = "";
                    try {
                        summaryText = await callGemini(summaryPrompt);
                    } catch (geminiError) {
                        summaryText = await callOpenAI(summaryPrompt);
                    }
                    summaryText = summaryText.trim();

                    // [DB 저장]
                    await db.collection(COLLECTION_NAME).add({
                        category: source.category,
                        sourceName: source.name,
                        title: article.title,
                        summary: summaryText,
                        originalLink: item.link,
                        publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    existingTitles.push(article.title);
                    totalProcessed++;
                    logger.info(`[getNews] Saved: ${article.title}`);
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (err) {
                logger.error(`[getNews] Source Error (${source.name}): ${err.message}`);
            }
        }

        const msg = `[getNews] Job Finished. Total Saved: ${totalProcessed}`;
        logger.info(msg);
        if (res) res.send({ result: "success", message: msg, count: totalProcessed });

    } catch (error) {
        logger.error(`[getNews] Critical Error: ${error.message}`);
        if (res) res.send({ result: "fail", message: error.message });
    }
};

// E-ink 뉴스 조회
exports.getEinkNews = async function(req, res) {
    try {
        const category = req.body.category; 
        const limit = req.body.limit ? parseInt(req.body.limit) : 20; 

        let query = db.collection('eink-news').orderBy('createdAt', 'desc');

        if (category && category !== 'all') {
            query = query.where('category', '==', category);
        }

        const snapshot = await query.limit(limit).get();

        if (snapshot.empty) {
            return res.send({ result: "success", data: [], message: "아직 수집된 뉴스가 없습니다." });
        }

        const newsList = snapshot.docs.map(doc => {
            const data = doc.data();
            let dateObj = new Date();
            if (data.publishedAt && typeof data.publishedAt.toDate === 'function') {
                dateObj = data.publishedAt.toDate();
            } else if (data.publishedAt) {
                dateObj = new Date(data.publishedAt);
            }

            const isToday = moment(dateObj).isSame(new Date(), "day");
            const timeStr = isToday ? moment(dateObj).format('HH:mm') : moment(dateObj).format('MM-DD');

            return {
                id: doc.id,
                title: data.title,
                summary: data.summary,
                category: data.category,
                source: data.sourceName,
                time: timeStr,
                link: data.originalLink
            };
        });

        res.send({ result: "success", count: newsList.length, data: newsList });

    } catch (e) {
        logger.error("getEinkNews error: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};