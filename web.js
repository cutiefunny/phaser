console.log('=== [DEBUG 1] 프로그램 시작 ===');

const express = require('express');
const app = express();
// [신규] 프록시 미들웨어 추가
const { createProxyMiddleware } = require('http-proxy-middleware');

// Docker 환경변수 포트 우선 사용
const port = process.env.PORT || 8000;

console.log('=== [DEBUG 2] 기본 모듈 로딩 완료. dotenv 설정 시작 ===');
require('dotenv').config();

const router = require('./router');
const CRUD = require("./CRUD");
const common = require('./common');

// 로컬 환경 판단
const isLocal = common.getServerIp() !== "210.114.17.65";
console.log(`=== [DEBUG 2-1] 로컬 환경 판단: ${isLocal ? 'Y (로컬)' : 'N (운영)'} ===`);

// ==================================================================
// [수정] 분산된 API 모듈 로딩
// ==================================================================
// const API = require("./API"); // 기존 통합 파일 주석 처리 또는 삭제
const apiAgent = require('./api_agent'); // 챗봇, 검색, LangGraph
const apiNews = require('./api_news');   // 뉴스 수집 및 조회
const apiMisc = require('./api_misc');   // 운세, 상품관리, 알림톡, 기타
const apiSns = require('./api_sns');   // SNS 게시글 및 댓글 관리
const apiOpenClaw = require('./api_openclaw'); // OpenClaw 스타일 웹 크롤링
const apiNyanyapang = require('./api_nyanyapang'); // 냐냐팡 점수 CRUD

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
    'https://clt-chatbot.vercel.app',
    'http://202.20.84.65:10001',
    'http://202.20.84.65:10000',
    'https://musclecat-studio.com',
    'https://stock-info-smoky.vercel.app',
    'https://eink-news.vercel.app',
    'https://musclecat-sns.vercel.app',
    'https://nyanyapang.com',
    'https://www.nyanyapang.com',
    'https://musclecat-class.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

console.log('=== [DEBUG 8] Express 설정(CORS, View Engine) 적용 ===');
app.use(cors(corsOptions)); 

