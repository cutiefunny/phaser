const express = require('express');
const app = express();
const port = 8000;
require('dotenv').config();
const router = require('./router');
const CRUD= require("./CRUD");
const API= require("./API");
const common = require('./common');
const cron = require('node-cron');

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));
app.use('/images',express.static(__dirname + "/images"));
app.use('/manifest.json',express.static(__dirname + "/manifest.json"));
app.use('/service-worker.js',express.static(__dirname + "/service-worker.js"));
app.use(express.json({ limit: '50mb' }));

app.get('/', router.main);
app.get('/main', router.main2);
app.get('/wallball', router.wallball);
app.get('/adventure', router.adventure);
app.get('/seoulData', router.seoulData);

app.post('/saveScore', API.saveScore);
app.post('/search', API.search);
app.post('/processAudio', API.processAudio);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

cron.schedule('0 * * * *', async () => {
    await API.getSearchMusclecat();
});