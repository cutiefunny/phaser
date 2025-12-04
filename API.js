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

// --- 헬퍼 함수: API 호출 로직 분리 ---

/**
 * [헬퍼] Gemini API 호출
 * @param {string} prompt - 전송할 전체 프롬프트
 * @returns {Promise<string>} - 모델의 응답 텍스트
 * @throws {Error} - API 호출 실패 시 에러 발생
 */
async function _callGemini(prompt) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // 모델명 최신으로 변경 권장
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    if (!text) {
        throw new Error("Gemini returned an empty response.");
    }
    return text;
}

/**
 * [헬퍼] OpenAI API 호출
 * @param {string} prompt - 전송할 유저 프롬프트
 * @returns {Promise<string>} - 모델의 응답 텍스트
 * @throws {Error} - API 호출 실패 시 에러 발생
 */
async function _callOpenAI(prompt) {
    const modelName = "gpt-5-nano"; // (개발자님이 사용하신 모델명)

    const promptMessages = [
        { role: "system", content: "You are a helpful assistant that provides concise answers in Korean." },
        { role: "user", content: prompt }
    ];
    
    const chatCompletion = await openai.chat.completions.create({
        model: modelName,
        messages: promptMessages,
        max_tokens: 1000, // [수정됨] 'max_completion_tokens' -> 'max_tokens'
    });

    const responseText = chatCompletion.choices[0].message.content;
    if (!responseText) {
        throw new Error("OpenAI returned an empty response.");
    }
    return responseText;
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

/**
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
// 랜덤 요소를 뽑기 위한 헬퍼 함수
function pickRandomItems(arr, count) {
    const shuffled = arr.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

exports.getDailyFortune = async function(req, res) {
    // 1. 운세를 다채롭게 만들 '랜덤 재료' 준비 (풀을 넓게 잡을수록 좋습니다)
    const materials = {
        luckyItems: ["오래된 동전", "구겨진 영수증", "빨간 우산", "이어폰", "작은 거울", "민트색 사탕", "낡은 열쇠", "종이비행기", "필름 카메라", "선글라스"],
        places: ["편의점 앞", "엘리베이터 거울 앞", "횡단보도", "퇴근길 버스 맨 뒷자리", "오래된 서점", "카페 창가", "공원 벤치", "지하철 스크린도어 앞"],
        actions: ["하늘을 한 번 올려다보세요", "평소에 듣지 않던 장르의 노래를 들어보세요", "주머니를 정리해보세요", "따뜻한 차를 한 잔 마시세요", "가방 속 짐을 줄여보세요"],
        colors: ["버건디", "머스타드", "딥그린", "네이비", "차콜", "파스텔 핑크"]
    };

    // 2. '오늘의 재료' 랜덤 선정 (매 요청마다 바뀜)
    const selectedItems = pickRandomItems(materials.luckyItems, 3);
    const selectedPlaces = pickRandomItems(materials.places, 2);
    const selectedAction = pickRandomItems(materials.actions, 1)[0];
    const selectedColor = pickRandomItems(materials.colors, 1)[0];

    try {
        let agenda = req.body ? req.body.agenda : null;
        let prompt = "";
        let document = "";

        // 3. 프롬프트 구성 (페르소나 부여 + 랜덤 재료 주입)
        const baseSystemPrompt = `
            Role: 당신은 30년 경력의 신비롭고 통찰력 있는 점술가입니다.
            Tone: 직설적인 조언보다는 은유적이고 신비로운 문체를 사용하세요. (~할 것이네, ~하게나 등)
            Constraint: '오늘은 운이 좋습니다' 같은 뻔하고 추상적인 말은 절대 금지입니다. 구체적인 사물, 행동, 상황을 묘사하세요.
        `;

        // 오늘의 랜덤 키워드 컨텍스트 생성
        const randomContext = `
            [오늘의 영감 키워드]
            이 키워드들을 운세 문장 작성에 적극적으로 활용하거나 비유의 소재로 쓰세요:
            - 행운의 물건/소재: ${selectedItems.join(", ")}
            - 장소: ${selectedPlaces.join(", ")}
            - 추천 행동: ${selectedAction}
            - 색상: ${selectedColor}
        `;

        if (!agenda) {
            prompt = `
                ${randomContext}
                
                위 키워드들을 적절히 섞거나 변형하여, '오늘의 운세' 30문장을 작성해주세요.
                금전, 일, 인간관계, 건강 운을 적절히 섞되, 각 문장은 서로 다른 구체적인 상황을 묘사해야 합니다.
                
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
                color: selectedColor,
                place: selectedPlaces
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