// ==================================================================
// [신규] 프록시 설정 (반드시 express.json() 보다 위에 위치해야 함)
// ==================================================================
app.use('/fastapi', createProxyMiddleware({
    target: 'http://210.114.17.65:8001', // 실제 내부 HTTP 서버 주소
    changeOrigin: true, 
    pathRewrite: {
        '^/fastapi': '' 
    },
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyReq.getHeader('host')}${proxyReq.path}`);
    },
    onError: (err, req, res) => {
        console.error('[Proxy Error]', err);
        res.status(500).send('Proxy Error');
    }
}));
// ==================================================================

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));
app.use('/images',express.static(__dirname + "/images"));

// 바디 파서는 프록시 설정 뒤에 와야 함
app.use(express.json({ limit: '50mb' }));

console.log('=== [DEBUG 9] 라우트(GET/POST) 연결 시작 ===');

// [GET] 페이지 렌더링 (router.js 사용 - 변경 없음)
app.get('/', router.main);
app.get('/lesson', router.lesson);
app.get('/main', router.main2);
app.get('/wallball', router.wallball);
app.get('/adventure', router.adventure);
app.get('/seoulData', router.seoulData);
app.get('/productAdmin', router.productAdmin);

// [GET] Google Scripts 연결
app.get('/260405', (req, res) => {
  res.redirect('https://script.google.com/macros/s/AKfycbzyK72_3rDRhHeETinA0CKOPq0OWe8kmI8ZCG_H0P908cMT-COZP5edDPH3Ao6yyVNnuw/exec');
});
// [POST] 분산된 API 연결

// 1. Agent 관련 (채팅, 검색) -> api_agent.js
app.post('/search', apiAgent.search);
app.post('/generate', apiAgent.generate);
app.post('/generateChat', apiAgent.generateChat);

// 2. News 관련 (뉴스 수집, 조회) -> api_news.js
app.post('/getNews', apiNews.getNews);
app.post('/getEinkNews', apiNews.getEinkNews);

// 3. Misc 관련 (운세, 알림톡, 게임정보, 상품관리 등) -> api_misc.js
app.post('/saveScore', apiMisc.saveScore);
app.post('/getLiveMatchInfo', apiMisc.getLiveMatchInfo);
app.post('/inqMainGameInfo', apiMisc.inqMainGameInfo);

app.post('/getDailyFortune', apiMisc.getDailyFortune);
app.post('/getOneFortune', apiMisc.getOneFortune);
app.post('/sendKakaotalk', apiMisc.sendKakaotalk);
app.post('/sendClassConfirmation', apiMisc.sendClassConfirmation);
app.post('/sendClassWaiting', apiMisc.sendClassWaiting);
app.post('/sendClassChange', apiMisc.sendClassChange);
app.post('/sendFortune', apiMisc.sendFortune);

// Exaone 채팅 API
app.post('/chatExaone', apiMisc.chatExaone);

// 4. SNS 관련 (E-ink SNS)
app.post('/sns/getPosts', apiSns.getPosts);       // 피드 불러오기
app.post('/sns/createPost', apiSns.createPost);   // 글 쓰기
app.post('/sns/deletePost', apiSns.deletePost);   // 글 삭제
app.post('/sns/likePost', apiSns.likePost);       // 좋아요
app.post('/sns/getComments', apiSns.getComments); // 댓글 보기
app.post('/sns/addComment', apiSns.addComment);   // 댓글 쓰기
app.post('/sns/updateComment', apiSns.updateComment); // 댓글 수정
app.post('/sns/deleteComment', apiSns.deleteComment); // 댓글 삭제
app.post('/sns/autoCreatePost', apiSns.autoCreatePost); // AI 자동 게시
app.post('/sns/autoAddComment', apiSns.autoAddComment); // AI 자동 댓글
app.post('/sns/autoDeleteOldPosts', apiSns.autoDeleteOldPosts); // 24시간 지난 게시글 자동 삭제
app.post('/sns/postWikiTrendDaily', apiSns.postWikiTrendDaily); // WikiTrend 포스팅 (테스트용)
// app.get('/sns/getTrend', apiSns.getTrend); // Ezme 실시간 트렌드 - 비활성화됨
app.get('/sns/getItTrend', apiSns.getItTrend); // 긱뉴스 IT 트렌드
app.get('/sns/getStockTrend', apiSns.getStockTrend); // 한국경제 주식 트렌드

// 제품 CRUD -> api_misc.js
app.post('/saveProduct', apiMisc.saveProduct);
app.post('/updateProduct', apiMisc.updateProduct);
app.post('/deleteProduct', apiMisc.deleteProduct);
app.post('/productInfo', apiMisc.productInfo);

// 5. 냐냐팡 게임 관련 (점수 관리) -> api_nyanyapang.js
app.post('/nyanyapang/saveScore', apiNyanyapang.saveScorerHandler);
app.post('/nyanyapang/getRecentScores', apiNyanyapang.getRecentScoresHandler);
app.post('/nyanyapang/getPlayerScores', apiNyanyapang.getPlayerScoresHandler);
app.post('/nyanyapang/getTodayTopScores', apiNyanyapang.getTodayTopScoresHandler);
app.post('/nyanyapang/getWeeklyTopScores', apiNyanyapang.getWeeklyTopScoresHandler);
app.post('/nyanyapang/getAllPlayerRankings', apiNyanyapang.getAllPlayerRankingsHandler);

// OpenClaw 스타일 웹 크롤링 API -> api_openclaw.js
app.post('/openclaw/youtube', apiOpenClaw.getYoutubeTitles);
app.post('/openclaw/namu', apiOpenClaw.getNamuwikiTrend);
app.post('/openclaw/getNamu', apiOpenClaw.startNamuwikiSchedule);

console.log(`=== [DEBUG 10] 서버 리스닝 시도 (Port: ${port}) ===`);

app.listen(port, '0.0.0.0', () => {
  console.log(`=== [SUCCESS] 서버가 정상적으로 실행되었습니다! Port: ${port} ===`);
  // if(isLocal) { // 나무위키 스케줄은 로컬에서만 실행
  //   // 트렌드 캐시 초기화 (서버 시작 시)
  //   if (apiSns && apiSns.initTrendCache) {
  //     console.log('[SNS] 트렌드 캐시 초기화 시작...');
  //     apiSns.initTrendCache().then(() => {
  //       console.log('[SNS] 트렌드 캐시 초기화 완료');
  //     }).catch(err => {
  //       console.error('[SNS] 트렌드 캐시 초기화 실패:', err.message);
  //     });
  //   }

  //   // 나무위키 트렌드 자동 갱신 시작 (1시간마다)
  //   if (apiOpenClaw && apiOpenClaw.startNamuwikiSchedule) {
  //     apiOpenClaw.startNamuwikiSchedule().catch(err => {
  //       console.error('[OpenClaw] 나무위키 스케줄 시작 실패:', err.message);
  //     });
  //   }
  // }
});

// ==================================================================
// [수정] 크론잡 설정 (분산된 모듈 함수 호출)
// 로컬 환경에서는 크론잡 비활성화 (나무위키 스케줄 제외)
// ==================================================================
  cron.schedule('0 * * * *', async () => {
    const currentHour = new Date().getHours();

    if (currentHour === 0) {
      console.log('한투 토큰 갱신');
      await generateToken();

      // 매일 밤 12시 서울 날씨 포스팅
      console.log('서울 날씨 자동 포스팅');
      if (apiSns) await apiSns.postWeatherDaily();

      // console.log('오늘의 운세 생성');
      // if (apiMisc) await apiMisc.getDailyFortune(null, null);

    } else if (currentHour === 7) {
      // console.log('Concept2 스냅샷 저장 API 호출');
      // try {
      //   await axios.get('https://khanfit.vercel.app/api/snapshot');
      //   console.log('Concept2 스냅샷 저장 성공');
      // } catch (error) {
      //   console.error('Concept2 스냅샷 저장 실패:', error.message);
      // }

    } else if (currentHour === 8) {
      // console.log('오늘의 운세톡 발송');
      // // API.sendFortune -> apiMisc.sendFortune
      // if (apiMisc) await apiMisc.sendFortune(null, null);
    }

    // 매 시간 뉴스 업데이트
    console.log('뉴스 업데이트');
    // API.getNews -> apiNews.getNews
    if (apiNews) await apiNews.getNews(null, null);
    
    // WikiTrend 기반 포스팅 (매 시간)
    // console.log('WikiTrend 포스팅 시도');
    // if (apiSns) await apiSns.postWikiTrendDaily();
    
    // AI 자동 게시글 작성 (매 시간)
    // console.log('AI 자동 게시글 작성 시도');
    // if (apiSns) await apiSns.autoCreatePost(null, null);
    
    // AI 자동 댓글 작성 (매 시간)
    // console.log('AI 자동 댓글 작성 시도');
    // if (apiSns) await apiSns.autoAddComment(null, null);
    
    // 24시간 지난 게시글 자동 삭제 (매 시간)
    console.log('오래된 게시글 삭제 시도');
    if (apiSns) await apiSns.autoDeleteOldPosts(null, null);
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