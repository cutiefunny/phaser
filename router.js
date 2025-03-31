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
    let seoulData = await CRUD.searchDataMysql("getAllData");
    res.render('seoulData', { title: 'seoulData' 
                             ,local:local
                             ,seoulData:seoulData
                });
}