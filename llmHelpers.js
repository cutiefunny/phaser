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