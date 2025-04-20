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