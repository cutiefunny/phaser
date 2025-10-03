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
const cors = require('cors');

// ==========================================================
// 💡 영상통화 서버 추가 시작 (모듈 불러오기)
// ==========================================================
const http = require('http');
const { Server } = require("socket.io");
// ==========================================================
// 💡 영상통화 서버 추가 끝
// ==========================================================

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://musclecat-chat.vercel.app',
    'http://localhost:5173',
    'https://react-flow-three-ecru.vercel.app',
    'https://live-cam-eta.vercel.app'
  ],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));
app.use('/images',express.static(__dirname + "/images"));
app.use('/manifest.json',express.static(__dirname + "/manifest.json"));
app.use('/service-worker.js',express.static(__dirname + "/service-worker.js"));
app.use(express.json({ limit: '50mb' }));

// ==========================================================
// 💡 영상통화 서버 추가 시작 (서버 생성 및 Socket.io 연결)
// ==========================================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin, // 기존 corsOptions와 동일하게 설정
    methods: ["GET", "POST"],
  },
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("a user connected for video chat");

  socket.on("join room", (roomID) => {
    if (rooms[roomID]) {
      // 방에 다른 사용자가 이미 있는 경우
      const otherUsers = rooms[roomID];
      rooms[roomID].push(socket.id);
      socket.join(roomID);

      // 간단하게 첫 번째 사용자와 연결하도록 수정 (다자간을 위해서는 로직 변경 필요)
      const usersInThisRoom = rooms[roomID].filter(id => id !== socket.id);
      socket.emit("all users", usersInThisRoom);

    } else {
      // 방을 새로 만드는 경우
      rooms[roomID] = [socket.id];
      socket.join(roomID);
    }
    
    socket.on("sending signal", (payload) => {
      io.to(payload.userToSignal).emit("user joined", {
        signal: payload.signal,
        callerID: payload.callerID,
      });
    });

    socket.on("returning signal", (payload) => {
      io.to(payload.callerID).emit("receiving returned signal", {
        signal: payload.signal,
        id: socket.id,
      });
    });

    socket.on("disconnect", () => {
        const roomID = Object.keys(rooms).find((key) => rooms[key].includes(socket.id));
        let room = rooms[roomID];
        if (room) {
            room = room.filter(id => id !== socket.id);
            rooms[roomID] = room;
            if (room.length === 0) {
                delete rooms[roomID];
                return;
            }
        }
        socket.broadcast.to(room).emit('user left', socket.id);
        console.log("user disconnected from video chat");
    });
  });
});
// ==========================================================
// 💡 영상통화 서버 추가 끝
// ==========================================================


// 기존 라우터 설정
app.get('/', router.main);
app.get('/main', router.main2);
app.get('/wallball', router.wallball);
app.get('/adventure', router.adventure);
app.get('/seoulData', router.seoulData);

app.post('/saveScore', API.saveScore);
app.post('/search', API.search);
app.post('/processAudio', API.processAudio);
app.post('/getLiveMatchInfo', API.getLiveMatchInfo);
app.post('/inqMainGameInfo', API.inqMainGameInfo);
app.post('/generate', API.generate);

// 기존 app.listen을 server.listen으로 변경
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

cron.schedule('0 * * * *', async () => {
  if (new Date().getHours() === 0) {
    console.log('한투 토큰 갱신');
    await generateToken();
  }
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
          EX: 24 * 60 * 60 // 24 hours in seconds
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