const moment = require('moment');
const { MongoClient } = require("mongodb");
const fs = require('fs');
const common = require('./common');

//몽고DB 연결
const uri =
  "mongodb+srv://cutiefunny:ghks1015@macrodb.srkli.mongodb.net/macroDB?retryWrites=true&w=majority";
    // "mongodb://acorns:acorns1234@64.176.42.251/:27017?authMechanism=DEFAULT&authSource=admin";
const client = new MongoClient(uri);
client.connect();
const db = client.db("game");

//Create
exports.insertData = async function (col,param){
    var collection = db.collection(col);
     
    await collection.insertOne(param).then((result) => {
        //console.log("insert success");
    });
}

//Read
exports.searchData = async function (op,col,param){
    var collection = db.collection(col);
    var res;

    if(op=="getScore"){
        res = await collection.find().sort({ score: -1 }).toArray();
    }
    
    return res;
}

//Update
exports.updateData = async function (op,col,param){
    var collection = db.collection(col);
    if(op=="bet"){
        var filter = {id:param.id,round:param.round,gameName:param.gameName,siteName:param.siteName};
        var doc = {$set:param};
    }else if(op=="saveSite"){
        var filter = {siteName:param.siteName};
        var doc = {$set:{siteName:param.siteName,siteUrl:param.siteUrl,apiKey:param.apiKey,callbackUrl:param.callbackUrl,createTm:param.createTm}};
    }else if(op=="result"){
        var filter = {create_dt:param.create_dt,game:param.game};
        var doc = {$set:param}
    }else if(op=="rateManage"){
        var filter = {siteName:param.siteName,game:param.game};
        var doc = {$set:param}
    }else if(op=="userResult"){
        var filter = {gameName:param.gameName,round:param.round,id:param.id};
        param.date = Number(moment().format('YYYYMMDD'));
        var doc = {$set:param}
    }else if(op=="balance"){
        var filter = {id:param.id,site:param.site};
        var doc = {$set:{balance:param.balance,updateTm:moment().format('YYYY-MM-DD HH:mm:ss')}}
    }else if(op=="addBalance"){
        var filter = {id:param.id,site:param.site};
        var doc = {$inc:{balance:param.balance},$set:{updateTm:moment().format('YYYY-MM-DD HH:mm:ss')}}
    }else if(op=="updateIssue"){
        var filter = {id:param.id};
        var doc = {$set:param}
    }else if(op=="updateFiles"){
        var filter = {id:param.id};
        var doc = { $addToSet: { files: param.file } }
    }else if(op=="deleteFile"){
        var filter = {id:param.id};
        var doc = { $pull: { files: param.file } }
    }
    await collection.updateOne(filter,doc,{upsert:true}).then((result) => {
        //console.log("update success");
    });
}

//Delete
exports.deleteData = async function (op,col,param){
    var collection = db.collection(col);
    if(op=="deleteSite"){
        var filter = {siteName:param.siteName};
    }else if(op=="deleteIssue"){
        var filter = {id:param.id};
    }

    await collection.deleteOne(filter).then((result) => {
        console.log("delete success");
    });
}