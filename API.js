const CRUD = require("./CRUD");
const moment = require('moment');
const router = require('./router');
require('dotenv').config();
const cheerio = require('cheerio');
const axios = require('axios');
const common = require('./common');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("./logger");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); // .env 파일 변수 사용
const fs = require('fs');
const { OpenAI } = require("openai");
const openai = new OpenAI(); // API 키는 환경 변수 OPENAI_API_KEY 에서 자동으로 로드됩니다.
const path = require('path');

// [신규] Google Cloud TTS 클라이언트
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
// Firebase용 키 파일을 TTS 인증에도 재사용 (같은 프로젝트인 경우)
const ttsClient = new TextToSpeechClient({
    keyFilename: './serviceAccountKey.json' 
});

// [신규] 뉴스 수집 및 정제를 위한 패키지
const Parser = require('rss-parser');
const parser = new Parser();
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

// Solapi SDK 추가
const { SolapiMessageService } = require("solapi");
// Solapi 메시지 서비스 인스턴스 생성
const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

// Firebase Admin SDK 초기화
const admin = require('firebase-admin');
// 서비스 계정 키 파일 경로 (실제 경로로 수정 필요)
const serviceAccount = require('./serviceAccountKey.json'); 

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

// Redis 클라이언트 (주석 처리 또는 필요시 유지)
/*
const redis = require('redis');
const redisClient = redis.createClient({
    username : process.env.REDIS_USER,
    password : process.env.REDIS_PASSWORD,
    socket: {
        host : process.env.REDIS_HOST,
        port : process.env.REDIS_PORT
    }
});
redisClient.connect();
*/

// --- 헬퍼 함수: API 호출 로직 분리 ---

/**
 * [헬퍼] Gemini API 호출
 * @param {string} prompt - 전송할 전체 프롬프트
 * @returns {Promise<string>} - 모델의 응답 텍스트
 * @throws {Error} - API 호출 실패 시 에러 발생
 */
async function _callGemini(prompt) {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("Google API Key is missing in .env");

        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 모델명 수정: 'gemini-1.5-flash-latest' 사용 권장
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (!text) throw new Error("Gemini returned empty text.");
        
        return text.trim();

    } catch (error) {
        // 에러 로그를 명확히 남겨서 디버깅을 돕습니다.
        // GoogleGenerativeAIError 같은 객체 구조를 문자열로 변환
        let errorMsg = error.message;
        if (error.response) {
            errorMsg = JSON.stringify(error.response);
        }
        logger.warn(`[_callGemini] Error: ${errorMsg}`);
        throw error; // 상위(getNews)로 던져서 OpenAI로 넘어가게 함
    }
}

/**
 * [헬퍼] OpenAI API 호출
 * @param {string} prompt - 전송할 유저 프롬프트
 * @returns {Promise<string>} - 모델의 응답 텍스트
 * @throws {Error} - API 호출 실패 시 에러 발생
 */
