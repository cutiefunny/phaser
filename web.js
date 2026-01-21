console.log('=== [DEBUG 1] 프로그램 시작 ===');

const express = require('express');
const app = express();

// Docker 환경변수 포트 우선 사용
const port = process.env.PORT || 8000;

console.log('=== [DEBUG 2] 기본 모듈 로딩 완료. dotenv 설정 시작 ===');
require('dotenv').config();
const router = require('./router');
const CRUD = require("./CRUD");
const API = require("./API");
const common = require('./common');
console.log('=== [DEBUG 7] 외부 라이브러리(cron, axios, redis, cors) 로딩 ===');
const cron = require('node-cron');
const axios = require('axios');
const redis = require('redis');
const cors = require('cors'); 

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
  optionsSuccessStatus: 200 
};

console.log('=== [DEBUG 8] Express 설정(CORS, View Engine) 적용 ===');
app.use(cors(corsOptions)); 

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));
app.use('/images',express.static(__dirname + "/images"));
app.use(express.json({ limit: '50mb' }));

console.log('=== [DEBUG 9] 라우트(GET/POST) 연결 시작 ===');

// router 변수가 없을 경우를 대비해 안전하게 연결
    app.get('/', router.main);
    app.get('/main', router.main2);
    app.get('/wallball', router.wallball);
    app.get('/adventure', router.adventure);
    app.get('/seoulData', router.seoulData);
    app.get('/productAdmin', router.productAdmin);

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

    //제품 crud
    app.post('/saveProduct', API.saveProduct);
    app.post('/updateProduct', API.updateProduct);
    app.post('/deleteProduct', API.deleteProduct);

console.log(`=== [DEBUG 10] 서버 리스닝 시도 (Port: ${port}) ===`);

app.listen(port, '0.0.0.0', () => {
  console.log(`=== [SUCCESS] 서버가 정상적으로 실행되었습니다! Port: ${port} ===`);
});

// 크론잡 설정
cron.schedule('0 * * * *', async () => {
  if (new Date().getHours() === 0) {
    console.log('한투 토큰 갱신');
    await generateToken();

    // console.log('오늘의 운세 생성');
    // if (API) await API.getDailyFortune(null, null);
  }else if (new Date().getHours() === 7) {
    console.log('Concept2 스냅샷 저장 API 호출');
    try {
      // 기존에 로딩된 axios를 사용하여 호출
      await axios.get('https://khanfit.vercel.app/api/snapshot');
      console.log('Concept2 스냅샷 저장 성공');
    } catch (error) {
      // 에러가 발생해도 서버가 죽지 않도록 예외 처리
      console.error('Concept2 스냅샷 저장 실패:', error.message);
    }
  }else if (new Date().getHours() === 8) {
    console.log('오늘의 운세톡 발송');
    if (API) await API.sendFortune(null, null);
  }
  // 매 시간마다 E-ink 뉴스 업데이트
  console.log('뉴스 업데이트');
  if (API) await API.getNews(null, null);
});

async function generateToken() {
  try {
      // (기존 코드 동일)
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
          EX: 24 * 60 * 60 
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