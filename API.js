const CRUD= require("./CRUD");
const moment = require('moment');
const router = require('./router');
require('dotenv').config();
const cheerio = require('cheerio');
const axios = require('axios');
const common = require('./common');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("./logger");
const genAI = new GoogleGenerativeAI("AIzaSyASJx4A2dk0LIt_8U_aeJfCKGLMqmrtjZg");
const fs = require('fs');
const e = require("express");

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

//텔레그램 업데이트 수집
exports.collectTelegramUpdates = async function(req, res) {
    const teleURL = 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/getUpdates';

    try {
        const response = await axios.get(teleURL);
        const updates = response.data.result;
        let stockPrice = "";
        let beforePrice = "";

        const collectedTexts = updates
            .filter(update => update.channel_post && update.channel_post.text && 
            (moment.unix(update.channel_post.date).isAfter(moment().subtract(10, 'seconds'))))
            .map(update => ({
            text: update.channel_post.text,
            chatId: update.channel_post.chat.id,
            date: moment.unix(update.channel_post.date).format('YYYY-MM-DD HH:mm:ss'),
            }));
        
        for (const text of collectedTexts) {
            let prompt = text.text;
            let name = "";
            if (prompt.includes("주가") || prompt.includes("현재가")) {
                name = prompt.split(" ")[0];
                if (name === "네이버") {
                    name = "NAVER";
                }
                const stockData = JSON.parse(fs.readFileSync('./krx-stock.json', 'utf8'));
                const stock = stockData.find(item => item.name.trim() === name);
                if (stock) {
                    const code = stock.code;
                    let stockInfo = null;
                    const koreaInvestmentResponse = await axios.get(
                        "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=UN&FID_INPUT_ISCD="+code,
                        {
                            headers: {
                                "Content-Type": "application/json",
                                "authorization": "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ0b2tlbiIsImF1ZCI6ImNiMmViNzkzLTA0YWMtNGZmMS05NTZiLWY5NzU0NWUwODNmYiIsInByZHRfY2QiOiIiLCJpc3MiOiJ1bm9ndyIsImV4cCI6MTc0Njg1MDcyOSwiaWF0IjoxNzQ2NzY0MzI5LCJqdGkiOiJQUzJNOFA5RmE5VHBkZ1ZHekxWcnIwWmdjOW9GU0dFRDdac2YifQ.cVxts633x1nhhJt2S7QG_bAi1d0W1fAA9g712m3nrxlFPgNhT-xAWQyR7VxX1ngZqMcM3Ixo5helwNn9iQ9YnQ", // Replace with your actual access token
                                "appkey": "PS2M8P9Fa9TpdgVGzLVrr0Zgc9oFSGED7Zsf", // Replace with your app key
                                "appsecret": "79QrQtanIHzf9FR194WGfqDex8D7cwKAs68ZSHlSpM/UUf/H73piVwcOYM9sucIDLVRPAC1P8LEXETfmcJYuLGIj9NF/Mv26UlzOZ9ZC1mZNxZG58CWJ5oaWCWgt/NuchiFYnBl9V2sCNItI3oRkdMrZmZ/gb5DUVjEazK+a9FY3jQmaBrg=", // Replace with your app secret
                                "tr_id": "FHKST01010100", // Transaction ID for the API
                            }
                        }
                    );

                    if (koreaInvestmentResponse.status === 200) {
                        stockInfo = koreaInvestmentResponse.data;

                        stockPrice = stockInfo.output.stck_prpr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        beforePrice = stockInfo.output.prdy_vrss.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " (" + stockInfo.output.prdy_ctrt + "%)";

                        const sendMessageOptions = {
                            method: 'POST',
                            url: 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/sendMessage',
                            headers: { 'Content-Type': 'application/json' },
                            data: {
                                chat_id: text.chatId,
                                text: `종목명: ${name}\n현재가: ${stockPrice}\n전일대비: ${beforePrice}`
                            }
                        };
                        try {
                            await axios(sendMessageOptions);
                        } catch (error) {
                            logger.error("Error sending stock info to Telegram: " + error.message);
                        }

                        let url = `https://openapi.naver.com/v1/search/news.json?query=${prompt}&display=30`;
                        const naverResponse = await fetch(url, {
                            method: "GET",
                            headers: {
                                "X-Naver-Client-Id": "rpSwp30UzjYedQbVkC5Q",
                                "X-Naver-Client-Secret": "QTbXNdCGVN"
                            },
                        });
                        const naverData = await naverResponse.json();

                        let addPrompt = "\n 이 데이터로 질문에 대해 간단히 답변을 해줘. 주가데이터와 뉴스를 참고해서 시장동향을 300자 이내로 간단히 요약해줘.";

                        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
                        const result = await model.generateContent(prompt+ "\n 주가 데이터 : " + JSON.stringify(stockInfo) + "\n 뉴스 데이터 : " + JSON.stringify(naverData.items) + addPrompt);
                        const response2 = await result.response;
                        var text2 = response2.text();
                        text2 = text2.replace(/\:\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '\n');
                        text2 = text2.replace(/\([^)]*\)/g, '');
                        const sendMessageOptions2 = {
                            method: 'POST',
                            url: 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/sendMessage',
                            headers: { 'Content-Type': 'application/json' },
                            data: { chat_id: text.chatId, text: text2 }
                        };
                        try {
                            await axios(sendMessageOptions2);
                        } catch (error) {
                            logger.error("Error sending news info to Telegram: " + error.message);
                        }
                    } else {
                        console.error("한국투자증권 API 호출 실패:", koreaInvestmentResponse.statusText);
                    }

                }
            }
        }


        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17"});


        // for (const text of collectedTexts) {
        //     const options = {
        //         method: 'POST',
        //         url: 'https://api.telegram.org/bot8094077738:AAHjnDVzy7rvbQ53QxDi4GTZUyWvrj8AUts/sendMessage',
        //         headers: { 'Content-Type': 'application/json' },
        //         data: { chat_id: text.chatId, text: text.text }
        //     };
        //     try {
        //         await axios(options);
        //     } catch (error) {
        //         logger.error("Error sending message to Telegram: " + error.message);
        //     }
        // }
    } catch (error) {
        logger.error("collectTelegramUpdates error: " + error.message);
    }
}

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

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
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