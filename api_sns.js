const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const moment = require('moment');

// 컬렉션 이름 상수 정의
const COL_POSTS = 'sns_posts';
const COL_COMMENTS = 'sns_comments';

// ==========================================
// 1. 게시글 (Post) CRUD
// ==========================================

/**
 * 게시글 목록 조회 (피드)
 * - 최신순 정렬
 * - E-ink 렌더링을 위해 날짜 포맷팅 처리
 */
exports.getPosts = async function(req, res) {
    try {
        const limit = req.body.limit ? parseInt(req.body.limit) : 10;
        
        // 최신순 조회
        const snapshot = await db.collection(COL_POSTS)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        if (snapshot.empty) {
            return res.send({ result: "success", data: [] });
        }

        const posts = snapshot.docs.map(doc => {
            const data = doc.data();
            const dateObj = data.createdAt ? data.createdAt.toDate() : new Date();
            
            // [날짜 포맷] 오늘이면 "14:30", 아니면 "02-05" (짧게)
            const isToday = moment(dateObj).isSame(new Date(), "day");
            const timeStr = isToday ? moment(dateObj).format('HH:mm') : moment(dateObj).format('MM-DD');

            return {
                id: doc.id,
                author: data.author || 'User', // 'User', 'Gemini', 'GPT'
                content: data.content,
                likes: data.likes || 0,
                commentCount: data.commentCount || 0,
                time: timeStr,
                timestamp: dateObj.getTime() // 정렬이나 디테일용 원본
            };
        });

        res.send({ result: "success", data: posts });

    } catch (e) {
        logger.error(`[SNS] getPosts Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 게시글 작성
 * - 작성자(author): 'User', 'Gemini', 'GPT'
 */
exports.createPost = async function(req, res) {
    try {
        const { author, content } = req.body;

        if (!content) {
            return res.send({ result: "fail", message: "내용이 없습니다." });
        }

        const newPost = {
            author: author || 'User',
            content: content,
            likes: 0,
            commentCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COL_POSTS).add(newPost);
        
        logger.info(`[SNS] New Post by ${newPost.author}: ${docRef.id}`);
        res.send({ result: "success", postId: docRef.id });

    } catch (e) {
        logger.error(`[SNS] createPost Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 게시글 삭제
 * - (선택 사항) 댓글 컬렉션까지 지우려면 배치가 필요하지만, 일단 글만 숨김/삭제 처리
 */
exports.deletePost = async function(req, res) {
    try {
        const { postId } = req.body;
        if (!postId) return res.send({ result: "fail", message: "Post ID missing" });

        await db.collection(COL_POSTS).doc(postId).delete();
        
        // (심화) 연결된 댓글 삭제 로직은 필요시 추가
        
        logger.info(`[SNS] Post Deleted: ${postId}`);
        res.send({ result: "success" });

    } catch (e) {
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 좋아요 증가 (단순 카운트)
 */
exports.likePost = async function(req, res) {
    try {
        const { postId } = req.body;
        const postRef = db.collection(COL_POSTS).doc(postId);

        await postRef.update({
            likes: admin.firestore.FieldValue.increment(1)
        });

        res.send({ result: "success" });
    } catch (e) {
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// 2. 댓글 (Comment) CRUD
// ==========================================

/**
 * 특정 게시글의 댓글 조회
 */
exports.getComments = async function(req, res) {
    try {
        const { postId } = req.body;
        if (!postId) return res.send({ result: "fail", message: "Post ID missing" });

        // 오래된 순(작성순)으로 정렬하여 대화 흐름 유지
        const snapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'asc') 
            .get();

        const comments = snapshot.docs.map(doc => {
            const data = doc.data();
            const dateObj = data.createdAt ? data.createdAt.toDate() : new Date();
            const timeStr = moment(dateObj).format('MM-DD HH:mm');

            return {
                id: doc.id,
                postId: data.postId,
                author: data.author,
                content: data.content,
                time: timeStr
            };
        });

        res.send({ result: "success", data: comments });

    } catch (e) {
        logger.error(`[SNS] getComments Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 댓글 작성
 * - 댓글 저장 + 부모 글의 commentCount 증가 (Transaction 사용)
 */
exports.addComment = async function(req, res) {
    try {
        const { postId, author, content } = req.body;

        if (!postId || !content) {
            return res.send({ result: "fail", message: "필수 정보 누락" });
        }

        const postRef = db.collection(COL_POSTS).doc(postId);
        const commentRef = db.collection(COL_COMMENTS).doc(); // 새 ID 생성

        await db.runTransaction(async (t) => {
            const postDoc = await t.get(postRef);
            if (!postDoc.exists) {
                throw new Error("삭제된 게시글입니다.");
            }

            // 1. 댓글 생성
            t.set(commentRef, {
                postId: postId,
                author: author || 'User',
                content: content,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. 게시글 카운트 증가
            t.update(postRef, {
                commentCount: admin.firestore.FieldValue.increment(1)
            });
        });

        logger.info(`[SNS] New Comment on ${postId} by ${author}`);
        res.send({ result: "success" });

    } catch (e) {
        logger.error(`[SNS] addComment Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};