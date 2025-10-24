const CRUD= require("./CRUD");
const moment = require('moment');
const router = require('./router');
require('dotenv').config();
const cheerio = require('cheerio');
const axios = require('axios');
const common = require('./common');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("./logger");
const genAI = new GoogleGenerativeAI("AIzaSyAx9Ko9eZtUJ6-7BXuLOrld0kcF9ZGRmL4");
const fs = require('fs');
const { OpenAI } = require("openai");
const openai = new OpenAI();
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

//근육고양이잡화점 네이버 검색 결과(1시간 이내)
exports.getSearchMusclecat = async function(req,res) {
    var label = "[네이버검색]";
    var datetime = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log({label:label,message:"start at " + datetime});
    //var url = 'https://search.naver.com/search.naver?where=view&query=%EA%B7%BC%EC%9C%A1%EA%B3%A0%EC%96%91%EC%9D%B4%EC%9E%A1%ED%99%94%EC%A0%90&sm=tab_opt&nso=so%3Ar%2Cp%3A1w%2Ca%3Aall'; //1주일
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
                    throw error;
                }
            }
        });
    } catch (error) {
        throw error;
    }
} 

exports.getLiveMatchInfo = async function (req, res) {
    console.log("getLiveMatchInfo : " + JSON.stringify(req.body));
    const url = 'https://www.betman.co.kr/matchinfo/inqMainLivescreMchList.do';
    const headers = {
        'Content-Type': 'application/json',
    };
    const data = {
        "schDate": req.body.schDate || "2025.06.21",
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

//텔레그램 업데이트 수집
// exports.collectTelegramUpdates = async function(time) {
//     const teleURL = 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/getUpdates';

//     try {
//         const response = await axios.get(teleURL);
//         const updates = response.data.result;
//         let stockPrice = "";
//         let beforePrice = "";

//         const collectedTexts = updates
//             .filter(update => update.channel_post && update.channel_post.text 
//                 && (time - update.channel_post.date <= 10)
//                 && (update.channel_post.text.includes("주가") || update.channel_post.text.includes("현재가") || update.channel_post.text.includes("동향") || update.channel_post.text.includes("뉴스")))
//             .map(update => ({
//             text: update.channel_post.text,
//             chatId: update.channel_post.chat.id,
//             date: update.channel_post.date,
//             }));
        
//         if (collectedTexts.length === 0) {
//             return;
//         }
//         const authorization = await redisClient.get('access_token');
//         //await redisClient.disconnect();
        
//         for (const text of collectedTexts) {

//             //await redisClient.connect();
//             // const dateCheck = await redisClient.get(text.date.toString());
//             // if (dateCheck) {
//             //     return;
//             // }else {
//             //     await redisClient.set(text.date.toString(), text.date, { EX: 24*60*60 });
//             // }
//             if (!authorization) {
//                 console.error("Access token not found in Redis");
//                 return;
//             }
//             //await redisClient.disconnect();

//             let prompt = text.text;
//             let name = "";
//             if (prompt.includes("주가") || prompt.includes("현재가") || (prompt.includes("동향") || prompt.includes("뉴스"))) {
//                 name = prompt.split(" ")[0];
//                 if (name === "네이버") {
//                     name = "NAVER";
//                 }
//                 const stockData = JSON.parse(fs.readFileSync('./krx-stock.json', 'utf8'));
//                 const stock = stockData.find(item => item.name.trim() === name);
//                 if (stock) {
//                     const code = stock.code;
//                     let stockInfo = null;
//                     const koreaInvestmentResponse = await axios.get(
//                         "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=UN&FID_INPUT_ISCD="+code,
//                         {
//                             headers: {
//                                 "Content-Type": "application/json",
//                                 "authorization": "Bearer " + authorization,
//                                 "appkey": process.env.HANTU_APP,
//                                 "appsecret": process.env.HANTU_SECRET,
//                                 "tr_id": "FHKST01010100", // Transaction ID for the API
//                             }
//                         }
//                     );

//                     if (koreaInvestmentResponse.status === 200) {
//                         stockInfo = koreaInvestmentResponse.data;

//                         stockPrice = stockInfo.output.stck_prpr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
//                         beforePrice = stockInfo.output.prdy_vrss.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " (" + stockInfo.output.prdy_ctrt + "%)";

//                         if (prompt.includes("주가") || prompt.includes("현재가")) {
//                             const sendMessageOptions = {
//                                 method: 'POST',
//                                 url: 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/sendMessage',
//                                 headers: { 'Content-Type': 'application/json' },
//                                 data: {
//                                     chat_id: text.chatId,
//                                     text: `종목명: ${name}\n현재가: ${stockPrice}\n전일대비: ${beforePrice}`
//                                 }
//                             };
//                             try {
//                                 await axios(sendMessageOptions);
//                             } catch (error) {
//                                 logger.error("Error sending stock info to Telegram: " + error.message);
//                             }
//                         }

//                         if (prompt.includes("동향") || prompt.includes("뉴스")) {
//                             let url = `https://openapi.naver.com/v1/search/news.json?query=${prompt}&display=30`;
//                             const naverResponse = await fetch(url, {
//                                 method: "GET",
//                                 headers: {
//                                     "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
//                                     "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
//                                 },
//                             });
//                             const naverData = await naverResponse.json();

//                             let addPrompt = "\n 이 데이터로 질문에 대해 간단히 답변을 해줘. 주가데이터와 뉴스를 참고해서 시장동향을 300자 이내로 간단히 요약해줘.";

//                             const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
//                             const result = await model.generateContent(prompt+ "\n 주가 데이터 : " + JSON.stringify(stockInfo) + "\n 뉴스 데이터 : " + JSON.stringify(naverData.items) + addPrompt);
//                             const response2 = await result.response;
//                             var text2 = response2.text();
//                             text2 = text2.replace(/\:\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '\n');
//                             text2 = text2.replace(/\([^)]*\)/g, '');
//                             const sendMessageOptions2 = {
//                                 method: 'POST',
//                                 url: 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/sendMessage',
//                                 headers: { 'Content-Type': 'application/json' },
//                                 data: { chat_id: text.chatId, text: text2 }
//                             };
//                             try {
//                                 await axios(sendMessageOptions2);
//                             } catch (error) {
//                                 logger.error("Error sending news info to Telegram: " + error.message);
//                             }
//                         }
//                     } else {
//                         console.error("한국투자증권 API 호출 실패:", koreaInvestmentResponse.statusText);
//                     }

//                 } 
//             }
//         }
//     } catch (error) {
//         logger.error("collectTelegramUpdates error: " + error.message);
//     }
// }

//점수 저장
exports.saveScore = async function (req,res){
    console.log("saveScore : "+JSON.stringify(req.body));
    req.body.createTm = moment().format("YYYY-MM-DD HH:mm:ss");
    await CRUD.insertData("wallballshot",req.body);
    let result = await CRUD.searchData("getScore","wallballshot");
    console.log("result : "+JSON.stringify(result));
    res.send({op:"saveScore",result:result});
}

//제미나이 서치
exports.search = async function(req,res) {
    try{
        let prompt = req.body.prompt;
        let data = req.body.data;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"});
        // let addPrompt = '';
        // const detectedLanguage = common.detectLanguage(data);
        // if (detectedLanguage === 'ko') {
        //     addPrompt = '이 데이터는 한국어로 작성되었습니다.';
        // } else if (detectedLanguage === 'en') {
        //     addPrompt = 'This data is written in English.';
        // } else {
        //     addPrompt = `The data is written in ${detectedLanguage}.`;
        // }
        // prompt = `${addPrompt}\n\n${prompt}`;
        prompt = `data : ${data}\n\n${prompt}+simply under 100 text.\n\n`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        var text = response.text();
        text = text.replace(/\:\*\*/g, ']').replace(/\*\*/g, '[').replace(/\*/g, '\n');
        text = text.replace(/\([^)]*\)/g, '');
        res.send({result:"success",op:"search",message:text});
    }catch(e){
        res.send({result:"fail",message:e.message});
    }
}

//제미나이 서치 스트리밍 테스트
exports.generate = async function(req,res) {
    try{
        let prompt = req.body.prompt;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"});
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const result = await model.generateContentStream(prompt);

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(chunkText); // 받은 텍스트 조각을 클라이언트로 즉시 전송
            }

        res.end(); // 스트림이 끝났음을 알림
    }catch(e){
        res.send({result:"fail",message:e.message});
    }
}

