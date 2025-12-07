const express = require('express');
const app = express();
const port = 8000;
require('dotenv').config();
const router = require('./router');
const CRUD= require("./CRUD");
const API= require("./API");
const common = require('./common');
const cron = require('node-cron');
const axios = require('axios');
const redis = require('redis');
const cors = require('cors'); // 💡 1. cors 패키지 불러오기

// 💡 2. CORS 미들웨어 설정
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8000',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://musclecat-chat.vercel.app',
    'https://react-flow-three-ecru.vercel.app',
    'https://clt-chatbot.vercel.app/',
    'http://202.20.84.65:10001/',
    'http://202.20.84.65:10000/',
    'https://musclecat-studio.com',
    'https://stock-info-smoky.vercel.app',
    'https://eink-news.vercel.app'
  ],
  optionsSuccessStatus: 200 // 일부 레거시 브라우저를 위한 설정
};

app.use(cors(corsOptions)); // 💡 3. CORS 미들웨어를 Express 앱에 적용

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
app.post('/getLiveMatchInfo', API.getLiveMatchInfo);
app.post('/inqMainGameInfo', API.inqMainGameInfo);
app.post('/generate', API.generate);
app.post('/generateChat', API.generateChat);
app.post('/getDailyFortune', API.getDailyFortune);
app.post('/getOneFortune', API.getOneFortune);
app.post('/sendKakaotalk', API.sendKakaotalk);
app.post('/sendFortune', API.sendFortune);
app.post('/getNews', API.getNews);
app.post('/getEinkNews', API.getEinkNews);
app.post('/generate-tts', API.generateTTS);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

cron.schedule('0 * * * *', async () => {
  if (new Date().getHours() === 0) {
    console.log('한투 토큰 갱신');
    await generateToken();
    console.log('오늘의 운세 생성');
    await API.getDailyFortune(null, null);
  }else if (new Date().getHours() === 8) {
    console.log('오늘의 운세톡 발송');
    await API.sendFortune(null, null);
  }
  // 매 시간마다 E-ink 뉴스 업데이트
  console.log('뉴스 업데이트');
  await API.getNews(null, null);
});

async function generateToken() {
  try {
      const response = await axios.post('https://openapi.koreainvestment.com:9443/oauth2/tokenP?', {
        "appkey":process.env.HANTU_APP,
        "appsecret":process.env.HANTU_SECRET,
        "grant_type":"client_credentials",
      });
      const accessToken = response.data.access_token;

      const redisClient = redis.createClient({
        username: process.env.REDIS_USER,
        password: process.env.REDIS_PASSWORD,
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT
        }
      });

      await redisClient.connect();

      try {
        await redisClient.set('access_token', accessToken, {
          EX: 24 * 60 * 60 // 16 hours in seconds
        });
        console.info('한투 토큰 갱신 : ' + accessToken);
      } catch (err) {
        console.error('Error saving access token to Redis:', err);
      } finally {
        await redisClient.disconnect();
      }
    } catch (error) {
      console.error('Error fetching access token:', error);
    }
}