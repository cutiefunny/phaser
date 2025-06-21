const CRUD= require("./CRUD");
const moment = require('moment');
require('dotenv').config();
const axios = require('axios');
const common = require('./common');
const e = require("express");

let local = "N";
if(common.getServerIp() != "210.114.17.65") local = "Y";

exports.main = async function (req,res){
    res.render('main', { title: 'main'         
                        ,local:local
                });
}

exports.main2 = async function (req,res){
    let scoreList = await CRUD.searchData("getScore","wallballshot");
    let ip = common.getServerIp();

    res.render('main2', { title: 'main2'         
                        ,local:local
                        ,ip:ip
                        ,scoreList:scoreList
                });
}

exports.wallball = async function (req,res){

    let scoreList = await CRUD.searchData("getScore","wallballshot");

    res.render('wallball', { title: 'wallball shot'         
                            ,local:local
                            ,scoreList:scoreList
                });
}

exports.adventure = async function (req,res){
    res.render('adventure', { title: 'crossfit adventure'       
                             ,local:local  
                });
}

exports.seoulData = async function (req,res){
    //let seoulData = await CRUD.searchDataMysql("getAllData");
    let label = "[전체조회]";
    let ref = req.query.ref;
    let baseUrl = "http://openapi.seoul.go.kr:8088/716b4b676e637574393056636d6650/json/citydata_ppltn/1/23/POI"
    let result = [];
    let allData = [];
    let local = "N";
    if(common.getServerIp() == "192.168.0.14") local = "Y";

    for(var i=1;i<117;i++){
        let url = baseUrl + i.toString().padStart(3,"0");
        try{
            let info = await axios.get(url).then(response => response.data["SeoulRtd.citydata_ppltn"][0]);
            delete info.FCST_PPLTN;
            result.push(info);
        }catch(e){
            console.log({label:label,message:e});
        }
    }

    allData = result;
    if(ref=="male") result.sort((a, b) => b.MALE_PPLTN_RATE - a.MALE_PPLTN_RATE); //남성 비율 내림차순 정렬
    else if(ref=="female") result.sort((a, b) => b.FEMALE_PPLTN_RATE - a.FEMALE_PPLTN_RATE); //여성 비율 내림차순 정렬
    else if(ref=="nonresnt") result.sort((a, b) => b.NON_RESNT_PPLTN_RATE - a.NON_RESNT_PPLTN_RATE); //비거주인구 내림차순 정렬
    else if(ref=="20") result.sort((a, b) => b.PPLTN_RATE_20 - a.PPLTN_RATE_20); //20대 비율 내림차순 정렬
    else if(ref=="30") result.sort((a, b) => b.PPLTN_RATE_30 - a.PPLTN_RATE_30); //30대 비율 내림차순 정렬
    else if(ref=="40") result.sort((a, b) => b.PPLTN_RATE_40 - a.PPLTN_RATE_40); //40대 비율 내림차순 정렬
    else result.sort((a, b) => b.AREA_PPLTN_MAX - a.AREA_PPLTN_MAX); //최대인원 내림차순 정렬

    result = result.slice(0, 10);

    //console.log({label:label,message:"result/"+ref+" : " + common.jsonEnter(JSON.stringify(result))});

    res.render('seoulData', { title: '서울 데이터'
        , local : local
        , result : result
        , allData : JSON.stringify(allData)
    });   
}

exports.getLiveMatchInfo = async function (req, res) {
    console.log("getLiveMatchInfo : " + JSON.stringify(req.query));
    const url = 'https://www.betman.co.kr/matchinfo/inqMainLivescreMchList.do';
    const headers = {
        'Content-Type': 'application/json',
    };
    const data = {
        "schDate": req.query.schDate || "2025.06.21",
        "_sbmInfo": {
            "_sbmInfo": {
                "debugMode": "false"
            }
        }
    };

    try {
        const response = await axios.post(url, data, { headers });
        res.send({ result: "success", data: response.data });
    } catch (error) {
        console.error("getLiveMatchInfo error: " + error.message);
        res.send({ result: "fail", message: error.message });
    }
};