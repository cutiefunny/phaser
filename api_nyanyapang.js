const logger = require("./logger");
const { db, admin } = require('./firebaseConfig');
const moment = require('moment');

const COLLECTION_NAME = "nyanyapang_scores";

// ==========================================
// 냐냐팡 점수 CRUD
// ==========================================

/**
 * 점수 저장 (Create) - 중복 제거 로직 포함
 * @param {string} name - 플레이어 이름
 * @param {number} score - 획득 점수
 * @param {string} deviceId - 디바이스 ID
 * @returns {Promise<object>} 저장 결과
 */
exports.saveScore = async function(name, score, deviceId) {
    try {
        // 같은 name과 deviceId를 가진 기존 문서들 조회
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('name', '==', name)
            .where('deviceId', '==', deviceId)
            .orderBy('score', 'desc')
            .get();
        
        const existingDocs = [];
        snapshot.forEach(doc => {
            existingDocs.push({
                id: doc.id,
                score: doc.data().score
            });
        });

        // 새로운 점수가 기존의 최고 점수보다 높으거나 같으면 저장
        if (existingDocs.length === 0 || score >= existingDocs[0].score) {
            const param = {
                name: name,
                score: score,
                deviceId: deviceId,
                createTm: moment().format('YYYY-MM-DD HH:mm:ss'),
                createTs: new Date()
            };
            
            const docRef = db.collection(COLLECTION_NAME).doc();
            await docRef.set(param);
            logger.info(`Score saved - Name: ${name}, Score: ${score}, DeviceId: ${deviceId}, Time: ${param.createTm}`);
            
            // 새로운 점수가 저장된 후 같은 name+deviceId에서 더 낮은 점수의 문서들 삭제
            if (existingDocs.length > 0) {
                const batch = db.batch();
                existingDocs.forEach(doc => {
                    if (doc.score < score) {
                        batch.delete(db.collection(COLLECTION_NAME).doc(doc.id));
                    }
                });
                await batch.commit();
                logger.info(`Deleted ${existingDocs.filter(d => d.score < score).length} lower score records for Name: ${name}, DeviceId: ${deviceId}`);
            }
            
            return {
                result: "success",
                data: param
            };
        } else {
            // 새로운 점수가 기존 최고 점수보다 낮으면 저장하지 않음
            logger.info(`Score not saved - Lower than existing high score. Name: ${name}, New Score: ${score}, Existing High Score: ${existingDocs[0].score}`);
            return {
                result: "skip",
                message: `Score ${score} is lower than existing high score ${existingDocs[0].score}`,
                data: null
            };
        }
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
 * @param {string} deviceId - 디바이스 ID (선택사항)
 * @returns {Promise<array>} 플레이어의 점수 목록
 */
exports.getPlayerScores = async function(name, deviceId = null) {
    try {
        let query = db.collection(COLLECTION_NAME)
            .where('name', '==', name);
        
        if (deviceId) {
            query = query.where('deviceId', '==', deviceId);
        }
        
        const snapshot = await query
            .orderBy('createTs', 'desc')
            .get();
        
        const result = [];
        snapshot.forEach(doc => {
            result.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        logger.info(`Retrieved ${result.length} scores for player: ${name}${deviceId ? ` (DeviceId: ${deviceId})` : ''}`);
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
 * 전체 플레이어 순위 조회 (디바이스별)
 * @param {string} deviceId - 디바이스 ID (선택사항)
 * @param {number} limit - 조회할 개수 (기본값: 100)
 * @returns {Promise<array>} 플레이어별 최고 점수 순위
 */
exports.getAllPlayerRankings = async function(deviceId = null, limit = 100) {
    try {
        let query = db.collection(COLLECTION_NAME);
        
        if (deviceId) {
            query = query.where('deviceId', '==', deviceId);
        }
        
        const snapshot = await query
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
        
        logger.info(`Retrieved ${result.length} player rankings${deviceId ? ` for DeviceId: ${deviceId}` : ''}`);
        return result;
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
        const { name, score, deviceId } = req.body;
        
        if (!name || score === undefined || !deviceId) {
            return res.status(400).send({
                result: "error",
                message: "name, score, and deviceId are required"
            });
        }
        
        if (typeof score !== 'number' || score < 0) {
            return res.status(400).send({
                result: "error",
                message: "score must be a non-negative number"
            });
        }
        
        const result = await exports.saveScore(name, score, deviceId);
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
        const { name, deviceId } = req.query;
        
        if (!name) {
            return res.status(400).send({
                result: "error",
                message: "name is required"
            });
        }
        
        const result = await exports.getPlayerScores(name, deviceId || null);
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

/**
 * Express 라우터용 플레이어별 순위 조회 핸들러
 */
exports.getAllPlayerRankingsHandler = async function(req, res) {
    try {
        const { deviceId } = req.query;
        const limit = parseInt(req.query.limit) || 100;
        
        const result = await exports.getAllPlayerRankings(deviceId || null, limit);
        res.send({
            result: "success",
            data: result
        });
    } catch (err) {
        logger.error("Error in getAllPlayerRankingsHandler: ", err);
        res.status(500).send({
            result: "error",
            message: err.message
        });
    }
};
