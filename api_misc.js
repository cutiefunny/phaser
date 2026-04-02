const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const common = require('./common'); // 기존 파일 경로 확인
const CRUD = require("./CRUD");     // 기존 파일 경로 확인
const axios = require('axios');
const moment = require('moment');
const cheerio = require('cheerio');
const { OpenAI } = require("openai");
const { SolapiMessageService } = require("solapi");
require('dotenv').config();

const openai = new OpenAI(); // JSON Mode 용 별도 인스턴스
const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

// ==========================================
// 상품 (Product) CRUD
// ==========================================

exports.getProductsData = async function() {
    try {
        const snapshot = await db.collection('products').get();
        const list = [];
        snapshot.forEach(doc => {
            const category = doc.id;
            const items = doc.data();
            for (const [name, value] of Object.entries(items)) {
                let price = value;
                let barcode = "";
                if (typeof value === 'object') {
                    price = value.price;
                    barcode = value.barcode || "";
                }
                list.push({ category, name, price, barcode });
            }
        });
        list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        return list;
    } catch (e) {
        logger.error(e.message);
        return [];
    }
};

exports.saveProduct = async function(req, res) {
    try {
        const { category, name, price, barcode } = req.body;
        await db.collection('products').doc(category).set({
            [name]: { price: price, barcode: barcode }
        }, { merge: true });
        res.send({ result: "success" });
    } catch (e) {
        logger.error(e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.updateProduct = async function(req, res) {
    try {
        const { oldCategory, oldName, newCategory, newName, newPrice, newBarcode } = req.body;
        const batch = db.batch();

        if (oldCategory !== newCategory || oldName !== newName) {
            const oldRef = db.collection('products').doc(oldCategory);
            batch.update(oldRef, { [oldName]: admin.firestore.FieldValue.delete() });
        }

        const newRef = db.collection('products').doc(newCategory);
        batch.set(newRef, {
            [newName]: { price: newPrice, barcode: newBarcode }
        }, { merge: true });

        await batch.commit();
        res.send({ result: "success" });
    } catch (e) {
        logger.error(e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.deleteProduct = async function(req, res) {
    try {
        const { category, name } = req.body;
        await db.collection('products').doc(category).update({
            [name]: admin.firestore.FieldValue.delete()
        });
        res.send({ result: "success" });
    } catch (e) {
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// 운세 (Fortune)
// ==========================================

exports.getDailyFortune = async function(req, res) {
    try {
        let agenda = req.body ? req.body.agenda : null;
        let prompt = "";
        let document = "";
        if (!agenda) {
            prompt = "오늘의 운세 50문장을 JSON 배열 형태로 출력해줘. 금전, 인간관계, 건강에 대한 것을 적절히 섞어서 30자 이내로 줄이되, 완결된 문장이어야 해. `fortunes`라는 키를 사용하고, 값은 50개의 운세 문장이 담긴 배열이어야 해.";
            document = "latest";
        } else if(agenda === "연애"){
            prompt = "오늘의 연애 운세 10문장을 JSON 배열 형태로 출력해줘. `fortunes`라는 키를 사용하고, 값은 10개의 운세 문장이 담긴 배열이어야 해.";
            document = "love";
        }

        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // 모델명 수정 가능
            messages: [
                { role: "system", content: "You must output a valid JSON object." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const responseText = chatCompletion.choices[0].message.content;
        let newFortunes = [];

        try {
            const parsedResponse = JSON.parse(responseText);
            newFortunes = parsedResponse.fortunes;
        } catch (parseError) {
            throw new Error("JSON 파싱 오류");
        }

        // 정제
        newFortunes = newFortunes.map(f => {
            if (typeof f === 'string' && (f.startsWith("오늘은") || f.startsWith("오늘의"))) {
                return f.replace(/^오늘은\s*/, '').replace(/^오늘의\s*/, '');
            }
            return f;
        }).filter(f => typeof f === 'string');

        // DB 저장
        const fortuneRef = db.collection('dailyFortunes').doc(document || 'latest');
        await fortuneRef.set({
            fortunes: newFortunes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (res) {
            res.send({ result: "success", op: "getDailyFortune", newFortunesList: newFortunes });
        }
    } catch (e) {
        logger.error("getDailyFortune 오류:", e);
        if (res) res.send({ result: "fail", message: e.message });
    }
};

// 내부 사용용 (영어 명언 -> 한글 운세)
async function generateFortune() {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        const adviceResponse = await axios.get('https://api.adviceslip.com/advice');
        const originalText = adviceResponse.data.slip.advice;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const geminiBody = {
            contents: [{
                parts: [{
                    text: `Translate the following sentence into Korean efficiently and naturally, like a one-line fortune. Output only the Korean text without quotes.\n\nSentence: "${originalText}"`
                }]
            }]
        };

        const geminiResponse = await axios.post(geminiUrl, geminiBody, { headers: { 'Content-Type': 'application/json' }});
        return geminiResponse.data.candidates[0].content.parts[0].text.trim();
    } catch (e) {
        logger.error("generateFortune internal error:", e);
        throw e;
    }
}

exports.getOneFortune = async function(req, res) {
    try {
        const fortuneMessage = await generateFortune();
        res.send(fortuneMessage);
    } catch (e) {
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// Solapi (알림톡)
// ==========================================

exports.sendKakaotalk = async function(req, res) {
    let { to, pfId, templateId, variables, text } = req.body;
    if (!to || !pfId || !templateId) {
        return res.send({ result: "fail", message: "Missing required fields" });
    }

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: text || "알림톡 발송에 실패하여 문자로 대신 발송합니다.",
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: variables || {}
            }
        });
        res.send({ result: "success", op: "sendKakaotalk", data: response });
    } catch (e) {
        logger.error("sendKakaotalk exception: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendClassConfirmation = async function(req, res) {
    let { to, className, classDate, userName } = req.body;
    if (!to || !className || !classDate || !userName) {
        return res.send({ result: "fail", message: "필수 정보(to, className, classDate, userName)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260331024937668DR33pfsqSPu";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수강 확정 안내]\n\n수업명 : ${className}\n수업일시 : ${classDate}\n신청자 : ${userName}\n\n취소는 수업신청 페이지에서 가능!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "수업일시": classDate,
                    "이름": userName
                }
            }
        });
        res.send({ result: "success", op: "sendClassConfirmation", data: response });
    } catch (e) {
        logger.error("sendClassConfirmation exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendClassWaiting = async function(req, res) {
    let { to, className, classDate, userName, waitingNo } = req.body;
    if (!to || !className || !classDate || !userName || !waitingNo) {
        return res.send({ result: "fail", message: "필수 정보(to, className, classDate, userName, waitingNo)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260401033715801lucYG02Twnu";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수강 대기 안내]\n\n수업명 : ${className}\n수업일시 : ${classDate}\n신청자 : ${userName}\n대기순번 : ${waitingNo}\n\n기존 참여자의 취소로 인한 수강 확정 시 다시 카카오톡으로 알려 드립니다!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "수업일시": classDate,
                    "이름": userName,
                    "순번": waitingNo
                }
            }
        });
        res.send({ result: "success", op: "sendClassWaiting", data: response });
    } catch (e) {
        logger.error("sendClassWaiting exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendClassChange = async function(req, res) {
    let { to, className, guide } = req.body;
    if (!to || !className || !guide) {
        return res.send({ result: "fail", message: "필수 정보(to, className, guide)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260331025036945mj7yaWFz7BK";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수업 변경 안내]\n\n수업명 : ${className}\n${guide}\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "안내문": guide
                }
            }
        });
        res.send({ result: "success", op: "sendClassChange", data: response });
    } catch (e) {
        logger.error("sendClassChange exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendFortune = async function(req, res) {
    try {
        const snapshot = await db.collection('luckMembers').get();
        const phoneNumbers = [];
        snapshot.forEach(doc => {
            if (doc.data().phone) phoneNumbers.push(doc.data().phone);
        });

        if (phoneNumbers.length === 0) {
            return res.send({ result: "success", message: "No recipients found." });
        }

        const messagePromises = phoneNumbers.map(async (phone) => {
            try {
                const fortuneText = await generateFortune();
                return {
                    to: phone,
                    from: process.env.SOLAPI_SENDER_NUMBER,
                    text: "오늘의 운세가 도착했어요!",
                    kakaoOptions: {
                        pfId: "KA01PF251023155453466zUYSFWha1ci",
                        templateId: "KA01TP251023175627378FUOi9NrdvXQ",
                        variables: { "운세": fortuneText }
                    }
                };
            } catch (err) {
                return null;
            }
        });

        const results = await Promise.all(messagePromises);
        const messagesToSend = results.filter(msg => msg !== null);

        if (messagesToSend.length > 0) {
            const response = await messageService.send(messagesToSend);
            res.send({ result: "success", count: messagesToSend.length, solapiResponse: response });
        } else {
            throw new Error("발송할 메시지가 없습니다.");
        }
    } catch (e) {
        logger.error("sendFortune error: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// 기타 (Scraping & Legacy)
// ==========================================

exports.getSearchMusclecat = async function(req, res) {
    const url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=%EA%B7%BC%EC%9C%A1%EA%B3%A0%EC%96%91%EC%9D%B4%EC%9E%A1%ED%99%94%EC%A0%90&nso=p%3A1h'; 
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const teleURL = 'https://api.telegram.org/bot5432313787:AAGOdLVR78YEAty8edwCCsqma7G89F-PoUY/sendMessage';

        $('.title_link').each(async function() {
            if ($(this).attr('href').includes('blog.naver.com')) {
                try {
                    await axios.post(teleURL, { chat_id: '-1001903247433', text: $(this).attr('href') });
                } catch (error) { logger.error("Telegram error:", error.message); }
            }
        });
        if(res) res.send({ result: "success" });
    } catch (error) {
        logger.error("getSearchMusclecat error: " + error.message);
    }
};

exports.getLiveMatchInfo = async function (req, res) {
    const url = 'https://www.betman.co.kr/matchinfo/inqMainLivescreMchList.do';
    try {
        const response = await axios.post(url, {
            "schDate": req.body.schDate || moment().format("YYYY.MM.DD"),
            "_sbmInfo": { "_sbmInfo": { "debugMode": "false" } }
        });
        res.send({ result: "success", data: response.data });
    } catch (error) {
        res.send({ result: "fail", message: error.message });
    }
};

exports.inqMainGameInfo = async function (req, res) {
    const url = 'https://www.betman.co.kr/matchinfo/inqMainGameInfo.do';
    try {
        const response = await axios.post(url, { "_sbmInfo": { "_sbmInfo": { "debugMode": "false" } } });
        res.send({ result: "success", data: response.data });
    } catch (error) {
        res.send({ result: "fail", message: error.message });
    }
};

exports.saveScore = async function (req, res){
    req.body.createTm = moment().format("YYYY-MM-DD HH:mm:ss");
    await CRUD.insertData("wallballshot", req.body);
    let result = await CRUD.searchData("getScore", "wallballshot");
    res.send({op:"saveScore", result:result});
};

// ==========================================
// Exaone 채팅 API
// ==========================================

exports.chatExaone = async function (req, res) {
    try {
        const { callExaone } = require('./llmHelpers');
        
        let prompt = req.body.prompt;
        
        if (!prompt) {
            return res.send({ 
                result: "fail", 
                message: "prompt가 필요합니다." 
            });
        }

        logger.info(`[Exaone Chat] 요청: ${prompt.substring(0, 50)}...`);
        
        const messages = [{ role: "user", content: prompt }];
        const text = await callExaone(messages, "You are a helpful assistant.");
        
        logger.info(`[Exaone Chat] 응답 생성 완료`);
        
        res.send({ 
            result: "success", 
            op: "chatExaone",
            message: text 
        });

    } catch (error) {
        logger.error(`[Exaone Chat Error] ${error.message}`);
        res.send({ 
            result: "fail", 
            message: error.message 
        });
    }
};

// ==========================================
// 제품 정보 조회 (prompt 분석 기반)
// ==========================================

exports.productInfo = async function (req, res) {
    try {
        const prompt = req.body.prompt;
        
        if (!prompt) {
            return res.send({ 
                result: "fail", 
                message: "prompt가 필요합니다." 
            });
        }

        // 1. 모든 상품 데이터 조회
        const productsData = await exports.getProductsData();

        if (!productsData || productsData.length === 0) {
            return res.send({ 
                result: "fail", 
                message: "등록된 상품이 없습니다." 
            });
        }

        // 2. LLM에 prompt + productsData를 함께 전달하여 제품 직접 도출
        const { callGemini } = require('./llmHelpers');
        
        const productList = productsData.map(p => `- ${p.name} (카테고리: ${p.category}, 가격: ${p.price}원)`).join('\n');
        
        const matchingPrompt = `사용자의 요청을 분석하여 다음 상품 목록에서 사용자가 원하는 것으로 추정되는 모든 제품을 찾아주세요.
반드시 다음의 JSON 형식으로만 응답하세요. 다른 설명은 하지 마세요:
{ "productNames": ["제품명1", "제품명2", ...], "found": true/false }

[사용자가 찾는 제품]
${prompt}

[등록된 상품 목록]
${productList}`;

        const geminiResponse = await callGemini(matchingPrompt);

        let extractedProductNames = [];
        let found = false;
        try {
            // Gemini 응답에서 마크다운 코드블록 제거
            let jsonStr = geminiResponse
                .replace(/```json\n?/g, '')  // ```json 제거
                .replace(/```\n?/g, '')       // ``` 제거
                .trim();
            
            const parseResponse = JSON.parse(jsonStr);
            extractedProductNames = Array.isArray(parseResponse.productNames) ? parseResponse.productNames : [parseResponse.productNames];
            found = parseResponse.found;
        } catch (parseError) {
            logger.error("Product matching parse error:", parseError, "Response:", geminiResponse);
            return res.send({ 
                result: "fail", 
                message: "제품 매칭 실패" 
            });
        }

        if (!extractedProductNames || extractedProductNames.length === 0 || !found) {
            return res.send({ 
                result: "notfound",
                message: "요청하신 제품을 찾을 수 없습니다.",
                availableProducts: productsData.slice(0, 10)
            });
        }

        // 3. 매칭된 모든 제품 조회 (여러 개일 경우 모두 반환)
        const matchedProducts = productsData.filter(product => 
            extractedProductNames.some(name => 
                product.name.toLowerCase() === name.toLowerCase()
            )
        );

        if (matchedProducts && matchedProducts.length > 0) {
            return res.send({ 
                result: "success",
                op: "productInfo",
                products: matchedProducts.map(product => ({
                    category: product.category,
                    name: product.name,
                    price: product.price,
                    barcode: product.barcode
                }))
            });
        } else {
            return res.send({ 
                result: "notfound",
                message: `요청하신 제품들을 찾을 수 없습니다.`,
                availableProducts: productsData.slice(0, 10)
            });
        }

    } catch (error) {
        logger.error(`[Product Info Error] ${error.message}`);
        res.send({ 
            result: "fail", 
            message: error.message 
        });
    }
};