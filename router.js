const CRUD= require("./CRUD");
const moment = require('moment');
require('dotenv').config();
const axios = require('axios');
const common = require('./common');

let local = "N";
if(common.getServerIp() == "58.140.59.218") local = "Y";

exports.main = async function (req,res){

    let scoreList = await CRUD.searchData("getScore","wallballshot");
    console.log("scoreList : "+JSON.stringify(scoreList));

    res.render('main', { title: 'main'         
                        ,local:local
                        ,scoreList:scoreList
                });
}

exports.wallball = async function (req,res){

    let scoreList = await CRUD.searchData("getScore","wallballshot");
    console.log("scoreList : "+JSON.stringify(scoreList));

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