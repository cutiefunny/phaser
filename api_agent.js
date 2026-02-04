const { db } = require('./firebaseConfig');
const logger = require("./logger");
const { callGemini, callOpenAI } = require('./llmHelpers');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { MemorySaver, StateGraph, MessagesAnnotation, START, END } = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
require('dotenv').config();

// ==========================================
// 1. 도구(Tool) 정의
// ==========================================
const productSearchTool = tool(
    async ({ productName }) => {
        try {
            logger.info(`[Tool] 제품 DB 검색어: "${productName}"`);

            const productsRef = db.collection('products');
            const snapshot = await productsRef.get();

            if (snapshot.empty) return "데이터가 없습니다.";

            const productsDB = {};
            snapshot.forEach(doc => { productsDB[doc.id] = doc.data(); });

            const searchResult = {};
            const query = productName.replace(/\s+/g, '');

            // [헬퍼] 데이터 정규화
            const normalizeItem = (val) => {
                let price = val;
                let barcode = null;
                
                if (typeof val === 'object' && val !== null) {
                    price = val.price;
                    barcode = val.barcode || null;
                }

                let qrCodeUrl = null;
                if (barcode) {
                    qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${barcode}`;
                }
                return { price, qrCodeUrl };
            };

            // 기존 검색 로직
            for (const [category, items] of Object.entries(productsDB)) {
                const cleanCategory = category.replace(/\s+/g, '');
                if (cleanCategory.includes(query) || query.includes(cleanCategory)) {
                    for (const [itemName, val] of Object.entries(items)) {
                        searchResult[itemName] = normalizeItem(val);
                    }
                } else {
                    for (const [itemName, val] of Object.entries(items)) {
                        const cleanItemName = itemName.replace(/\s+/g, '');
                        if (cleanItemName.includes(query) || query.includes(cleanItemName)) {
                            searchResult[itemName] = normalizeItem(val);
                        }
                    }
                }
            }

            const keys = Object.keys(searchResult);
            if (keys.length > 0) {
                return JSON.stringify(searchResult, null, 2);
            } else {
                return "검색 결과가 없습니다.";
            }

        } catch (error) {
            logger.error(`[Tool Error] ${error.message}`);
            return "오류가 발생했습니다.";
        }
    },
    {
        name: "product_db_search",
        description: `
        쇼핑몰의 제품 가격과 바코드(QR) 정보를 조회합니다.
        [답변 작성 규칙]
        1. **가격**: "OO은 000원이야!" 형태로 안내하세요.
        2. **QR코드**: 조회 결과에 'qrCodeUrl'이 존재하면, 답변 마지막에 반드시 아래 마크다운 이미지 형식을 추가하세요.
           ![제품QR코드](qrCodeUrl값)
        3. 여러 제품이 조회되면 QR코드를 안내하지 말고, 각 제품의 가격만 짧게 반말로 나열한 뒤 "바코드가 필요한 제품이 있어?"라고 물어보세요.
        `,
        schema: z.object({
            productName: z.string().describe("검색할 카테고리명 또는 제품 키워드"),
        }),
    }
);

const tools = [productSearchTool];
const toolNode = new ToolNode(tools);

// ==========================================
// 2. LangGraph 모델 및 그래프 설정
// ==========================================
const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash-lite",
    maxTokens: 1024,
    apiKey: process.env.GOOGLE_API_KEY
});

const modelWithTools = model.bindTools(tools, {
    tool_choice: "auto",
});

const memory = new MemorySaver();

async function chatbotNode(state) {
    const { messages } = state;
    
    const systemMessage = messages.filter(m => m._getType() === "system").pop(); 
    const chatHistory = messages.filter(m => m._getType() !== "system");
    let recentMessages = chatHistory.slice(-10); 

    // Gemini 순서 규칙 준수 (User로 시작)
    while (recentMessages.length > 0 && recentMessages[0]._getType() !== "human") {
        logger.info(`🧹 [History Trimming] Gemini 규칙 준수를 위해 '${recentMessages[0]._getType()}' 메시지를 기록에서 제외합니다.`);
        recentMessages.shift();
    }

    const inputMessages = systemMessage ? [systemMessage, ...recentMessages] : recentMessages;
    const response = await modelWithTools.invoke(inputMessages);
    return { messages: [response] };
}

function routeTools(state) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.tool_calls?.length > 0) {
        return "tools";
    }
    return END;
}

const workflow = new StateGraph(MessagesAnnotation)
    .addNode("chatbot", chatbotNode)
    .addNode("tools", toolNode)
    .addEdge(START, "chatbot")
    .addConditionalEdges("chatbot", routeTools, { tools: "tools", [END]: END })
    .addEdge("tools", "chatbot");

const appGraph = workflow.compile({ checkpointer: memory });

// ==========================================
// 3. API Exports
// ==========================================

// [LangGraph] 대화 생성
exports.generate = async function(req, res) {
    const userPrompt = req.body.prompt;
    const userRole = req.body.role;
    const threadId = req.body.sessionId || "default_user";

    logger.info(`[Request] Prompt: "${userPrompt}", Session: ${threadId}`);

    try {
        if (!userPrompt) throw new Error("Prompt is missing.");

        const defaultSystemMessage = `
            넌 귀여운 소품점인 근육고양이잡화점의 근육고양이봇이야. 반말로 짧게 대답해줘.
            사용자가 제품(가격, 재고 등)에 대해 물어보면 **즉시 'product_db_search' 도구를 호출하세요.**
            질문이 사장님 등의 호칭으로 시작할 경우 호칭을 무시하고 질문의 핵심 내용만 파악해서 대답해줘.
            제품에 대한 질문이 아닐 경우 일상적인 대화로 자연스럽게 답변해줘.

            [중요한 규칙]
            1. **"검색해볼게", "잠시만 기다려", "확인해겠습니다" 같은 말을 절대 먼저 하지 마세요.**
            2. 사용자의 질문을 받자마자 **아무런 말 없이 도구(JSON)부터 실행**하세요.
            3. 도구 실행 결과가 나오면 그때 답변하세요.
        `;

        const systemMessageContent = userRole ? userRole : defaultSystemMessage;

        const inputs = {
            messages: [
                new SystemMessage(systemMessageContent),
                new HumanMessage(userPrompt)
            ]
        };

        const config = {
            configurable: { thread_id: threadId }
        };

        const result = await appGraph.invoke(inputs, config);
        const lastMessage = result.messages[result.messages.length - 1];
        
        res.send(lastMessage.content);

    } catch (error) {
        logger.error(`[LangGraph Error] ${error.message}`);
        // Fallback
        try {
            const fallbackResponse = await callOpenAI(userPrompt);
            res.send(fallbackResponse);
        } catch (fbError) {
            res.status(500).send({ message: error.message });
        }
    }
};

// [Search] 단순 검색 (데이터 기반 or 일반)
exports.search = async function(req, res) {
    try {
        let prompt = req.body.prompt;
        let data = req.body.data;
        let finalPrompt = "";

        if (data) {
            finalPrompt = `Based on the following data: \n\n${data}\n\nAnswer the question: "${prompt}"\n\nPlease provide a simple answer under 100 words in Korean.\n\n`;
        } else {
            finalPrompt = `${prompt}\n\nPlease provide a simple answer under 100 words in Korean.`;
        }

        try {
            // 1. Gemini
            const text = await callGemini(finalPrompt);
            res.send({result:"success", op:"search_gemini", message:text});
        } catch (geminiError) {
            logger.warn(`Gemini search failed (falling back to OpenAI): ${geminiError.message}`);
            try {
                // 2. OpenAI Fallback
                const text = await callOpenAI(finalPrompt); 
                res.send({result:"success", op:"search_openai_fallback", message:text});
            } catch (openaiError) {
                logger.error(`Fallback OpenAI search also failed: ${openaiError.message}`);
                throw new Error(`Both models failed. Gemini: ${geminiError.message}, OpenAI: ${openaiError.message}`);
            }
        }
    } catch(e) {
        logger.error("search error (after fallback): " + e.message); 
        res.send({result:"fail", message: e.message});
    }
};

// [Chat] 일반 채팅 (OpenAI 우선 -> Gemini Fallback)
exports.generateChat = async function(req, res) {
    try {
        let prompt = req.body.prompt;
        
        try {
            const text = await callOpenAI(prompt);
            res.send({ result: "success", op: "generateChat_openai", message: text });
        } catch (openaiError) {
            logger.warn(`OpenAI chat failed (falling back to Gemini): ${openaiError.message}`);
            try {
                const text = await callGemini(prompt); 
                res.send({ result: "success", op: "generateChat_gemini_fallback", message: text });
            } catch (geminiError) {
                logger.error(`Fallback Gemini chat also failed: ${geminiError.message}`);
                throw new Error(`Both models failed. OpenAI: ${openaiError.message}, Gemini: ${geminiError.message}`);
            }
        }
    } catch (e) {
        logger.error("generateChat 오류 (after fallback):", e);
        res.send({ result: "fail", message: e.message });
    }
};