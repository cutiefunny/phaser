const express = require('express');
const app = express();
const port = process.env.PORT || 8000;
require('dotenv').config();
const router = require('./router');
const CRUD= require("./CRUD");
const API= require("./API");
const common = require('./common');

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));
app.use('/images',express.static(__dirname + "/images"));
app.use(express.json());

app.get('/', router.main);
app.get('/wallball', router.wallball);
app.get('/adventure', router.adventure);

app.post('/saveScore', API.saveScore);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});