exports.getDailyFortune = async function(req, res) {
    try {
        // 1. 모델 이름 설정
        const model = "gpt-5-nano";

        // 2. 프롬프트 (20개 JSON 배열 요청)
        const promptMessages = [
            {
                "role": "system",
                "content": "You must output a valid JSON object."
            },
            {
                "role": "user",
                "content": "오늘의 운세 20문장을 JSON 배열 형태로 출력해줘. `fortunes`라는 키를 사용하고, 값은 20개의 운세 문장이 담긴 배열이어야 해. 다른 말은 절대 하지 말고 JSON 객체만 반환해."
            }
        ];

        // 3. OpenAI Chat Completions API 호출
        const chatCompletion = await openai.chat.completions.create({
            model: model,
            messages: promptMessages,
            response_format: { type: "json_object" } // JSON 응답 강제
        });

        const responseText = chatCompletion.choices[0].message.content;
        let newFortunes = [];

        try {
            // 4. JSON 응답 파싱 (응답이 { "fortunes": [...] } 형태일 것)
            newFortunes = JSON.parse(responseText).fortunes;
            if (!Array.isArray(newFortunes)) {
                throw new Error("API 응답이 배열 형태가 아닙니다.");
            }
        } catch (parseError) {
            console.error("JSON 파싱 오류:", responseText);
            throw new Error("API로부터 유효한 JSON 배열을 받지 못했습니다.");
        }

        //newFortunes의 각 항목이 "오늘은"으로 시작하지 않도록 수정
        newFortunes = newFortunes.map(fortune => {
            if (fortune.startsWith("오늘은")) {
                return fortune.replace(/^오늘은\s*/, '');
            }
            return fortune;
        });

        // 5. Redis 로직 (기존 리스트 삭제 후 새 리스트 추가)

        // (1) 기존 'unsetalk' 키 (리스트)를 삭제합니다.
        await redisClient.del('unsetalk');

        // (2) API로부터 받은 새 운세 배열을 'unsetalk' 리스트에 PUSH합니다.
        // (API가 빈 배열을 반환하는 예외 케이스 처리)
        if (newFortunes && newFortunes.length > 0) {
            await redisClient.rPush('unsetalk', newFortunes);
        } else {
            // 빈 리스트가 저장되는 것을 방지
            throw new Error("API로부터 운세 데이터를 받지 못했습니다.");
        }

        // 6. 성공 응답
        res.send({ 
            result: "success", 
            op: "getDailyFortune", 
            message: `'unsetalk' 리스트를 ${newFortunes.length}개의 새 운세로 교체했습니다.`,
            newFortunesList: newFortunes // 교체된 전체 리스트 반환
        });

    } catch (e) {
        console.error("getDailyFortune 오류:", e); // 서버 로그에 상세 오류 출력
        res.send({ result: "fail", message: e.message });
    }
};

//음성파일 처리
exports.processAudio = async function(req,res) {
    try{
        let audio = req.body.audio;
        const audioBuffer = await Buffer.from(audio, 'base64');
        const transcriptionPrompt = `Transcribe the following audio file and provide a summary under 100 words.`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        logger.info("processAudio : "+transcriptionPrompt);
        const result = await model.generateContent({
            prompt: transcriptionPrompt,
            audio: audioBuffer
        });

        const response = result.response;
        const text = response.text();


        res.send({result:"success",op:"search",message:text});
    }catch(e){
        logger.error("processAudio error : "+e.message);
        res.send({result:"fail",message:e.message});
    }
}