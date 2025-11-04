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

// Solapi SDK 추가
const { SolapiMessageService } = require("solapi");
// Solapi 메시지 서비스 인스턴스 생성
const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

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

//챗지피티 서치
exports.generateChat = async function(req,res) {
    try{
        let prompt = req.body.prompt;
        const modelName = "gpt-5-nano";

        const promptMessages = [
            { role: "system", content: "You are a helpful assistant that provides concise answers in Korean." },
            { role: "user", content: prompt }
        ];
        const chatCompletion = await openai.chat.completions.create({
            model: modelName,
            messages: promptMessages,
            max_completion_tokens: 1000,
        });

        const responseText = chatCompletion.choices[0].message.content;
        res.send({ result: "success", op: "generateChat", message: responseText });
    } catch (e) {
        logger.error("generateChat 오류:", e);
        res.send({ result: "fail", message: e.message });
    }
};

//오늘의 운세 생성 (Firebase Firestore 사용)
exports.getDailyFortune = async function(req, res) {
    try {
		let agenda = req.body ? req.body.agenda : null;
		let prompt = "";
		let document = "";
        if (!agenda) {
            prompt = "오늘의 운세 30문장을 JSON 배열 형태로 출력해줘. 금전, 일, 인간관계, 건강에 대한 것을 적절히 섞어서, 반은 부정적인 운세, 반은 긍정적인 운세여야 해. `fortunes`라는 키를 사용하고, 값은 30개의 운세 문장이 담긴 배열이어야 해. 다른 말은 절대 하지 말고 JSON 객체만 반환해.";
			document = "latest";
        }else if(agenda === "연애"){
            prompt = "오늘의 연애 운세 30문장을 JSON 배열 형태로 출력해줘. `fortunes`라는 키를 사용하고, 값은 30개의 운세 문장이 담긴 배열이어야 해. 다른 말은 절대 하지 말고 JSON 객체만 반환해.";
			document = "love";
        }

        const modelName = "gpt-5-nano";
        const promptMessages = [
            { role: "system", content: "You must output a valid JSON object." },
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
        const fortuneRef = db.collection('dailyFortunes').doc(document || 'latest');
        await fortuneRef.set({
            fortunes: newFortunes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() // 업데이트 시간 기록
        });

        logger.info(`Firestore 'dailyFortunes/${document || 'latest'}' 문서를 ${newFortunes.length}개의 새 운세로 업데이트했습니다.`);

        // res가 null일 수 있는 경우 (스케줄링 등) 처리
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
        // res가 null일 수 있는 경우 처리
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