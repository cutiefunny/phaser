const logger = require("./logger");
const { db, admin } = require('./firebaseConfig');
const moment = require('moment');

const COLLECTION_NAME = "nyanyapang_scores";

// ==========================================
// 냐냐팡 점수 CRUD
// ==========================================

/**
 * 점수 저장 (Create)
 * @param {string} name - 플레이어 이름
 * @param {number} score - 획득 점수
 * @returns {Promise<object>} 저장 결과
 */
exports.saveScore = async function(name, score) {
    try {
        const param = {
            name: name,
            score: score,
            createTm: moment().format('YYYY-MM-DD HH:mm:ss'),
            createTs: new Date()
        };
        
        const docRef = db.collection(COLLECTION_NAME).doc();
        await docRef.set(param);
        logger.info(`Score saved - Name: ${name}, Score: ${score}, Time: ${param.createTm}`);
        
        return {
            result: "success",
            data: param
        };
    } catch (err) {
        logger.error("Error saving score: ", err);
        return {
            result: "error",
            message: err.message
        };
    }
};

/**
 * 최근 점수 조회 (Read)
 * @param {number} limit - 조회할 개수 (기본값: 10)
 * @returns {Promise<array>} 점수 목록
 */
exports.getRecentScores = async function(limit = 10) {
    try {
        const snapshot = await db.collection(COLLECTION_NAME)
            .orderBy('score', 'desc')
            .limit(limit)
            .get();
        
        const result = [];
        snapshot.forEach(doc => {
            result.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        logger.info(`Retrieved ${result.length} recent scores`);
        return result;
    } catch (err) {
        logger.error("Error retrieving scores: ", err);
        return [];
    }
};

/**
 * 특정 플레이어의 점수 조회
 * @param {string} name - 플레이어 이름
 * @returns {Promise<array>} 플레이어의 점수 목록
 */
exports.getPlayerScores = async function(name) {
    try {
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('name', '==', name)
            .orderBy('score', 'desc')
            .get();
        
        const result = [];
        snapshot.forEach(doc => {
            result.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        logger.info(`Retrieved ${result.length} scores for player: ${name}`);
        return result;
    } catch (err) {
        logger.error("Error retrieving player scores: ", err);
        return [];
    }
};

/**
 * 오늘의 상위 점수 조회
 * @param {number} limit - 조회할 개수 (기본값: 10)
 * @returns {Promise<array>} 오늘의 상위 점수 목록
 */
exports.getTodayTopScores = async function(limit = 10) {
    try {
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();
        
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('createTs', '>=', todayStart)
            .where('createTs', '<=', todayEnd)
            .orderBy('createTs', 'desc')
            .orderBy('score', 'desc')
            .limit(limit)
            .get();
        
        const result = [];
        snapshot.forEach(doc => {
            result.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        logger.info(`Retrieved today's top ${result.length} scores`);
        return result;
    } catch (err) {
        logger.error("Error retrieving today's top scores: ", err);
        return [];
    }
};

/**
 * 일주일간의 상위 점수 조회
 * @param {number} limit - 조회할 개수 (기본값: 10)
 * @returns {Promise<array>} 일주일간의 상위 점수 목록
 */
exports.getWeeklyTopScores = async function(limit = 10) {
    try {
        const weekAgo = moment().subtract(7, 'days').toDate();
        
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('createTs', '>=', weekAgo)
            .orderBy('createTs', 'desc')
            .orderBy('score', 'desc')
            .limit(limit)
            .get();
        
        const result = [];
        snapshot.forEach(doc => {
            result.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        logger.info(`Retrieved weekly top ${result.length} scores`);
        return result;
    } catch (err) {
        logger.error("Error retrieving weekly top scores: ", err);
        return [];
    }
};

/**
 * 전체 플레이어 순위 조회
 * @param {number} limit - 조회할 개수 (기본값: 100)
 * @returns {Promise<array>} 플레이어별 최고 점수 순위
 */
exports.getAllPlayerRankings = async function(limit = 100) {
    try {
        // 이는 MongoDB aggregation이 필요한 경우가 있으므로
        // 별도 처리 필요
        logger.info(`Retrieved all player rankings`);
        
        return [];
    } catch (err) {
        logger.error("Error retrieving player rankings: ", err);
        return [];
    }
};

/**
 * 점수 삭제 (Delete)
 * @param {string} id - 점수 문서 ID
 * @returns {Promise<object>} 삭제 결과
 */
exports.deleteScore = async function(id) {
    try {
        await db.collection(COLLECTION_NAME).doc(id).delete();
        logger.info(`Score deleted - ID: ${id}`);
        
        return {
            result: "success",
            message: "Score deleted successfully"
        };
    } catch (err) {
        logger.error("Error deleting score: ", err);
        return {
            result: "error",
            message: err.message
        };
    }
};

/**
 * Express 라우터용 점수 저장 핸들러
 */
exports.saveScorerHandler = async function(req, res) {
    try {
        const { name, score } = req.body;
        
        if (!name || score === undefined) {
            return res.status(400).send({
                result: "error",
                message: "name and score are required"
            });
        }
        
        if (typeof score !== 'number' || score < 0) {
            return res.status(400).send({
                result: "error",
                message: "score must be a non-negative number"
            });
        }
        
        const result = await exports.saveScore(name, score);
        res.send(result);
    } catch (err) {
        logger.error("Error in saveScorerHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};

/**
 * Express 라우터용 최근 점수 조회 핸들러
 */
exports.getRecentScoresHandler = async function(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const result = await exports.getRecentScores(limit);
        res.send({
            result: "success",
            data: result
        });
    } catch (err) {
        logger.error("Error in getRecentScoresHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};

/**
 * Express 라우터용 플레이어 점수 조회 핸들러
 */
exports.getPlayerScoresHandler = async function(req, res) {
    try {
        const { name } = req.query;
        
        if (!name) {
            return res.status(400).send({
                result: "error",
                message: "name is required"
            });
        }
        
        const result = await exports.getPlayerScores(name);
        res.send({
            result: "success",
            data: result
        });
    } catch (err) {
        logger.error("Error in getPlayerScoresHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};

/**
 * Express 라우터용 오늘의 상위 점수 조회 핸들러
 */
exports.getTodayTopScoresHandler = async function(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const result = await exports.getTodayTopScores(limit);
        res.send({
            result: "success",
            data: result
        });
    } catch (err) {
        logger.error("Error in getTodayTopScoresHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};

/**
 * Express 라우터용 주간 상위 점수 조회 핸들러
 */
exports.getWeeklyTopScoresHandler = async function(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const result = await exports.getWeeklyTopScores(limit);
        res.send({
            result: "success",
            data: result
        });
    } catch (err) {
        logger.error("Error in getWeeklyTopScoresHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};
