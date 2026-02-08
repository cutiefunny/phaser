const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const logger = require("./logger"); 
require('dotenv').config();

/**
 * [헬퍼] Gemini API 호출
 */
exports.callGemini = async function(prompt) {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("Google API Key is missing in .env");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (!text) throw new Error("Gemini returned empty text.");
        return text.trim();

    } catch (error) {
        let errorMsg = error.message;
        if (error.response) {
            errorMsg = JSON.stringify(error.response);
        }
        logger.warn(`[_callGemini] Error: ${errorMsg}`);
        throw error;
    }
};

/**
 * [헬퍼] OpenAI API 호출
 */
exports.callOpenAI = async function(prompt) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OpenAI API Key is missing in .env");

        const url = 'https://api.openai.com/v1/chat/completions';
        
        const response = await axios.post(url, {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a helpful news summarizer." },
                { role: "user", content: prompt }
            ],
            temperature: 0.5,
            max_completion_tokens: 600
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        if (
            response.data && 
            response.data.choices && 
            response.data.choices.length > 0 && 
            response.data.choices[0].message &&
            response.data.choices[0].message.content
        ) {
            return response.data.choices[0].message.content.trim();
        } else {
            logger.error(`[OpenAI Error] Invalid response structure: ${JSON.stringify(response.data)}`);
            throw new Error("OpenAI response structure is invalid (content missing).");
        }

    } catch (error) {
        if (error.response) {
            logger.error(`[OpenAI API Error] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            throw new Error(`OpenAI API Error: ${error.response.data.error?.message || error.message}`);
        }
        throw error;
    }
};

/**
 * [SNS용] Gemini AI 호출 (감정/공감 캐릭터, 존댓말)
 * - 감정과 공감을 중시하는 따뜻한 성격
 * - 사용자의 감정을 이해하고 공감하는 답변
 * - 항상 존댓말 사용
 */
exports.callGeminiSNS = async function(prompt) {
    try {
        const characterPrefix = `
인터넷에서 흔히 볼 수 있는 반말체로 간결하게 작성해줘.
`;

        const fullPrompt = characterPrefix + prompt;
        
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("Google API Key is missing in .env");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        if (!text) throw new Error("Gemini returned empty text.");
        return text.trim();

    } catch (error) {
        let errorMsg = error.message;
        if (error.response) {
            errorMsg = JSON.stringify(error.response);
        }
        logger.warn(`[callGeminiSNS] Error: ${errorMsg}`);
        throw error;
    }
};

/**
 * [SNS용] OpenAI (GPT) 호출 (정보/사실 캐릭터, 반말)
 * - 정보와 사실을 중시하는 논리적인 성격
 * - 객관적인 정보, 설명, 분석 위주로 답변
 * - 항상 반말 사용
 */
exports.callOpenAISNS = async function(prompt) {
    try {
        const characterPrefix = `
인터넷에서 흔히 볼 수 있는 반말체로 간결하게 작성해줘.
`;

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OpenAI API Key is missing in .env");

        const url = 'https://api.openai.com/v1/chat/completions';
        
        const response = await axios.post(url, {
            model: "gpt-5-nano",
            messages: [
                { role: "system", content: characterPrefix },
                { role: "user", content: prompt }
            ],
            max_completion_tokens: 2000
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (
            response.data && 
            response.data.choices && 
            response.data.choices.length > 0 && 
            response.data.choices[0].message &&
            response.data.choices[0].message.content
        ) {
            return response.data.choices[0].message.content.trim();
        } else {
            logger.error(`[OpenAI SNS Error] Invalid response structure: ${JSON.stringify(response.data)}`);
            throw new Error("OpenAI response structure is invalid (content missing).");
        }

    } catch (error) {
        if (error.response) {
            logger.error(`[OpenAI SNS API Error] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            throw new Error(`OpenAI API Error: ${error.response.data.error?.message || error.message}`);
        }
        throw error;
    }
};

/**
 * [SNS용] Exaone (Ollama) 호출 (균형잡힌 관점, 반말)
 * - Ollama에서 실행되는 exaone3.5:7.8b-instruct-q4_K_M 모델
 * - 항상 반말 사용
 */
exports.callExaoneSNS = async function(prompt) {
    try {
        const characterPrefix = `
인터넷에서 흔히 볼 수 있는 반말체로 간결하게 작성해줘.
`;

        const baseUrl = process.env.LOCAL_PC_AI_URL || 'http://localhost:11434';
        const url = `${baseUrl}/api/chat`;
        
        const response = await axios.post(url, {
            model: "exaone3.5:7.8b-instruct-q4_K_M",
            messages: [
                { role: "system", content: characterPrefix },
                { role: "user", content: prompt }
            ],
            stream: false
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 180000
        });

        if (
            response.data && 
            response.data.message &&
            response.data.message.content
        ) {
            return response.data.message.content.trim();
        } else {
            logger.error(`[Exaone SNS Error] Invalid response structure: ${JSON.stringify(response.data)}`);
            throw new Error("Exaone response structure is invalid (content missing).");
        }

    } catch (error) {
        if (error.response) {
            logger.error(`[Exaone SNS API Error] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            throw new Error(`Exaone API Error: ${error.response.data?.error || error.message}`);
        }
        throw error;
    }
};

/**
 * [헬퍼] Exaone 채팅 API 호출 (일반 대화용)
 * - 환경에 따라 로컬(q4_K_M)과 서버(7.8b) 모델 구분
 * - Model Not Found 발생 시 자동 Fallback 처리
 */
exports.callExaone = async function(messages, systemPrompt = "You are a helpful assistant.") {
    try {
        const baseUrl = process.env.LOCAL_PC_AI_URL || 'http://localhost:11434';
        const url = `${baseUrl}/api/chat`;
        
        // 1. 환경에 따른 기본 모델 결정
        let targetModel = "exaone3.5:7.8b-instruct-q4_K_M";

        const formattedMessages = [
            { role: "system", content: systemPrompt },
            ...messages
        ];

        // API 호출을 위한 내부 함수
        const fetchAI = async (modelName) => {
            return await axios.post(url, {
                model: modelName,
                messages: formattedMessages,
                stream: false
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 180000
            });
        };

        let response;
        try {
            // 2. 1차 시도
            response = await fetchAI(targetModel);
        } catch (firstError) {
            // 3. 'model not found' 에러가 발생한 경우 예비 모델로 2차 시도
            const errorMsg = firstError.response?.data?.error || firstError.message;
            
            if (errorMsg.includes('not found') && targetModel === "exaone3.5:7.8b-instruct-q4_K_M") {
                logger.warn(`[Exaone] ${targetModel} 모델이 없습니다. exaone3.5:7.8b로 재시도합니다.`);
                targetModel = "exaone3.5:7.8b";
                response = await fetchAI(targetModel);
            } else {
                // 다른 종류의 에러라면 그대로 상위 catch로 던짐
                throw firstError;
            }
        }

        // 4. 응답 처리
        if (
            response.data && 
            response.data.message &&
            response.data.message.content
        ) {
            return response.data.message.content.trim();
        } else {
            logger.error(`[Exaone Error] Invalid response structure: ${JSON.stringify(response.data)}`);
            throw new Error("Exaone response structure is invalid (content missing).");
        }

    } catch (error) {
        if (error.response) {
            logger.error(`[Exaone API Error] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            throw new Error(`Exaone API Error: ${error.response.data?.error || error.message}`);
        }
        logger.error(`[Exaone Error] ${error.message}`);
        throw error;
    }
};