async function _callOpenAI(prompt) {
    try {
        const apiKey = process.env.OPENAI_API_KEY; // 환경 변수 확인 필요
        if (!apiKey) throw new Error("OpenAI API Key is missing in .env");

        // 최신 Chat Completion API 엔드포인트 사용
        const url = 'https://api.openai.com/v1/chat/completions';
        
        const response = await axios.post(url, {
            model: "gpt-3.5-turbo", // 비용 절감을 위해 3.5-turbo 권장 (또는 gpt-4o-mini)
            messages: [
                { role: "system", content: "You are a helpful news summarizer." },
                { role: "user", content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 600
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10초 타임아웃
        });

        // [디버깅] 실제 OpenAI가 뭘 줬는지 확인하고 싶다면 아래 주석 해제
        // console.log("[Debug OpenAI Response]", JSON.stringify(response.data, null, 2));

        // 응답 경로 파싱 (Chat API 구조)
        if (
            response.data && 
            response.data.choices && 
            response.data.choices.length > 0 && 
            response.data.choices[0].message &&
            response.data.choices[0].message.content
        ) {
            return response.data.choices[0].message.content.trim();
        } else {
            // 응답은 왔지만 내용이 이상한 경우
            logger.error(`[OpenAI Error] Invalid response structure: ${JSON.stringify(response.data)}`);
            throw new Error("OpenAI response structure is invalid (content missing).");
        }

    } catch (error) {
        // axios 에러인 경우 상세 정보 출력
        if (error.response) {
            logger.error(`[OpenAI API Error] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            throw new Error(`OpenAI API Error: ${error.response.data.error?.message || error.message}`);
        }
        throw error; // 상위(getNews)로 에러 전파
    }
}

//근육고양이잡화점 네이버 검색 결과(1시간 이내)
exports.getSearchMusclecat = async function(req,res) {
    var label = "[네이버검색]";
    var datetime = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log({label:label,message:"start at " + datetime});
    var url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=%EA%B7%BC%EC%9C%A1%EA%B3%A0%EC%96%91%EC%9D%B4%EC%9E%A1%ED%99%94%EC%A0%90&nso=p%3A1h'; //1시간

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const teleURL = 'https://api.telegram.org/bot5432313787:AAGOdLVR78YEAty8edwCCsqma7G89F-PoUY/sendMessage';

        $('.title_link').each(async function() {
            if ($(this).attr('href').includes('blog.naver.com')) {
                const options = {
                    method: 'POST',
                    url: teleURL,
                    headers: { 'Content-Type': 'application/json' },
                    data: { chat_id: '-1001903247433', text: $(this).attr('href') }
                };
                try {
                    await axios(options);
                } catch (error) {
                    // 개별 메시지 전송 오류 로깅 (전체 프로세스 중단 방지)
                    logger.error("Telegram sendMessage error: ", error.message);
                }
            }
        });
        // res가 정의되지 않았으므로 응답 전송 로직은 제거하거나 필요에 맞게 수정합니다.
        // res.send({ result: "success" }); // 예시: 성공 응답 (필요시 추가)
    } catch (error) {
        logger.error("getSearchMusclecat error: " + error.message);
    }
}

exports.getLiveMatchInfo = async function (req, res) {
    console.log("getLiveMatchInfo : " + JSON.stringify(req.body));
    const url = 'https://www.betman.co.kr/matchinfo/inqMainLivescreMchList.do';
    const headers = {
        'Content-Type': 'application/json',
    };
    const data = {
        "schDate": req.body.schDate || moment().format("YYYY.MM.DD"), // 날짜 형식 수정 및 기본값 오늘로 변경
        "_sbmInfo": {
            "_sbmInfo": {
            "debugMode": "false"
            }
        }
    }

    try {
        const response = await axios.post(url, data, { headers });
        res.send({ result: "success", data: response.data });
    } catch (error) {
        logger.error("getLiveMatchInfo error: " + error.message);
        res.send({ result: "fail", message: error.message });
    }
};

exports.inqMainGameInfo = async function (req, res) {
    console.log("inqMainGameInfo : " + JSON.stringify(req.body));
    const url = 'https://www.betman.co.kr/matchinfo/inqMainGameInfo.do';
    const headers = {
        'Content-Type': 'application/json',
    };
    const data = {
        "_sbmInfo": {
            "_sbmInfo": {
                "debugMode": "false"
            }
        }
    }

    try {
        const response = await axios.post(url, data, { headers });
        res.send({ result: "success", data: response.data });
    } catch (error) {
        logger.error("inqMainGameInfo error: " + error.message);
        res.send({ result: "fail", message: error.message });
    }
}

//점수 저장
exports.saveScore = async function (req,res){
    console.log("saveScore : "+JSON.stringify(req.body));
    req.body.createTm = moment().format("YYYY-MM-DD HH:mm:ss");
    await CRUD.insertData("wallballshot",req.body); // MongoDB 사용 유지
    let result = await CRUD.searchData("getScore","wallballshot");
    console.log("result : "+JSON.stringify(result));
    res.send({op:"saveScore",result:result});
}

/** re
 * 제미나이 서치 (실패 시 챗지피티로 Fallback)
 * [수정됨] data 유무에 따라 프롬프트 분기 처리
 */
exports.search = async function(req,res) {
    try{
        let prompt = req.body.prompt;
        let data = req.body.data;
        let text = "";
        let finalPrompt = ""; // 사용할 최종 프롬프트를 담을 변수

        // [수정된 부분] data의 존재 여부(truthy)로 프롬프트 내용을 분기합니다.
        if (data) {
            // 1. Data가 있을 경우: 기존 데이터 기반 프롬프트 사용
            finalPrompt = `Based on the following data: \n\n${data}\n\nAnswer the question: "${prompt}"\n\nPlease provide a simple answer under 100 words in Korean.\n\n`;
        } else {
            // 2. Data가 없을 경우: 일상적인 자연어 답변용 프롬프트 사용
            // (데이터 없이) 질문에 대해서만 한국어로 간결하게 답하도록 요청
            finalPrompt = `${prompt}\n\nPlease provide a simple answer under 100 words in Korean.`;
        }
        // [수정 끝]

        try {
            // 1. Gemini (Primary) 시도
            // 수정된 finalPrompt를 _callGemini로 전달
            text = await _callGemini(finalPrompt);
            res.send({result:"success", op:"search_gemini", message:text});

        } catch (geminiError) {
            logger.warn(`Gemini search failed (falling back to OpenAI): ${geminiError.message}`);
            
            // 2. OpenAI (Fallback) 시도
            try {
                // 동일한 finalPrompt를 _callOpenAI로 전달
                text = await _callOpenAI(finalPrompt); 
                res.send({result:"success", op:"search_openai_fallback", message:text});

            } catch (openaiError) {
                // OpenAI 마저 실패하면 최종 에러로 처리
                logger.error(`Fallback OpenAI search also failed: ${openaiError.message}`);
                // 두 번째 오류를 바깥 catch로 던져서 최종 실패 처리
                throw new Error(`Both models failed. Gemini: ${geminiError.message}, OpenAI: ${openaiError.message}`);
            }
        }
    } catch(e) {
        // 최종 실패 (둘 다 실패했거나, 초기 설정 오류)
        logger.error("search error (after fallback): " + e.message); 
        res.send({result:"fail", message: e.message});
    }
}

/**
 * 챗지피티 서치 (실패 시 제미나이로 Fallback)
 */
exports.generateChat = async function(req,res) {
    try{
        let prompt = req.body.prompt; // 이 함수는 'data'를 사용하지 않음 (원본 로직 유지)
        let text = "";

        try {
            // 1. OpenAI (Primary) 시도
            text = await _callOpenAI(prompt);
            res.send({ result: "success", op: "generateChat_openai", message: text });

        } catch (openaiError) {
            logger.warn(`OpenAI chat failed (falling back to Gemini): ${openaiError.message}`);

            // 2. Gemini (Fallback) 시도
            try {
                // 동일한 'prompt' 사용
                text = await _callGemini(prompt); 
                res.send({ result: "success", op: "generateChat_gemini_fallback", message: text });
            
            } catch (geminiError) {
                // Gemini 마저 실패하면 최종 에러로 처리
                logger.error(`Fallback Gemini chat also failed: ${geminiError.message}`);
                // 두 번째 오류를 바깥 catch로 던져서 최종 실패 처리
                throw new Error(`Both models failed. OpenAI: ${openaiError.message}, Gemini: ${geminiError.message}`);
            }
        }
    } catch (e) {
        // 최종 실패 (둘 다 실패했거나, 초기 설정 오류)
        logger.error("generateChat 오류 (after fallback):", e);
        res.send({ result: "fail", message: e.message });
    }
};

//제미나이 서치 스트리밍 테스트
exports.generate = async function(req,res) {
    let prompt = req.body.prompt; // 이 함수는 'data'를 사용하지 않음 (원본 로직 유지)
    let text = "";

    try {
        // 1. OpenAI (Primary) 시도
        text = await _callOpenAI(prompt);
        res.send(text);

    } catch (openaiError) {
        logger.warn(`OpenAI chat failed (falling back to Gemini): ${openaiError.message}`);

        // 2. Gemini (Fallback) 시도
        try {
            // 동일한 'prompt' 사용
            text = await _callGemini(prompt); 
            res.send(text);
        
        } catch (geminiError) {
            // Gemini 마저 실패하면 최종 에러로 처리
            logger.error(`Fallback Gemini chat also failed: ${geminiError.message}`);
            // 두 번째 오류를 바깥 catch로 던져서 최종 실패 처리
            throw new Error(`Both models failed. OpenAI: ${openaiError.message}, Gemini: ${geminiError.message}`);
        }
    }
}

//오늘의 운세 생성 (Firebase Firestore 사용)
// 랜덤 요소를 뽑기 위한 헬퍼 함수
function pickRandomItems(arr, count) {
    const shuffled = arr.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

exports.getDailyFortune = async function(req, res) {
    // 1. 운세를 다채롭게 만들 '랜덤 재료' 준비 (풀을 넓게 잡을수록 좋습니다)
    const materials = {
        luckyItems: ["건강","금전","인간관계","일"],
        actions: ["산책", "명상", "독서", "운동", "친구에게 연락하기", "새로운 음식 시도하기", "작은 목표 세우기","감사의 말 전하기","미안하다고 말하기","도움 요청하기","칭찬하기","새로운 취미 시작하기","처음 가는 장소 방문하기"],
    };

    // 2. '오늘의 재료' 랜덤 선정 (매 요청마다 바뀜)
    const selectedItems = pickRandomItems(materials.luckyItems, 4);
    const selectedAction = pickRandomItems(materials.actions, 10);

    try {
        let agenda = req.body ? req.body.agenda : null;
        let prompt = "";
        let document = "";

        // 3. 프롬프트 구성 (페르소나 부여 + 랜덤 재료 주입)
        const baseSystemPrompt = `
            Tone: 비유적 표현이 없는 담백한 문어체. 권장형으로 작성.
            Constraint: '오늘은 운이 좋습니다' 같은 뻔하고 추상적인 말은 절대 금지입니다. 구체적이고 실질적인 조언만 허용됩니다. ~하자 또는 ~하면 좋습니다 와 같은 권장형 문장으로 작성하세요.
        `;

        // 오늘의 랜덤 키워드 컨텍스트 생성
        const randomContext = `
            - 주제: ${selectedItems.join(", ")}
        `;

        if (!agenda) {
            prompt = `
                ${randomContext}
                
                30자 이내의 짧은 '오늘의 운세' 30문장을 작성해주세요.
                하나하나의 문장은 랜덤한 1개의 각각 다른 주제를 구체적으로 다루어야 합니다.
                문장에 :와 같은 구두점 사용을 피하고, 다양한 상황을 구체적으로 묘사하세요.
                
                출력 형식:
                JSON 객체 내의 \`fortunes\` 키에 30개의 문자열 배열로 반환하세요.
                다른 말은 절대 하지 말고 JSON 객체만 반환하세요.
            `;
            document = "latest";
        } else if (agenda === "연애") {
            prompt = `
                ${randomContext}

                위 키워드들의 분위기를 녹여내어, '오늘의 연애 운세' 10문장을 작성해주세요.
                설렘, 다툼, 화해, 인연 등 다양한 상황을 구체적으로 묘사하세요.

                출력 형식:
                JSON 객체 내의 \`fortunes\` 키에 10개의 문자열 배열로 반환하세요.
                다른 말은 절대 하지 말고 JSON 객체만 반환하세요.
            `;
            document = "love";
        }

        const modelName = "gpt-5-nano"; // 기존 모델명 유지
        const promptMessages = [
            { role: "system", content: "You must output a valid JSON object. " + baseSystemPrompt },
            { role: "user", content: prompt }
        ];

        const chatCompletion = await openai.chat.completions.create({
            model: modelName,
            messages: promptMessages,
            response_format: { type: "json_object" }
        });

        const responseText = chatCompletion.choices[0].message.content;
        let newFortunes = [];

        try {
            const parsedResponse = JSON.parse(responseText);
            if (!parsedResponse || !Array.isArray(parsedResponse.fortunes)) {
                throw new Error("API 응답에서 'fortunes' 배열을 찾을 수 없습니다.");
            }
            newFortunes = parsedResponse.fortunes;
        } catch (parseError) {
            logger.error("JSON 파싱 오류:", responseText, parseError);
            throw new Error("API로부터 유효한 JSON 배열을 받지 못했습니다.");
        }

        // 문장 다듬기 (기존 로직 유지)
        newFortunes = newFortunes.map(fortune => {
            if (typeof fortune === 'string') {
                // "오늘은", "오늘의" 같은 시작 문구 제거하여 더 깔끔하게
                return fortune.replace(/^(오늘은|오늘의)\s*/, '');
            }
            return fortune;
        }).filter(fortune => typeof fortune === 'string');

        if (newFortunes.length === 0) {
            throw new Error("API로부터 유효한 운세 데이터를 받지 못했습니다.");
        }

        // Firestore 저장 (기존 로직 유지)
        const fortuneRef = db.collection('dailyFortunes').doc(document || 'latest');
        await fortuneRef.set({
            fortunes: newFortunes,
            theme: { // (선택사항) 오늘 사용된 테마도 같이 저장해두면 나중에 보여주기 좋습니다.
                items: selectedItems,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info(`Firestore 'dailyFortunes/${document || 'latest'}' 문서를 ${newFortunes.length}개의 새 운세로 업데이트했습니다.`);

        if (res) {
            res.send({
                result: "success",
                op: "getDailyFortune",
                message: `Firestore 'dailyFortunes/${document || 'latest'}' 문서를 ${newFortunes.length}개의 새 운세로 업데이트했습니다.`,
                newFortunesList: newFortunes
            });
        }

    } catch (e) {
        logger.error("getDailyFortune 오류:", e);
        if (res) {
            res.send({ result: "fail", message: e.message });
        }
    }
};

//오늘의 운세 1개 가져오기 (Firebase Firestore 사용)
exports.getOneFortune = async function(req, res) {
    try {
        let agenda = req.body ? req.body.agenda : null;
        let document = "";
        if (!agenda) {
            document = "latest";
        }else if(agenda === "연애"){
            document = "love";
        }
        const fortuneRef = db.collection('dailyFortunes').doc(document || 'latest');
        const docSnap = await fortuneRef.get();

        if (!docSnap.exists) {
            logger.warn(`Firestore에 'dailyFortunes/${document || 'latest'}' 문서가 없습니다.`);
             // 문서가 없을 경우, getDailyFortune을 호출하여 새로 생성 시도
             await exports.getDailyFortune(req, null); // req, res 없이 내부 호출
             // 잠시 대기 후 다시 시도 (선택적)
             await new Promise(resolve => setTimeout(resolve, 1000));
             const newDocSnap = await fortuneRef.get();
             if (!newDocSnap.exists) {
                 throw new Error("운세 문서를 생성하지 못했습니다.");
             }
             docSnap = newDocSnap; // 새로 가져온 스냅샷 사용
        }

        const data = docSnap.data();
        const fortunes = data.fortunes;

        if (!Array.isArray(fortunes) || fortunes.length === 0) {
            logger.warn("'fortunes' 배열이 비어있거나 유효하지 않습니다.");
            // 운세 배열이 비어있을 경우, getDailyFortune을 호출하여 다시 채우기 시도
            await exports.getDailyFortune(req, null);
            await new Promise(resolve => setTimeout(resolve, 1000));
            const freshDocSnap = await fortuneRef.get();
            if (!freshDocSnap.exists || !Array.isArray(freshDocSnap.data().fortunes) || freshDocSnap.data().fortunes.length === 0) {
                throw new Error("운세 데이터를 가져오지 못했습니다.");
            }
            fortunes = freshDocSnap.data().fortunes; // 새로 가져온 데이터 사용
        }

        const randomIndex = Math.floor(Math.random() * fortunes.length);
        const randomMember = fortunes[randomIndex];

        console.log(`랜덤 운세: ${randomMember}`);
        res.send({ result: "success", fortune: randomMember });
    } catch (e) {
        logger.error("getOneFortune 오류:", e);
        res.send({ result: "fail", message: e.message });
    }
};

// [신규] 솔라피 알림톡 발송 함수
exports.sendKakaotalk = async function(req, res) {
    console.log("sendKakaotalk : " + JSON.stringify(req.body));
    
    // 알림톡 발송에는 'text' 외에 수신번호, 카카오채널ID, 템플릿ID가 필수입니다.
    // req.body.text는 알림톡 발송 실패 시 대체 발송될 '문자 메시지 내용'으로 사용됩니다.
    
    let { to, pfId, templateId, variables, text } = req.body;

    // 필수 파라미터 체크 (수신번호, 채널ID, 템플릿ID)
    if (!to || !pfId || !templateId) {
        const errorMsg = "sendKakaotalk error: Missing required fields: to, pfId, or templateId";
        logger.error(errorMsg);
        return res.send({ result: "fail", message: errorMsg });
    }

    try {
        // [FIX] Solapi SDK는 메시지 객체를 바로 인자로 받습니다.
        // { messages: [...] } 래퍼를 제거합니다.
        const response = await messageService.send({
            to: to, // 수신번호
            from: process.env.SOLAPI_SENDER_NUMBER, // .env에 설정된 발신번호
            text: text || "알림톡 발송에 실패하여 문자로 대신 발송합니다.", 
            kakaoOptions: {
                pfId: pfId, // Solapi에 등록된 카카오 채널 ID
                templateId: templateId, // 승인된 알림톡 템플릿 ID
                variables: variables || {}
            }
        });

        //console.log("Solapi response: ", JSON.stringify(response));

        // Solapi 응답 결과가 항상 성공(200)으로 오고, 내부 상태 코드로 성공/실패를 구분할 수 있습니다.
        // 여기서는 API 호출 자체의 성공/실패를 기준으로 응답합니다.
        res.send({ result: "success", op: "sendKakaotalk", data: response });

    } catch (e) {
        // API 호출 레벨의 오류 (예: 인증 실패, 네트워크 오류 등)
        logger.error("sendKakaotalk exception: " + e.message);
        // [FIX] 오류 메시지가 너무 길 수 있으므로 e.message만 전송 (혹은 e.toString())
        res.send({ result: "fail", message: e.message });
    }
};

// [수정] 운세 발송 (데이터 취합 및 Solapi 대량 발송)
exports.sendFortune = async function(req, res) {
    console.log("sendFortune: Processing fortune sending...");
    try {
        // --- 1. 폰번호 수집 (luckMembers) ---
        
        // [TEST] Firestore 조회 대신 Mock Data 사용
        const snapshot = await db.collection('luckMembers').get();
        const phoneNumbers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.phone) {
                phoneNumbers.push(data.phone);
            } else {
                logger.warn(`Document ${doc.id} is missing 'phone' field.`);
            }
        });
        // const phoneNumbers = ["01083151379", "01085288954"]; // 💡 MOCK DATA
        // console.log("Phone numbers (MOCK DATA):", phoneNumbers); 

        // --- 2. 운세 데이터 수집 (dailyFortunes) ---
        console.log("Fetching fortunes from dailyFortunes/latest...");
        let docSnap = await db.collection('dailyFortunes').doc('latest').get();

        if (!docSnap.exists) {
            logger.warn("sendFortune: 'dailyFortunes/latest' document not found. Generating...");
            await exports.getDailyFortune(null, null); // 운세 생성
            await new Promise(resolve => setTimeout(resolve, 1500)); // 생성 대기
            const newDocSnap = await db.collection('dailyFortunes').doc('latest').get();
            if (!newDocSnap.exists) {
                throw new Error("운세 문서를 찾을 수 없습니다. (dailyFortunes/latest)");
            }
            docSnap = newDocSnap; 
        }

        const fortuneData = docSnap.data();
        let fortunes = fortuneData.fortunes;

        if (!Array.isArray(fortunes) || fortunes.length === 0) {
            logger.warn("sendFortune: 'fortunes' array is empty. Regenerating...");
            await exports.getDailyFortune(null, null); // 운세 재생성
            await new Promise(resolve => setTimeout(resolve, 1500)); // 생성 대기
            const freshDocSnap = await db.collection('dailyFortunes').doc('latest').get();
            if (!freshDocSnap.exists || !Array.isArray(freshDocSnap.data().fortunes) || freshDocSnap.data().fortunes.length === 0) {
                throw new Error("운세 데이터를 가져오지 못했습니다.");
            }
            fortunes = freshDocSnap.data().fortunes;
        }
        
        // --- 3. 폰번호와 랜덤 운세 매칭 (JSON 배열 생성) ---
        const fortuneMappings = phoneNumbers.map(phone => {
            const randomIndex = Math.floor(Math.random() * fortunes.length);
            const randomFortune = fortunes[randomIndex];
            return { phone: phone, fortune: randomFortune };
        });
        console.log("Fortune Mappings (JSON Array):", fortuneMappings); 

        // --- 4. Solapi 대량 발송 (send) ---
        if (fortuneMappings.length === 0) {
            logger.warn("sendFortune: No phone numbers found, nothing to send.");
            return res.send({ result: "success", op: "sendFortune", count: 0, message: "No recipients found." });
        }

        // 'send'에 맞게 메시지 객체의 '배열' 형식으로 변환
        const messagesToSend = fortuneMappings.map(item => {
            return {
                to: item.phone,
                from: process.env.SOLAPI_SENDER_NUMBER,
                text: "오늘의 운세가 도착했어요!", // 알림톡 실패 시 대체 문자
                kakaoOptions: {
                    pfId: "KA01PF251023155453466zUYSFWha1ci",
                    templateId: "KA01TP251023175627378FUOi9NrdvXQ",
                    variables: {
                        "운세": item.fortune // 템플릿 변수 #{운세}에 매칭
                    }
                }
            };
        });

        console.log(`Attempting to send ${messagesToSend.length} Alimtalks via send()...`);
        
        // [FIX] 'sendMany' -> 'send'. SDK는 대량 발송 시 배열을 인자로 받습니다.
        const response = await messageService.send(messagesToSend);

        console.log("Solapi send response: ", JSON.stringify(response));

        res.send({
            result: "success",
            op: "sendFortune",
            count: messagesToSend.length,
            solapiResponse: response // Solapi 발송 결과 응답
        });

    } catch (e) {
        logger.error("sendFortune error: " + e.message); 
        res.send({ result: "fail", message: e.message });
    }
}

// [헬퍼] 두 문자열의 유사도 측정 (Dice Coefficient, 0~1)
// 제목이 60% 이상 비슷하면 중복으로 간주하기 위함
function getSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    // 2글자씩 쪼개서(Bigram) 집합 생성
    const bigrams = (str) => {
        const result = new Set();
        for (let i = 0; i < str.length - 1; i++) {
            result.add(str.substring(i, i + 2));
        }
        return result;
    };

    const set1 = bigrams(str1.replace(/\s+/g, '')); // 공백 제거 후 비교
    const set2 = bigrams(str2.replace(/\s+/g, ''));

    if (set1.size === 0 || set2.size === 0) return 0.0;

    let intersection = 0;
    set1.forEach(item => {
        if (set2.has(item)) intersection++;
    });

    return (2.0 * intersection) / (set1.size + set2.size);
}

// [헬퍼 2] 연속된 문자 겹침 확인 (New! 키워드 중복 방지)
// "넷플릭스 주가" vs "넷플릭스 신작" -> "넷플릭"(3글자)이 겹치므로 true 반환
function checkKeywordOverlap(str1, str2, length = 3) {
    if (!str1 || !str2) return false;
    
    // 공백 제거 및 소문자화
    const s1 = str1.replace(/\s+/g, '').toLowerCase();
    const s2 = str2.replace(/\s+/g, '').toLowerCase();

    if (s1.length < length || s2.length < length) return false;

    // s1을 3글자씩 잘라서 s2에 포함되어 있는지 확인 (Sliding Window)
    for (let i = 0; i <= s1.length - length; i++) {
        const chunk = s1.substring(i, i + length);
        if (s2.includes(chunk)) {
            return true; // 3글자 연속 겹침 발견
        }
    }
    return false;
}

// [수정] 뉴스 수집 (실시간 누적 배열 필터링 적용 + Google RSS 추가)
exports.getNews = async function(req, res) {
    const COLLECTION_NAME = 'eink-news';
    
    // [설정] 뉴스 소스 리스트 확장
    const SOURCES = [
        // 1. 네이버 사회 (사건, 사고) - 정치 필터링 적용됨
        { type: 'naver', category: 'society', sid: '102', name: '네이버사회' },
        
        // 2. 네이버 생활/문화 (건강, 여행, 날씨, 트렌드) - 가벼운 읽을거리
        { type: 'naver', category: 'culture', sid: '103', name: '네이버생활' },
        
        // 3. 네이버 세계 (해외 토픽)
        // { type: 'naver', category: 'world', sid: '104', name: '네이버세계' },
        
        // 4. 네이버 IT/과학 (기술, 신제품)
        // { type: 'naver', category: 'tech', sid: '105', name: '네이버IT' },

        // 5. [신규] Google 뉴스 RSS (대한민국 주요 뉴스 모음)
        { type: 'rss', category: 'hot', url: 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko', name: '구글주요뉴스' }
    ];

    logger.info(`[getNews] Starting news collection from ${SOURCES.length} sources...`);

    try {
        // --- 0. 누적 배열(Accumulator) 초기화 ---
        const cutoffDate = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        
        // 1) 24시간 지난 뉴스 삭제
        const oldNewsQuery = await db.collection(COLLECTION_NAME)
            .where('createdAt', '<', cutoffDate)
            .get();

        if (!oldNewsQuery.empty) {
            const batch = db.batch();
            oldNewsQuery.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            logger.info(`[getNews] Cleaned up ${oldNewsQuery.size} old items.`);
        }

        // 2) [핵심] 현재 DB에 있는 모든 기사 제목을 배열에 로드
        // 이 배열(existingTitles)은 새로운 기사가 추가될 때마다 계속 커집니다.
        const activeNewsSnap = await db.collection(COLLECTION_NAME).select('title').get();
        let existingTitles = activeNewsSnap.docs.map(doc => doc.data().title);

        logger.info(`[getNews] Initial loaded titles: ${existingTitles.length}`);

        let totalProcessed = 0;

        // --- 1. 소스별 수집 루프 ---
        for (const source of SOURCES) {
            try {
                let itemsToProcess = [];

                // 소스별 기사 리스트 가져오기 (제목, 링크만 먼저 확보)
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
                } else if (source.type === 'rss') {
                    // RSS 파싱 (Google 뉴스 등)
                    const feed = await parser.parseURL(source.url);
                    itemsToProcess = feed.items.slice(0, 5).map(item => ({
                        title: item.title,
                        link: item.link,
                        isoDate: item.isoDate || new Date().toISOString() // RSS에 날짜 없으면 현재시간
                    }));
                }

                // --- 2. 개별 기사 처리 루프 ---
                for (const item of itemsToProcess) {
                    
                    // [Step 1] URL 중복 체크 (DB 쿼리)
                    const checkQuery = await db.collection(COLLECTION_NAME).where('originalLink', '==', item.link).get();
                    if (!checkQuery.empty) continue;

                    // [Step 2] 제목 필터링 (누적 배열과 비교)
                    // existingTitles 배열을 순회하며 '유사도' 또는 '3글자 겹침' 확인
                    const conflictTitle = existingTitles.find(savedTitle => {
                        // 1. 문장 유사도가 60% 이상인가?
                        if (getSimilarity(item.title, savedTitle) > 0.6) return true;
                        // 2. 3글자 이상 키워드가 겹치는가? (예: 넷플릭스)
                        if (checkKeywordOverlap(item.title, savedTitle, 3)) return true;
                        // 3. 제목에 '알림', '광고', '공지' 등 광고성 단어 포함 여부
                        const lowerTitle = item.title.toLowerCase();
                        const adKeywords = ['알림', '광고', '공지', '쿠폰', '체험단', '리뷰', '후기', '신간'];
                        if (adKeywords.some(keyword => lowerTitle.includes(keyword))) return true;
                        return false;
                    });
                    
                    if (conflictTitle) {
                        logger.warn(`[getNews] Skip: "${item.title}" (Conflict with: "${conflictTitle}")`);
                        continue; // 배열에 걸리면 즉시 스킵 (본문 요청 X, LLM 요청 X)
                    }

                    // [Step 3] 본문 추출
                    const response = await axios.get(item.link, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
                    const dom = new JSDOM(response.data, { url: item.link });
                    const reader = new Readability(dom.window.document);
                    const article = reader.parse();
                    
                    if (!article || !article.textContent) {
                        logger.warn(`[getNews] Empty content for: ${item.title}`);
                        continue;
                    }

                    // [Step 4] LLM 요약 및 정치 필터링
                    let systemInstruction = "";
                    if (source.category === 'society' || source.category === 'hot') {
                        // 사회면이나 주요 뉴스(Hot)일 경우 정치 필터링 강화
                        systemInstruction = `
                            [Critical Constraint]:
                            If this article is primarily about Politics (parties, elections, president, parliament), 
                            output ONLY "SKIP_POLITICS".
                        `;
                    }

                    // [LOG] LLM 요청 전 본문 길이 체크 (너무 짧으면 LLM 에러 가능성 있음)
                    const contentSnippet = article.textContent.substring(0, 3000);
                    logger.info(`[getNews] Requesting Summary for: "${article.title}" (Content Length: ${contentSnippet.length})`);

                    const summaryPrompt = `
                        다음 뉴스 기사를 E-ink용으로 '500자 이내로 요약' 해주세요.
                        ${systemInstruction}
                        [제목]: ${article.title}
                        [본문]: ${contentSnippet}

                        요구사항:
                        1. 특수문자 금지.
                        2. 정치 기사면 "SKIP_POLITICS".
                        3. 알림 또는 광고성 기사면 "SKIP_POLITICS".
                        4. 한국어로 간결하게 작성.
                    `;

                    let summaryText = "";
                    try {
                        // 1차 시도: Gemini
                        summaryText = await _callGemini(summaryPrompt);
                        logger.info(`[getNews] Gemini Summary Success`);
                    } catch (geminiError) {
                        // Gemini 실패 로그 상세 출력
                        logger.warn(`[getNews] Gemini Failed -> Switching to OpenAI. (Error: ${geminiError.message})`);
                        
                        try {
                            // 2차 시도: OpenAI
                            summaryText = await _callOpenAI(summaryPrompt);
                            
                            // OpenAI 응답이 비어있는지 명시적 확인
                            if (!summaryText || summaryText.trim() === "") {
                                throw new Error("OpenAI returned an empty string result.");
                            }
                            logger.info(`[getNews] OpenAI Summary Success`);
                        } catch (openAiError) {
                            // OpenAI 실패 시 에러 재구성하여 상위 catch로 던짐
                            throw new Error(`OpenAI Execution Failed: ${openAiError.message}`);
                        }
                    }
                    summaryText = summaryText.trim();

                    if (summaryText.includes("SKIP_POLITICS")) {
                        logger.info(`[getNews] Filtered Political Article: ${article.title}`);
                        continue;
                    }

                    // [Step 5] DB 저장
                    await db.collection(COLLECTION_NAME).add({
                        category: source.category,
                        sourceName: source.name,
                        title: article.title,
                        summary: summaryText,
                        originalLink: item.link,
                        publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // [Step 6] ★★★ 누적 배열에 추가 (Accumulate) ★★★
                    // 이제 이 기사 제목도 필터링 장벽(Barrier)에 포함됩니다.
                    existingTitles.push(article.title);

                    totalProcessed++;
                    logger.info(`[getNews] Saved & Added to Filter: ${article.title}`);
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (err) {
                // 여기서 에러 메시지와 스택 트레이스를 더 명확하게 찍음
                logger.error(`[getNews] Source Error (${source.name}): ${err.message}`);
                console.error(err); // 콘솔에도 상세 스택 출력
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

// [신규] E-ink 앱용 뉴스 조회 API
exports.getEinkNews = async function(req, res) {
    try {
        // 클라이언트에서 'category'를 보내면 해당 분야만, 안 보내거나 'all'이면 전체 최신순
        const category = req.body.category; 
        const limit = req.body.limit ? parseInt(req.body.limit) : 20; // 기본 20개 로드

        let query = db.collection('eink-news').orderBy('createdAt', 'desc');

        // 카테고리 필터링 (economy, society, tech, accident)
        if (category && category !== 'all') {
            query = query.where('category', '==', category);
        }

        const snapshot = await query.limit(limit).get();

        if (snapshot.empty) {
            return res.send({ result: "success", data: [], message: "아직 수집된 뉴스가 없습니다." });
        }

        const newsList = snapshot.docs.map(doc => {
            const data = doc.data();
            
            // [E-ink 최적화] 날짜 연산을 서버에서 미리 처리
            // Firestore Timestamp 객체를 JS Date로 변환 후 포맷팅
            let dateObj = new Date();
            if (data.publishedAt && typeof data.publishedAt.toDate === 'function') {
                dateObj = data.publishedAt.toDate();
            } else if (data.publishedAt) {
                dateObj = new Date(data.publishedAt);
            }

            // 오늘 날짜면 "14:30", 지난 날짜면 "05-21" 형태로 짧게 표시
            const isToday = moment(dateObj).isSame(new Date(), "day");
            const timeStr = isToday ? moment(dateObj).format('HH:mm') : moment(dateObj).format('MM-DD');

            return {
                id: doc.id,
                title: data.title,
                summary: data.summary,     // 3줄 요약 텍스트
                category: data.category,   // economy, society...
                source: data.sourceName,   // 네이버경제, 연합뉴스...
                time: timeStr,             // 화면에 바로 뿌릴 시간 문자열
                link: data.originalLink    // 원문 이동용
            };
        });

        logger.info(`[getEinkNews] Fetched ${newsList.length} items (Category: ${category || 'all'})`);

        res.send({ 
            result: "success", 
            count: newsList.length, 
            data: newsList 
        });

    } catch (e) {
        logger.error("getEinkNews error: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

// [신규] TTS 생성 API (Google Cloud TTS 사용)
// 라우터(router.js)에 등록 필요: router.post('/generate-tts', controller.generateTTS);
exports.generateTTS = async function(req, res) {
    console.log("generateTTS (Google) : " + JSON.stringify(req.body));
    try {
        const text = req.body.text;
        if (!text) {
            return res.status(400).send({ result: "fail", message: "Text is required" });
        }

        // Google Cloud TTS 요청 구성
        const request = {
            input: { text: text },
            // 언어 및 보이스 설정 (Neural2 모델, 남성 뉴스 톤)
            // ko-KR-Neural2-A (여성), ko-KR-Neural2-B (여성), ko-KR-Neural2-C (남성)
            voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C' },
            // 오디오 인코딩 설정 (MP3)
            audioConfig: { audioEncoding: 'MP3' },
        };

        // API 호출
        const [response] = await ttsClient.synthesizeSpeech(request);
        
        // 오디오 콘텐츠 (Buffer)
        const audioContent = response.audioContent;

        if (!audioContent) {
            throw new Error("No audio content returned from Google TTS");
        }

        // 클라이언트로 스트리밍 전송
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioContent.length
        });
        res.end(audioContent);

    } catch (e) {
        logger.error("generateTTS error: " + e.message);
        if (!res.headersSent) {
            res.status(500).send({ result: "fail", message: e.message });
        }
    }
};