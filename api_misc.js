const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const common = require('./common'); // 기존 파일 경로 확인
const CRUD = require("./CRUD");     // 기존 파일 경로 확인
const axios = require('axios');
const moment = require('moment');
const cheerio = require('cheerio');
const { OpenAI } = require("openai");
const apiKakaotalk = require('./api_kakaotalk'); 
require('dotenv').config();

const openai = new OpenAI(); // JSON Mode 용 별도 인스턴스


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

// 내부 사용용 (영어 명언 -> 한글 운세) - api_kakaotalk.js로 이동됨
const generateFortune = apiKakaotalk.generateFortune;

exports.getOneFortune = async function(req, res) {
    try {
        const fortuneMessage = await generateFortune();
        res.send(fortuneMessage);
    } catch (e) {
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// Scraping & Legacy
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