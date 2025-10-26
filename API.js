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

// Firebase Admin SDK 초기화
const admin = require('firebase-admin');
// 서비스 계정 키 파일 경로 (실제 경로로 수정 필요)
const serviceAccount = require('./serviceAccountKey.json'); // <<--- 이 파일 경로를 확인해주세요.

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // .env 파일의 projectId 사용 (환경 변수 이름 확인 필요)
  // projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
});

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
        // res가 정의되지 않았으므로 오류 응답 로직은 제거하거나 필요에 맞게 수정합니다.
        // res.send({ result: "fail", message: error.message }); // 예시: 오류 응답 (필요시 추가)
        // 스케줄링 작업 등에서는 오류를 throw하여 상위에서 처리하도록 할 수 있습니다.
        // throw error;
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

//제미나이 서치
exports.search = async function(req,res) {
    try{
        let prompt = req.body.prompt;
        let data = req.body.data;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"}); // 모델명 최신으로 변경 권장
        prompt = `Based on the following data: \n\n${data}\n\nAnswer the question: "${prompt}"\n\nPlease provide a simple answer under 100 words in Korean.\n\n`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        var text = response.text();
        // 응답 텍스트 후처리 (Markdown 형식 유지 또는 제거 선택)
        // text = text.replace(/\*\*/g, '').replace(/\*/g, ''); // 예: Markdown 제거
        res.send({result:"success",op:"search",message:text});
    }catch(e){
        logger.error("search error: " + e.message); // 오류 로깅 추가
        res.send({result:"fail",message:e.message});
    }
}

//제미나이 서치 스트리밍 테스트
exports.generate = async function(req,res) {
    try{
        let prompt = req.body.prompt;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"}); // 모델명 최신으로 변경 권장
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const result = await model.generateContentStream(prompt);

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(chunkText); // 받은 텍스트 조각을 클라이언트로 즉시 전송
        }

        res.end(); // 스트림이 끝났음을 알림
    } catch(e) {
        logger.error("generate (stream) error: " + e.message); // 오류 로깅 추가
        // 스트리밍 중 오류 발생 시 클라이언트에 오류 메시지 전송 시도 (이미 헤더가 전송되었을 수 있음)
        if (!res.headersSent) {
            res.status(500).send({result:"fail",message:e.message});
        } else {
            res.end(); // 스트림 강제 종료
        }
    }
}

//오늘의 운세 생성 (Firebase Firestore 사용)
exports.getDailyFortune = async function(req, res) {
    try {
        const modelName = "gpt-5-nano"; // 모델 이름 확인 (gpt-5-nano는 아직 없을 수 있습니다)
        const promptMessages = [
            { role: "system", content: "You must output a valid JSON object." },
            { role: "user", content: "오늘의 운세 30문장을 JSON 배열 형태로 출력해줘. `fortunes`라는 키를 사용하고, 값은 30개의 운세 문장이 담긴 배열이어야 해. 다른 말은 절대 하지 말고 JSON 객체만 반환해." }
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

        newFortunes = newFortunes.map(fortune => {
            if (typeof fortune === 'string' && (fortune.startsWith("오늘은") || fortune.startsWith("오늘의"))) {
                 return fortune.replace(/^오늘은\s*/, '').replace(/^오늘의\s*/, '');
            }
            return fortune;
        }).filter(fortune => typeof fortune === 'string'); // 문자열 타입만 필터링

        if (newFortunes.length === 0) {
             throw new Error("API로부터 유효한 운세 데이터를 받지 못했습니다.");
        }

        // Firestore에 저장 (단일 문서 방식)
        const fortuneRef = db.collection('dailyFortunes').doc('latest'); // 'latest' 문서에 저장
        await fortuneRef.set({
            fortunes: newFortunes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() // 업데이트 시간 기록
        });

        logger.info(`Firestore 'dailyFortunes/latest' 문서를 ${newFortunes.length}개의 새 운세로 업데이트했습니다.`);

        // res가 null일 수 있는 경우 (스케줄링 등) 처리
        if (res) {
            res.send({
                result: "success",
                op: "getDailyFortune",
                message: `Firestore 'dailyFortunes/latest' 문서를 ${newFortunes.length}개의 새 운세로 업데이트했습니다.`,
                newFortunesList: newFortunes
            });
        }

    } catch (e) {
        logger.error("getDailyFortune 오류:", e);
        // res가 null일 수 있는 경우 처리
        if (res) {
            res.send({ result: "fail", message: e.message });
        }
    }
};

//오늘의 운세 1개 가져오기 (Firebase Firestore 사용)
exports.getOneFortune = async function(req, res) {
    try {
        const fortuneRef = db.collection('dailyFortunes').doc('latest');
        const docSnap = await fortuneRef.get();

        if (!docSnap.exists) {
            logger.warn("Firestore에 'dailyFortunes/latest' 문서가 없습니다.");
             // 문서가 없을 경우, getDailyFortune을 호출하여 새로 생성 시도
             await exports.getDailyFortune(null, null); // req, res 없이 내부 호출
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
            await exports.getDailyFortune(null, null);
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