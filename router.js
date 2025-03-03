const CRUD= require("./CRUD");
const moment = require('moment');
require('dotenv').config();
const axios = require('axios');
const common = require('./common');

let local = "N";
if(common.getServerIp() == "58.140.59.218") local = "Y";

exports.main = async function (req,res){
    res.render('main', { title: 'main'         
                        ,local:local
                });
}

exports.wallball = async function (req,res){
    res.render('wallball', { title: 'wallball shot'         
                            ,local:local
                });
}

exports.adventure = async function (req,res){
    res.render('adventure', { title: 'crossfit adventure'       
                             ,local:local  
                });
}