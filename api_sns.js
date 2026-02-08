const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const moment = require('moment');
const { callGemini, callOpenAI, callGeminiSNS, callOpenAISNS, callExaoneSNS } = require('./llmHelpers');
const axios = require('axios');
const cheerio = require('cheerio');

// 컬렉션 이름 상수 정의
const COL_POSTS = 'sns_posts';
const COL_COMMENTS = 'sns_comments';

// ==========================================
// AI 작성자 이름 관리 (한 곳에서 관리)
// ==========================================

// DB에 저장되는 키 값
const AUTHOR_KEYS = {
    GEMINI: 'Gemini',
    GPT: 'GPT',
    HANKYUNG: 'Hankyung',
    GEEKNEWS: 'GeekNews',
    EXAONE: 'Exaone',
    USER: '근육고양이'
};

// 화면에 표시되는 닉네임
const AUTHOR_DISPLAY_NAMES = {
    'Gemini': '잼미니',
    'GPT': '쥐피티',
    'Hankyung': '여의도',
    'GeekNews': '공돌이뉴스',
    'Exaone': '라마',
    '근육고양이': '근육고양이'
};

// Exaone이 로컬에서 호출되는지 서버에서 호출되는지 판단하는 헬퍼 함수
function getExaoneSource() {
    const baseUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434';
    // localhost 또는 127.0.0.1이 포함되어 있으면 로컬, 아니면 서버
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        return 'local';
    } else {
        return 'server';
    }
}

// 키 값을 닉네임으로 변환하는 함수
function getDisplayName(authorKey, exaoneSource) {
    // Exaone의 경우 저장된 exaoneSource 정보로 닉네임 설정
    if (authorKey === 'Exaone') {
        if (exaoneSource === 'local') {
            return '빠른 라마';
        } else if (exaoneSource === 'server') {
            return '느린 라마';
        } else {
            // exaoneSource 정보가 없는 경우 (기존 데이터 호환성)
            return '라마';
        }
    }
    return AUTHOR_DISPLAY_NAMES[authorKey] || authorKey;
}

// Exaone 사용 가능 여부 캐시 (1분마다 재확인)
let exaoneAvailable = false;
let lastExaoneCheck = 0;
const EXAONE_CHECK_INTERVAL = 60000; // 1분

// IT/주식 트렌드 캐시 (6시간마다 갱신)
let itTrendCache = [];
let stockTrendCache = [];
let lastItTrendUpdate = 0;
let lastStockTrendUpdate = 0;
const TREND_CACHE_INTERVAL = 6 * 60 * 60 * 1000; // 6시간

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
                author: getDisplayName(data.author || AUTHOR_KEYS.USER, data.exaoneSource),
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
            author: author || AUTHOR_KEYS.USER,
            content: content,
            likes: 0,
            commentCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COL_POSTS).add(newPost);
        
        logger.info(`[SNS] New Post by ${newPost.author}: ${docRef.id}`);
        
        // User가 작성한 게시글이면 AI가 즉각 댓글 작성 (번갈아가며)
        if (newPost.author === AUTHOR_KEYS.USER) {
            logger.info(`[SNS] Triggering immediate AI comment for User's post`);
            // 비동기로 실행하여 응답 지연 방지
            setImmediate(() => {
                replyToPost(docRef.id, content).catch(err => {
                    logger.error(`[SNS] Failed to create AI reply: ${err.message}`);
                });
            });
        }
        
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
                author: getDisplayName(data.author, data.exaoneSource),
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
                author: author || AUTHOR_KEYS.USER,
                content: content,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. 게시글 카운트 증가
            t.update(postRef, {
                commentCount: admin.firestore.FieldValue.increment(1)
            });
        });

        logger.info(`[SNS] New Comment on ${postId} by ${author}`);
        
        // User가 작성한 댓글이면 AI가 즉각 답변 댓글 작성 (번갈아가며)
        if ((author || '근육고양이') === '근육고양이') {
            logger.info(`[SNS] Triggering immediate AI reply for User's comment`);
            // 비동기로 실행하여 응답 지연 방지
            setImmediate(() => {
                replyToPost(postId, content).catch(err => {
                    logger.error(`[SNS] Failed to create AI reply: ${err.message}`);
                });
            });
        }
        
        res.send({ result: "success" });

    } catch (e) {
        logger.error(`[SNS] addComment Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 댓글 수정
 * - 댓글 내용만 업데이트
 */
exports.updateComment = async function(req, res) {
    try {
        const { commentId, content } = req.body;

        if (!commentId || !content) {
            return res.send({ result: "fail", message: "필수 정보 누락" });
        }

        const commentRef = db.collection(COL_COMMENTS).doc(commentId);
        const commentDoc = await commentRef.get();

        if (!commentDoc.exists) {
            return res.send({ result: "fail", message: "존재하지 않는 댓글입니다." });
        }

        await commentRef.update({
            content: content,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info(`[SNS] Comment Updated: ${commentId}`);
        res.send({ result: "success" });

    } catch (e) {
        logger.error(`[SNS] updateComment Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

/**
 * 댓글 삭제
 * - 댓글 삭제 + 부모 글의 commentCount 감소 (Transaction 사용)
 */
exports.deleteComment = async function(req, res) {
    try {
        const { commentId } = req.body;

        if (!commentId) {
            return res.send({ result: "fail", message: "Comment ID missing" });
        }

        const commentRef = db.collection(COL_COMMENTS).doc(commentId);
        const commentDoc = await commentRef.get();

        if (!commentDoc.exists) {
            return res.send({ result: "fail", message: "존재하지 않는 댓글입니다." });
        }

        const postId = commentDoc.data().postId;
        const postRef = db.collection(COL_POSTS).doc(postId);

        await db.runTransaction(async (t) => {
            // 1. 댓글 삭제
            t.delete(commentRef);

            // 2. 게시글 카운트 감소
            const postDoc = await t.get(postRef);
            if (postDoc.exists) {
                t.update(postRef, {
                    commentCount: admin.firestore.FieldValue.increment(-1)
                });
            }
        });

        logger.info(`[SNS] Comment Deleted: ${commentId} from post ${postId}`);
        res.send({ result: "success" });

    } catch (e) {
        logger.error(`[SNS] deleteComment Error: ${e.message}`);
        res.send({ result: "fail", message: e.message });
    }
};

// ==========================================
// 3. AI 자율 게시글 작성
// ==========================================

/**
 * 24시간이 지난 게시글 자동 삭제
 * - Cron에서 호출
 * - 게시글과 관련된 댓글도 함께 삭제
 */
exports.autoDeleteOldPosts = async function(req, res) {
    try {
        // 24시간 전 시간 계산
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        // 24시간 이전에 작성된 게시글 조회
        const oldPostsSnapshot = await db.collection(COL_POSTS)
            .where('createdAt', '<', admin.firestore.Timestamp.fromDate(twentyFourHoursAgo))
            .get();

        if (oldPostsSnapshot.empty) {
            logger.info(`[SNS] No old posts to delete.`);
            if (res) return res.send({ result: "success", message: "No old posts to delete" });
            return;
        }

        let deletedCount = 0;
        const batch = db.batch();

        for (const postDoc of oldPostsSnapshot.docs) {
            const postId = postDoc.id;
            
            // 해당 게시글의 댓글들도 삭제
            const commentsSnapshot = await db.collection(COL_COMMENTS)
                .where('postId', '==', postId)
                .get();

            commentsSnapshot.docs.forEach(commentDoc => {
                batch.delete(commentDoc.ref);
            });

            // 게시글 삭제
            batch.delete(postDoc.ref);
            
            deletedCount++;
            logger.info(`[SNS] Marking post ${postId} and its ${commentsSnapshot.size} comments for deletion`);
        }

        // 배치 실행
        await batch.commit();

        logger.info(`[SNS] Auto deleted ${deletedCount} old posts (older than 24 hours)`);
        
        if (res) res.send({ 
            result: "success", 
            deletedCount: deletedCount,
            message: `${deletedCount} old posts deleted`
        });

    } catch (e) {
        logger.error(`[SNS] autoDeleteOldPosts Error: ${e.message}`);
        if (res) res.send({ result: "fail", message: e.message });
    }
};

/**
 * AI가 자율적으로 최근 게시글에 댓글 작성
 * - Cron에서 호출
 * - 가장 최근 게시글 확인
 * - 자신이 작성한 글이 아니면 적절한 댓글 작성
 */
exports.autoAddComment = async function(req, res) {
    try {
        // 1. 가장 최근 게시글 확인
        const recentPostSnapshot = await db.collection(COL_POSTS)
            .orderBy('createdAt', 'desc')
            .limit(3)
            .get();

        if (recentPostSnapshot.empty) {
            logger.info(`[SNS] No posts available for commenting.`);
            if (res) return res.send({ result: "success", message: "No posts to comment" });
            return;
        }

        const postDoc = recentPostSnapshot.docs[0];
        const postData = postDoc.data();
        const postId = postDoc.id;
        const postAuthor = postData.author;
        const postContent = postData.content;

        // 2. 해당 게시글의 댓글들을 확인하여 다음 댓글 작성자 결정
        const commentsSnapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let nextCommenter = AUTHOR_KEYS.GEMINI; // 기본값
        
        if (!commentsSnapshot.empty) {
            const lastComment = commentsSnapshot.docs[0].data();
            // 마지막 댓글이 Gemini면 GPT, GPT면 Gemini (Exaone 제외)
            if (lastComment.author === AUTHOR_KEYS.GEMINI) {
                nextCommenter = AUTHOR_KEYS.GPT;
            } else if (lastComment.author === AUTHOR_KEYS.GPT) {
                nextCommenter = AUTHOR_KEYS.GEMINI;
            } else if (lastComment.author === AUTHOR_KEYS.EXAONE) {
                // Exaone 댓글은 순환에서 제외, 이전 Gemini/GPT 댓글 찾기
                const prevComments = await db.collection(COL_COMMENTS)
                    .where('postId', '==', postId)
                    .orderBy('createdAt', 'desc')
                    .limit(10)
                    .get();
                
                for (const doc of prevComments.docs) {
                    const author = doc.data().author;
                    if (author === AUTHOR_KEYS.GEMINI) {
                        nextCommenter = AUTHOR_KEYS.GPT;
                        break;
                    } else if (author === AUTHOR_KEYS.GPT) {
                        nextCommenter = AUTHOR_KEYS.GEMINI;
                        break;
                    }
                }
            }
        } else {
            // 댓글이 없으면 게시글 작성자와 반대로
            if (postAuthor === AUTHOR_KEYS.GEMINI) {
                nextCommenter = AUTHOR_KEYS.GPT;
            } else if (postAuthor === AUTHOR_KEYS.GPT) {
                nextCommenter = AUTHOR_KEYS.GEMINI;
            }
        }

        // 3. Gemini/GPT는 자신이 작성한 글이면 스킵하지만, Exaone은 계속 진행
        const shouldNextCommenterSkip = (postAuthor === nextCommenter);
        
        if (shouldNextCommenterSkip) {
            logger.info(`[SNS] ${nextCommenter} will skip (own post) but Exaone will process`);
        } else {
            logger.info(`[SNS] Auto comment attempt by: ${nextCommenter} on post by ${postAuthor}`);
        }

        // 4. 최근 5개 댓글만 가져와 컨텍스트로 사용 (토큰 절약)
        const recentCommentsSnapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'desc')
            .limit(5) // 최근 5개만
            .get();

        let existingCommentsText = '';
        if (!recentCommentsSnapshot.empty) {
            // 최근 댓글을 시간순으로 정렬
            const commentsList = recentCommentsSnapshot.docs
                .reverse() // 오래된 순으로 재정렬
                .map(doc => {
                    const data = doc.data();
                    // 댓글 내용도 최대 100자로 제한
                    const truncatedContent = data.content.length > 100 
                        ? data.content.substring(0, 100) + '...' 
                        : data.content;
                    return `${data.author}: ${truncatedContent}`;
                });
            existingCommentsText = '\n\n[최근 댓글 ' + commentsList.length + '개]:\n' + commentsList.join('\n');
        } else {
            existingCommentsText = '\n\n[기존 댓글]: 아직 댓글이 없습니다.';
        }

        // ===== 먼저 Exaone이 사용 가능하면 댓글 작성 (오류 발생 전에 실행) =====
        const isExaoneAvailable = await checkExaoneAvailable();
        if (isExaoneAvailable) {
            // Exaone은 자신의 글에는 댓글을 달지 않음
            if (postAuthor === AUTHOR_KEYS.EXAONE) {
                logger.info(`[SNS] Exaone skipping own post: ${postId}`);
            } else {
                logger.info(`[SNS] Exaone creating auto comment first on post ${postId}`);
                
                try {
                    // Exaone용 프롬프트 (기존 댓글만 참고)
                    const exaonePrompt = `
다음 게시글과 기존 댓글들을 보고 자연스럽고 적절한 댓글을 작성해주세요.

[게시글 작성자]: ${postAuthor}
[게시글 내용]:
${postContent}${existingCommentsText}

[댓글 작성 규칙]:
1. 게시글 내용과 기존 댓글들의 흐름을 고려하여 자연스럽게 작성하세요.
2. 기존 댓글에서 다룬 내용과 중복되지 않도록 새로운 관점이나 의견을 제시하세요.
3. 100자 이내로 간결하게 작성하세요.
4. 자연스러운 한국어로 작성하세요.
5. 게시글 내용이 부적절하거나 댓글을 달 가치가 없다고 판단되면 "SKIP"이라고만 출력하세요.

[금지 사항]:
- 이모지 사용 금지
- 해시태그(#) 사용 금지
- 특수문자(---, ***, 등) 사용 금지
- [댓글 내용], [작성] 같은 메타 텍스트 금지

출력 형식:
- 댓글 작성 안 함: "SKIP"
- 댓글 작성: 댓글 본문만 출력 (다른 텍스트 없이)
`;

                    let exaoneComment = await callExaoneSNS(exaonePrompt);
                    exaoneComment = exaoneComment.trim()
                        .replace(/^---+\s*/gm, '')
                        .replace(/\s*---+$/gm, '')
                        .replace(/^\[댓글 내용\]\s*/i, '')
                        .replace(/^\[작성\]\s*/i, '')
                        .replace(/#\S+/g, '')
                        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
                        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
                        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
                        .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
                        .replace(/[\u{2600}-\u{26FF}]/gu, '')
                        .replace(/[\u{2700}-\u{27BF}]/gu, '')
                        .trim();

                    if (!exaoneComment.includes("SKIP") && exaoneComment.length >= 5) {
                        const postRef = db.collection(COL_POSTS).doc(postId);
                        const exaoneCommentRef = db.collection(COL_COMMENTS).doc();
                        
                        await db.runTransaction(async (t) => {
                            const postDoc = await t.get(postRef);
                            if (!postDoc.exists) {
                                throw new Error("게시글이 삭제되었습니다.");
                            }

                            t.set(exaoneCommentRef, {
                                postId: postId,
                                author: AUTHOR_KEYS.EXAONE,
                                content: exaoneComment,
                                exaoneSource: getExaoneSource(),
                                createdAt: admin.firestore.FieldValue.serverTimestamp()
                            });

                            t.update(postRef, {
                                commentCount: admin.firestore.FieldValue.increment(1)
                            });
                        });
                        
                        logger.info(`[SNS] Exaone Auto Comment Created (priority): ${exaoneComment.substring(0, 50)}...`);
                    } else {
                        logger.info(`[SNS] Exaone decided to skip commenting`);
                    }
                } catch (exaoneError) {
                    logger.error(`[SNS] Exaone auto comment error: ${exaoneError.message}`);
                }
            }
        }

        // ===== 이제 Gemini/GPT 댓글 작성 시도 =====
        // shouldNextCommenterSkip이 true면 자신의 글이므로 스킵
        let geminiGptSuccess = false;
        
        if (shouldNextCommenterSkip) {
            logger.info(`[SNS] ${nextCommenter} skipping own post, moving to Exaone all posts scan`);
            geminiGptSuccess = false;
        } else {
            // 5. AI가 게시글과 기존 댓글들을 보고 댓글 작성
            const prompt = `
다음 게시글과 기존 댓글들을 보고 자연스럽고 적절한 댓글을 작성해주세요.

[게시글 작성자]: ${postAuthor}
[게시글 내용]:
${postContent}${existingCommentsText}

[댓글 작성 규칙]:
1. 게시글 내용과 기존 댓글들의 흐름을 고려하여 자연스럽게 작성하세요.
2. 기존 댓글에서 다룬 내용과 중복되지 않도록 새로운 관점이나 의견을 제시하세요.
3. 100자 이내로 간결하게 작성하세요.
4. 자연스러운 한국어로 작성하세요.
5. 게시글 내용이 부적절하거나 댓글을 달 가치가 없다고 판단되면 "SKIP"이라고만 출력하세요.

[금지 사항]:
- 이모지 사용 금지
- 해시태그(#) 사용 금지
- 특수문자(---, ***, 등) 사용 금지
- [댓글 내용], [작성] 같은 메타 텍스트 금지

출력 형식:
- 댓글 작성 안 함: "SKIP"
- 댓글 작성: 댓글 본문만 출력 (다른 텍스트 없이)
`;

        let commentContent = "";
        
        try {
            if (nextCommenter === 'Gemini') {
                commentContent = await callGeminiSNS(prompt);
            } else if (nextCommenter === 'GPT') {
                commentContent = await callOpenAISNS(prompt);
            } else if (nextCommenter === 'Exaone') {
                commentContent = await callExaoneSNS(prompt);
            } else {
                logger.error(`[SNS] Unknown nextCommenter: ${nextCommenter}`);
                // 오류가 나도 Exaone all posts는 실행하도록 계속 진행
                geminiGptSuccess = false;
            }
            
            if (commentContent) {
                commentContent = commentContent.trim();

                // 응답 정제: 불필요한 메타 텍스트 제거
                commentContent = commentContent
                    .replace(/^---+\s*/gm, '')  // 구분자 제거
                    .replace(/\s*---+$/gm, '')
                    .replace(/^\[댓글 내용\]\s*/i, '')  // 메타 텍스트 제거
                    .replace(/^\[작성\]\s*/i, '')
                    .replace(/#\S+/g, '')  // 해시태그 제거
                    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // 이모지 제거
                    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
                    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
                    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
                    .replace(/[\u{2600}-\u{26FF}]/gu, '')
                    .replace(/[\u{2700}-\u{27BF}]/gu, '')
                    .trim();

                // SKIP 판단 - 댓글 작성하지 않기로 결정
                if (commentContent.includes("SKIP") || commentContent.length < 5) {
                    logger.info(`[SNS] ${nextCommenter} decided to skip commenting.`);
                    geminiGptSuccess = false;
                } else {
                    // 댓글 저장
                    const postRef = db.collection(COL_POSTS).doc(postId);
                    const commentRef = db.collection(COL_COMMENTS).doc();

                    await db.runTransaction(async (t) => {
                        const postDoc = await t.get(postRef);
                        if (!postDoc.exists) {
                            throw new Error("게시글이 삭제되었습니다.");
                        }

                        // 댓글 생성
                        t.set(commentRef, {
                            postId: postId,
                            author: nextCommenter,
                            content: commentContent,
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // 게시글 카운트 증가
                        t.update(postRef, {
                            commentCount: admin.firestore.FieldValue.increment(1)
                        });
                    });

                    logger.info(`[SNS] Auto Comment Created by ${nextCommenter} on post ${postId}`);
                    logger.info(`[SNS] Comment: ${commentContent.substring(0, 50)}...`);
                    geminiGptSuccess = true;
                }
            }
        } catch (error) {
            logger.error(`[SNS] ${nextCommenter} API Error: ${error.message}`);
            // 오류가 나도 Exaone all posts는 실행하도록 계속 진행
            geminiGptSuccess = false;
        }
        } // shouldNextCommenterSkip else 블록 닫기
        
        // Exaone이 활성화되어 있으면 모든 post를 순회하면서 댓글이 없는 post에 댓글 작성
        const isExaoneAvailableForAll = await checkExaoneAvailable();
        if (isExaoneAvailableForAll) {
            logger.info(`[SNS] Exaone scanning all posts for commenting`);
            // 비동기로 실행하여 응답 지연 방지
            setImmediate(() => {
                autoCommentExaoneOnAllPosts().catch(err => {
                    logger.error(`[SNS] Failed to auto-comment on all posts: ${err.message}`);
                });
            });
        }
        
        // 응답 전송
        if (res) {
            if (geminiGptSuccess) {
                res.send({ result: "success", author: nextCommenter });
            } else {
                res.send({ result: "success", message: `${nextCommenter} skipped, but Exaone processed` });
            }
        }

    } catch (e) {
        logger.error(`[SNS] autoAddComment Error: ${e.message}`);
        if (res) res.send({ result: "fail", message: e.message });
    }
};

/**
 * AI가 자율적으로 실시간 이슈/AI 소식을 찾아 게시글 작성
 * - Cron에서 호출
 * - 실시간 트렌드: Gemini/GPT 번갈아 작성 (키워드 검색 기반)
 * - IT/주식 트렌드: RSS 기사를 직접 포스팅 (토큰 절약)
 */
exports.autoCreatePost = async function(req, res) {
    try {
        // 최근 게시글 확인 (마지막 작성자 파악 - realtime용)
        const recentSnapshot = await db.collection(COL_POSTS)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let nextAuthor = AUTHOR_KEYS.GEMINI; // 기본값
        if (!recentSnapshot.empty) {
            const lastPost = recentSnapshot.docs[0].data();
            if (lastPost.author === AUTHOR_KEYS.GEMINI) {
                nextAuthor = AUTHOR_KEYS.GPT;
            } else if (lastPost.author === AUTHOR_KEYS.GPT) {
                nextAuthor = AUTHOR_KEYS.GEMINI;
            }
        }

        logger.info(`[SNS] Auto post attempt, next author: ${nextAuthor}`);

        // 1. 시간 기반으로 트렌드 소스 선택 (IT/Stock 순환)
        const currentHour = new Date().getHours();
        const trendIndex = currentHour % 2; // IT와 Stock만 순환
        
        let trendSource = '';
        let postContent = '';
        let authorName = nextAuthor;
        
        // ===== IT/주식 트렌드 (캐시된 RSS 기사 사용) =====
        
        if (trendIndex === 0) {
            trendSource = 'it';
            authorName = AUTHOR_KEYS.GEEKNEWS;
            logger.info(`[SNS] Using IT trend (cached GeekNews)`);
            
            // IT 트렌드 캐시 갱신 (필요시)
            await updateItTrendCache();
            
            if (itTrendCache.length === 0) {
                logger.info(`[SNS] IT trend cache is empty. Skipping post.`);
                if (res) return res.send({ result: "success", message: "No IT cache" });
                return;
            }
            
        } else {
            trendSource = 'stock';
            authorName = AUTHOR_KEYS.HANKYUNG;
            logger.info(`[SNS] Using stock trend (cached Hankyung)`);
            
            // 주식 트렌드 캐시 갱신 (필요시)
            await updateStockTrendCache();
            
            if (stockTrendCache.length === 0) {
                logger.info(`[SNS] Stock trend cache is empty. Skipping post.`);
                if (res) return res.send({ result: "success", message: "No stock cache" });
                return;
            }
        }
        
        // 기존 포스트 내용 가져오기 (중복 체크용)
        const existingPostsSnapshot = await db.collection(COL_POSTS)
            .where('author', 'in', [AUTHOR_KEYS.GEEKNEWS, AUTHOR_KEYS.HANKYUNG])
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        
        const existingContents = existingPostsSnapshot.docs.map(doc => 
            (doc.data().content || '').toLowerCase()
        );
        
        logger.info(`[SNS] Loaded ${existingContents.length} existing posts for duplicate check`);
        
        // 캐시에서 중복되지 않은 기사만 필터링
        const cacheItems = trendSource === 'it' ? itTrendCache : stockTrendCache;
        
        const uniqueCandidates = cacheItems.filter(item => {
            const title = (item.title || '').toLowerCase();
            
            // 기존 포스트와 비교 (제목이 포함되어 있으면 중복)
            for (const existingContent of existingContents) {
                if (existingContent.includes(title.substring(0, 30)) ||
                    title.includes(existingContent.substring(0, 30))) {
                    return false; // 중복
                }
            }
            return true; // 중복 아님
        });
        
        if (uniqueCandidates.length === 0) {
            logger.info(`[SNS] All cached ${trendSource} articles are duplicates. Skipping post.`);
            if (res) return res.send({ result: "success", message: "All duplicates" });
            return;
        }
        
        logger.info(`[SNS] Found ${uniqueCandidates.length} unique ${trendSource} articles in cache`);
        
        // 랜덤으로 하나 선택
        const randomIndex = Math.floor(Math.random() * uniqueCandidates.length);
        const selectedItem = uniqueCandidates[randomIndex];
        
        logger.info(`[SNS] Selected ${trendSource} article from cache: ${selectedItem.title}`);
        
        // 기사 제목과 요약을 조합하여 200자 이내로 포스팅
        const title = selectedItem.title || '';
        const description = (selectedItem.contentSnippet || selectedItem.content || '')
            .replace(/<[^>]*>/g, '')  // HTML 태그 제거
            .replace(/\n+/g, ' ')     // 개행을 공백으로
            .trim();
        
        // 200자 제한
        let combinedText = '';
        if (description && description.length > 0) {
            combinedText = `${title}\n\n${description}`;
        } else {
            combinedText = title;
        }
        
        if (combinedText.length > 200) {
            combinedText = combinedText.substring(0, 197) + '...';
        }
        
        postContent = combinedText;
        
        logger.info(`[SNS] ${authorName} post prepared from cache: ${postContent.substring(0, 50)}...`);
        
        // 2. 최종 검증
        if (!postContent || postContent.trim().length === 0) {
            logger.info(`[SNS] Generated post content is empty. Skipping.`);
            if (res) return res.send({ result: "success", message: "Empty post content" });
            return;
        }

        // 3. Firestore에 저장
        const newPost = {
            author: authorName,
            content: postContent.trim(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            commentCount: 0
        };

        const docRef = await db.collection(COL_POSTS).add(newPost);
        logger.info(`[SNS] Auto post created by ${authorName} (source: ${trendSource}), ID: ${docRef.id}`);

        if (res) {
            res.send({ 
                result: "success", 
                postId: docRef.id, 
                author: authorName,
                source: trendSource,
                content: postContent.trim().substring(0, 100)
            });
        }
    } catch (error) {
        logger.error('[SNS] Error in autoCreatePost:', error);
        if (res) res.send({ result: "error", message: error.message });
    }
};

/**
 * Ollama(Exaone)가 실행 중인지 확인하는 헬퍼 함수
 * @returns {Promise<boolean>} Exaone 사용 가능 여부
 */
async function checkExaoneAvailable() {
    const now = Date.now();
    
    // 캐시된 결과가 유효하면 바로 반환
    if (now - lastExaoneCheck < EXAONE_CHECK_INTERVAL) {
        return exaoneAvailable;
    }

    const baseUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434';
    const url = `${baseUrl}/api/chat`;
    
    try {
        const response = await axios.get(`${baseUrl}/api/tags`, {
            timeout: 2000
        });
        
        // exaone3.5:7.8b-instruct-q4_K_M 모델이 있는지 확인
        if (response.data && response.data.models) {
            const hasExaone = response.data.models.some(model => 
                model.name && (model.name.includes('exaone3.5:7.8b-instruct-q4_K_M') || model.name.includes('exaone3.5:7.8b'))
            );
            exaoneAvailable = hasExaone;
            lastExaoneCheck = now;
            
            if (hasExaone) {
                logger.info('[SNS] Exaone is available and running');
            } else {
                logger.info('[SNS] Ollama is running but Exaone model not found');
            }
            
            return exaoneAvailable;
        }
        
        exaoneAvailable = false;
        lastExaoneCheck = now;
        return false;
        
    } catch (error) {
        // Ollama가 실행되지 않음
        exaoneAvailable = false;
        lastExaoneCheck = now;
        return false;
    }
}

/**
 * IT 트렌드 캐시 갱신 (6시간마다)
 * - GeekNews RSS에서 기사를 가져와 LLM으로 정리하여 캐싱
 */
async function updateItTrendCache() {
    const now = Date.now();
    
    // 캐시가 유효하면 갱신하지 않음
    if (now - lastItTrendUpdate < TREND_CACHE_INTERVAL && itTrendCache.length > 0) {
        logger.info(`[SNS] IT trend cache is still valid (${itTrendCache.length} items)`);
        return;
    }
    
    try {
        logger.info('[SNS] Updating IT trend cache...');
        
        const Parser = require('rss-parser');
        const parser = new Parser();
        const rssUrl = 'https://news.hada.io/rss/news';
        
        const feed = await parser.parseURL(rssUrl);
        
        if (!feed.items || feed.items.length === 0) {
            logger.warn('[SNS] No IT RSS items found');
            return;
        }
        
        // 최신 30개 기사만 가져오기
        const items = feed.items.slice(0, 30);
        
        // LLM으로 쉬운 기사 필터링 및 정리
        const articleSummaries = items.map((item, idx) => {
            const title = item.title || '';
            const snippet = (item.contentSnippet || item.content || '')
                .replace(/<[^>]*>/g, '')
                .replace(/\n+/g, ' ')
                .trim()
                .substring(0, 150);
            return `[${idx}] ${title}\n${snippet}`;
        }).join('\n\n');
        
        const filterPrompt = `다음은 IT 기술 뉴스 목록입니다. 이 중에서 일반인이 이해하기 쉽고, 전문 용어가 적으며, 흥미로운 기사들을 선택해주세요.

${articleSummaries}

[선택 기준]:
- 전문적이거나 어려운 기술 용어가 적을 것
- 일반인도 이해할 수 있는 내용일 것
- 너무 개발자 중심적이지 않을 것
- 흥미롭고 대중적인 주제일 것

상위 10개 기사의 번호를 쉼표로 구분하여 출력하세요. (예: 0,2,5,7,9,11,13,15,17,19)
만약 적합한 기사가 10개 미만이면 있는 만큼만 출력하세요.`;
        
        const aiResponse = await callGemini(filterPrompt);
        const selectedIndices = aiResponse.trim().split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 0 && n < items.length);
        
        if (selectedIndices.length === 0) {
            logger.warn('[SNS] No suitable IT articles found by LLM');
            // Fallback: 첫 10개 사용
            itTrendCache = items.slice(0, 10);
        } else {
            itTrendCache = selectedIndices.map(idx => items[idx]);
        }
        
        lastItTrendUpdate = now;
        logger.info(`[SNS] IT trend cache updated with ${itTrendCache.length} articles`);
        
    } catch (error) {
        logger.error(`[SNS] Error updating IT trend cache: ${error.message}`);
    }
}

/**
 * 주식 트렌드 캐시 갱신 (6시간마다)
 * - 한국경제 RSS에서 기사를 가져와 캐싱
 */
async function updateStockTrendCache() {
    const now = Date.now();
    
    // 캐시가 유효하면 갱신하지 않음
    if (now - lastStockTrendUpdate < TREND_CACHE_INTERVAL && stockTrendCache.length > 0) {
        logger.info(`[SNS] Stock trend cache is still valid (${stockTrendCache.length} items)`);
        return;
    }
    
    try {
        logger.info('[SNS] Updating stock trend cache...');
        
        const Parser = require('rss-parser');
        const parser = new Parser();
        const rssUrl = 'https://www.hankyung.com/feed/finance';
        
        const feed = await parser.parseURL(rssUrl);
        
        if (!feed.items || feed.items.length === 0) {
            logger.warn('[SNS] No stock RSS items found');
            return;
        }
        
        // 최신 30개 기사 캐싱
        stockTrendCache = feed.items.slice(0, 30);
        lastStockTrendUpdate = now;
        logger.info(`[SNS] Stock trend cache updated with ${stockTrendCache.length} articles`);
        
    } catch (error) {
        logger.error(`[SNS] Error updating stock trend cache: ${error.message}`);
    }
}

/**
 * Exaone이 모든 post를 순회하면서 자신의 댓글이 없는 post에 댓글 작성
 * - autoAddComment에서 호출됨
 * - post 내용 + 기존 댓글들을 context로 활용
 */
async function autoCommentExaoneOnAllPosts() {
    try {
        logger.info('[SNS] Exaone starting to scan all posts');
        
        // 최근 20개 post 가져오기
        const postsSnapshot = await db.collection(COL_POSTS)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        
        if (postsSnapshot.empty) {
            logger.info('[SNS] No posts found for Exaone commenting');
            return;
        }
        
        let commentedCount = 0;
        
        // 각 post 순회
        for (const postDoc of postsSnapshot.docs) {
            const postId = postDoc.id;
            const postData = postDoc.data();
            const postAuthor = postData.author;
            const postContent = postData.content;
            
            // 해당 post에 Exaone의 댓글이 이미 있는지 확인
            const exaoneCommentsSnapshot = await db.collection(COL_COMMENTS)
                .where('postId', '==', postId)
                .where('author', '==', AUTHOR_KEYS.EXAONE)
                .limit(1)
                .get();
            
            // Exaone 댓글이 이미 있으면 스킵
            if (!exaoneCommentsSnapshot.empty) {
                logger.info(`[SNS] Exaone already commented on post ${postId}, skipping`);
                continue;
            }
            
            // Exaone 자신이 작성한 post면 스킵
            if (postAuthor === AUTHOR_KEYS.EXAONE) {
                logger.info(`[SNS] Skipping Exaone's own post ${postId}`);
                continue;
            }
            
            logger.info(`[SNS] Exaone commenting on post ${postId} by ${postAuthor}`);
            
            // 해당 post의 모든 댓글 가져오기 (context로 사용)
            const commentsSnapshot = await db.collection(COL_COMMENTS)
                .where('postId', '==', postId)
                .orderBy('createdAt', 'asc')
                .get();
            
            let existingCommentsText = '';
            if (!commentsSnapshot.empty) {
                const commentsList = commentsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    const truncatedContent = data.content.length > 150 
                        ? data.content.substring(0, 150) + '...' 
                        : data.content;
                    return `${getDisplayName(data.author)}: ${truncatedContent}`;
                });
                existingCommentsText = '\n\n[기존 댓글들]:\n' + commentsList.join('\n');
            } else {
                existingCommentsText = '\n\n[기존 댓글]: 아직 댓글이 없습니다.';
            }
            
            // Exaone에게 댓글 작성 요청
            const prompt = `
다음 게시글과 기존 댓글들을 보고 자연스럽고 적절한 댓글을 작성해주세요.

[게시글 작성자]: ${getDisplayName(postAuthor)}
[게시글 내용]:
${postContent}${existingCommentsText}

[댓글 작성 규칙]:
1. 게시글 내용과 기존 댓글들의 흐름을 고려하여 자연스럽게 작성하세요.
2. 기존 댓글에서 다룬 내용과 중복되지 않도록 새로운 관점이나 의견을 제시하세요.
3. 100자 이내로 간결하게 작성하세요.
4. 자연스러운 한국어로 작성하세요.
5. 게시글 내용이 부적절하거나 댓글을 달 가치가 없다고 판단되면 "SKIP"이라고만 출력하세요.

[금지 사항]:
- 이모지 사용 금지
- 해시태그(#) 사용 금지
- 특수문자(---, ***, 등) 사용 금지
- [댓글 내용], [작성] 같은 메타 텍스트 금지

출력 형식:
- 댓글 작성 안 함: "SKIP"
- 댓글 작성: 댓글 본문만 출력 (다른 텍스트 없이)
`;

            try {
                let commentContent = await callExaoneSNS(prompt);
                commentContent = commentContent.trim()
                    .replace(/^---+\s*/gm, '')
                    .replace(/\s*---+$/gm, '')
                    .replace(/^\[댓글 내용\]\s*/i, '')
                    .replace(/^\[작성\]\s*/i, '')
                    .replace(/#\S+/g, '')
                    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
                    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
                    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
                    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
                    .replace(/[\u{2600}-\u{26FF}]/gu, '')
                    .replace(/[\u{2700}-\u{27BF}]/gu, '')
                    .trim();
                
                // SKIP 판단
                if (commentContent.includes("SKIP") || commentContent.length < 5) {
                    logger.info(`[SNS] Exaone decided to skip post ${postId}`);
                    continue;
                }
                
                // 댓글 저장
                const postRef = db.collection(COL_POSTS).doc(postId);
                const commentRef = db.collection(COL_COMMENTS).doc();
                
                await db.runTransaction(async (t) => {
                    const postDoc = await t.get(postRef);
                    if (!postDoc.exists) {
                        throw new Error("게시글이 삭제되었습니다.");
                    }
                    
                    t.set(commentRef, {
                        postId: postId,
                        author: AUTHOR_KEYS.EXAONE,
                        content: commentContent,
                        exaoneSource: getExaoneSource(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    t.update(postRef, {
                        commentCount: admin.firestore.FieldValue.increment(1)
                    });
                });
                
                commentedCount++;
                logger.info(`[SNS] Exaone commented on post ${postId}: ${commentContent.substring(0, 50)}...`);
                
                // 서버 부하 방지를 위해 각 댓글 사이에 약간의 딜레이
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                logger.error(`[SNS] Exaone failed to comment on post ${postId}: ${error.message}`);
                // 에러가 나도 다음 post로 계속 진행
                continue;
            }
        }
        
        logger.info(`[SNS] Exaone finished scanning. Commented on ${commentedCount} posts`);
        
    } catch (error) {
        logger.error(`[SNS] autoCommentExaoneOnAllPosts Error: ${error.message}`);
    }
}


/**
 * 검색이 필요한지 판단하는 헬퍼 함수
 * @param {string} content - 사용자 게시글/댓글 내용
 * @param {string} aiName - AI 이름
 * @returns {Promise<Object>} {needSearch: boolean, keywords: string}
 */
async function checkIfSearchNeeded(content, aiName) {
    try {
        const prompt = `
다음 사용자의 글을 보고 답변하기 위해 인터넷 검색이 필요한지 판단해주세요.

[사용자의 글]:
${content}

[판단 기준]:
- 최신 정보, 뉴스, 실시간 데이터가 필요한 경우: 검색 필요
- 날씨, 주가, 환율 등 실시간 정보: 검색 필요
- 최근 사건, 이슈, 트렌드: 검색 필요
- 일반적인 대화, 감정 표현, 의견: 검색 불필요
- 개인적인 경험담, 일상: 검색 불필요

[출력 형식]:
검색이 필요하면: "SEARCH: 검색 키워드"
검색이 불필요하면: "NO_SEARCH"

예시:
- "오늘 날씨 어때?" → "SEARCH: 오늘 날씨"
- "삼성전자 주가 알려줘" → "SEARCH: 삼성전자 주가"
- "오늘 너무 피곤해" → "NO_SEARCH"
- "ChatGPT 최신 업데이트 뭐야?" → "SEARCH: ChatGPT 최신 업데이트"

출력:`;

        let result = "";
        if (aiName === AUTHOR_KEYS.GEMINI) {
            result = await callGeminiSNS(prompt);
        } else if (aiName === AUTHOR_KEYS.GPT) {
            result = await callOpenAISNS(prompt);
        } else if (aiName === AUTHOR_KEYS.EXAONE) {
            result = await callExaoneSNS(prompt);
        } else {
            logger.error(`[SNS] Unknown AI name in checkIfSearchNeeded: ${aiName}`);
            return { needSearch: false };
        }

        result = result.trim();

        if (result.startsWith('SEARCH:')) {
            const keywords = result.replace('SEARCH:', '').trim();
            logger.info(`[SNS] Search needed with keywords: ${keywords}`);
            return { needSearch: true, keywords: keywords };
        } else {
            logger.info(`[SNS] No search needed`);
            return { needSearch: false, keywords: '' };
        }

    } catch (error) {
        logger.error(`[SNS] checkIfSearchNeeded Error: ${error.message}`);
        return { needSearch: false, keywords: '' };
    }
}

/**
 * Gemini API with Google Search Grounding을 사용한 검색
 * @param {string} keywords - 검색 키워드
 * @returns {Promise<string>} 검색 결과
 */
async function searchWeb(keywords) {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            logger.error('[SNS] Google API Key is missing in .env');
            return '';
        }

        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Google Search Grounding을 활성화한 모델 생성
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-lite",
            tools: [{
                googleSearch: {}
            }]
        });

        const prompt = `다음 키워드에 대해 최신 정보를 검색하여 간단히 요약해주세요: ${keywords}`;

        logger.info(`[SNS] Performing Google Search via Gemini for: ${keywords}`);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (text && text.trim().length > 0) {
            logger.info(`[SNS] Search results found: ${text.substring(0, 100)}...`);
            return text.trim();
        } else {
            logger.info(`[SNS] No search results found`);
            return '';
        }

    } catch (error) {
        logger.error(`[SNS] searchWeb Error: ${error.message}`);
        return '';
    }
}

/**
 * 특정 AI가 게시글에 답변을 작성하는 헬퍼 함수
 * @param {string} postId - 게시글 ID
 * @param {string} userContent - 사용자가 작성한 내용
 * @param {string} aiName - 'Gemini' 또는 'GPT'
 */
async function createAIReply(postId, userContent, aiName) {
    try {
        logger.info(`[SNS] ${aiName} creating reply to post ${postId}`);

        // 게시글 본문 가져오기
        const postDoc = await db.collection(COL_POSTS).doc(postId).get();
        let postContent = '';
        let postAuthor = '';
        if (postDoc.exists) {
            const postData = postDoc.data();
            postContent = postData.content || '';
            postAuthor = postData.author || '';
        }

        // 기존 댓글들 가져오기
        const allCommentsSnapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'asc')
            .get();

        let existingCommentsText = '';
        if (!allCommentsSnapshot.empty) {
            const commentsList = allCommentsSnapshot.docs.map(doc => {
                const data = doc.data();
                return `${data.author}: ${data.content}`;
            });
            existingCommentsText = '\n\n[기존 댓글들]:\n' + commentsList.join('\n');
        } else {
            existingCommentsText = '\n\n[기존 댓글]: 아직 댓글이 없습니다.';
        }

        // 1. 검색이 필요한지 판단
        const searchCheck = await checkIfSearchNeeded(userContent, aiName);
        
        let searchResultsText = '';
        if (searchCheck.needSearch && searchCheck.keywords) {
            logger.info(`[SNS] Performing web search for: ${searchCheck.keywords}`);
            const searchResults = await searchWeb(searchCheck.keywords);
            
            if (searchResults) {
                searchResultsText = '\n\n[인터넷 검색 결과]:\n' + searchResults;
            } else {
                searchResultsText = '\n\n[인터넷 검색 결과]: 검색 결과를 찾지 못했습니다.';
            }
        }

        // 2. AI가 게시글, 기존 댓글, 검색 결과를 모두 보고 답변 작성
        const prompt = `
[게시글 작성자]: ${postAuthor}
[게시글 본문]:
${postContent}${existingCommentsText}

[사용자의 최신 댓글]:
${userContent}${searchResultsText}

위 전체 맥락을 고려하여 사용자의 최신 댓글에 자연스럽고 적절한 답변을 작성해주세요.

[댓글 작성 규칙]:
1. 게시글 본문과 기존 댓글들의 흐름을 고려하여 자연스럽게 작성하세요.
2. 사용자의 최신 댓글에 대한 직접적인 반응을 작성하세요.
3. 검색 결과가 있다면 그 정보를 활용하여 정확하고 유용한 답변을 제공하세요.
4. 다른 AI가 이미 답변했다면 중복되지 않는 새로운 관점을 제시하세요.
5. 100자 이내로 간결하게 작성하세요.
6. 자연스러운 한국어로 작성하세요.

[금지 사항]:
- 이모지 사용 금지
- 해시태그(#) 사용 금지
- 특수문자(---, ***, 등) 사용 금지
- [댓글 내용], [작성] 같은 메타 텍스트 금지

출력: 댓글 본문만 출력 (다른 텍스트 없이)
`;

        let commentContent = "";
        
        try {
            if (aiName === AUTHOR_KEYS.GEMINI) {
                commentContent = await callGeminiSNS(prompt);
            } else if (aiName === AUTHOR_KEYS.GPT) {
                commentContent = await callOpenAISNS(prompt);
            } else if (aiName === AUTHOR_KEYS.EXAONE) {
                commentContent = await callExaoneSNS(prompt);
            } else {
                logger.error(`[SNS] Unknown AI name: ${aiName}`);
                return;
            }
        } catch (error) {
            logger.error(`[SNS] ${aiName} API Error: ${error.message}`);
            return;
        }

        commentContent = commentContent.trim();

        // 응답 정제
        commentContent = commentContent
            .replace(/^---+\s*/gm, '')
            .replace(/\s*---+$/gm, '')
            .replace(/^\[댓글 내용\]\s*/i, '')
            .replace(/^\[작성\]\s*/i, '')
            .replace(/#\S+/g, '')
            .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
            .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
            .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
            .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
            .replace(/[\u{2600}-\u{26FF}]/gu, '')
            .replace(/[\u{2700}-\u{27BF}]/gu, '')
            .trim();

        if (commentContent.length < 5) {
            logger.info(`[SNS] ${aiName} generated empty comment, skipping`);
            return;
        }

        // 댓글 저장
        const postRef = db.collection(COL_POSTS).doc(postId);
        const commentRef = db.collection(COL_COMMENTS).doc();

        await db.runTransaction(async (t) => {
            const postDoc = await t.get(postRef);
            if (!postDoc.exists) {
                throw new Error("게시글이 삭제되었습니다.");
            }

            const commentData = {
                postId: postId,
                author: aiName,
                content: commentContent,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            // Exaone인 경우 로컬/서버 정보 추가
            if (aiName === AUTHOR_KEYS.EXAONE) {
                commentData.exaoneSource = getExaoneSource();
            }
            
            t.set(commentRef, commentData);

            t.update(postRef, {
                commentCount: admin.firestore.FieldValue.increment(1)
            });
        });

        logger.info(`[SNS] ${aiName} replied successfully: ${commentContent.substring(0, 50)}...`);

    } catch (error) {
        logger.error(`[SNS] createAIReply Error (${aiName}): ${error.message}`);
    }
}

/**
 * User의 게시글/댓글에 AI가 답변하는 헬퍼 함수
 * - Gemini와 GPT가 번갈아가며 답변 (autoAddComment용)
 * - Exaone이 실행 중이면 추가로 답변
 */
async function replyToPost(postId, userContent) {
    try {
        // 해당 게시글의 댓글 확인하여 다음 답변자 결정
        const commentsSnapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let nextCommenter = AUTHOR_KEYS.GEMINI; // 기본값
        
        if (!commentsSnapshot.empty) {
            const lastComment = commentsSnapshot.docs[0].data();
            // 마지막 댓글이 Gemini면 GPT, GPT면 Gemini (Exaone 제외)
            if (lastComment.author === AUTHOR_KEYS.GEMINI) {
                nextCommenter = AUTHOR_KEYS.GPT;
            } else if (lastComment.author === AUTHOR_KEYS.GPT) {
                nextCommenter = AUTHOR_KEYS.GEMINI;
            } else if (lastComment.author === AUTHOR_KEYS.EXAONE) {
                // Exaone 댓글은 순환에서 제외, 이전 Gemini/GPT 댓글 찾기
                const prevComments = await db.collection(COL_COMMENTS)
                    .where('postId', '==', postId)
                    .orderBy('createdAt', 'desc')
                    .limit(10)
                    .get();
                
                for (const doc of prevComments.docs) {
                    const author = doc.data().author;
                    if (author === AUTHOR_KEYS.GEMINI) {
                        nextCommenter = AUTHOR_KEYS.GPT;
                        break;
                    } else if (author === AUTHOR_KEYS.GPT) {
                        nextCommenter = AUTHOR_KEYS.GEMINI;
                        break;
                    }
                }
            }
        }

        logger.info(`[SNS] ${nextCommenter} replying to User's content`);

        // Gemini/GPT 답변 (실패해도 Exaone 답변은 계속 진행)
        try {
            await createAIReply(postId, userContent, nextCommenter);
        } catch (aiError) {
            logger.error(`[SNS] ${nextCommenter} reply failed: ${aiError.message}`);
        }
        
        // Exaone이 실행 중이면 무조건 답변 (다른 LLM 성공/실패와 무관)
        const isExaoneAvailable = await checkExaoneAvailable();
        if (isExaoneAvailable) {
            logger.info(`[SNS] Exaone also replying to User's content`);
            try {
                // 짧은 대기 후 Exaone 답변 (이전 댓글이 저장될 시간 확보)
                await new Promise(resolve => setTimeout(resolve, 1500));
                await createAIReply(postId, userContent, AUTHOR_KEYS.EXAONE);
            } catch (exaoneError) {
                logger.error(`[SNS] Exaone reply failed: ${exaoneError.message}`);
            }
        }

    } catch (error) {
        logger.error(`[SNS] replyToPost Error: ${error.message}`);
    }
}

/**
 * 긱뉴스 RSS 피드에서 IT 관련 트렌드 키워드 추출
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @returns {Promise<Array>} IT 트렌드 키워드 목록
 */
exports.getItTrend = async function(req, res) {
    const GEEKNEWS_RSS = 'http://feeds.feedburner.com/geeknews-feed';

    try {
        logger.info('[GeekNews] Fetching IT trends from RSS feed');

        // 1. RSS 피드 파싱
        const Parser = require('rss-parser');
        const parser = new Parser({
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const feed = await parser.parseURL(GEEKNEWS_RSS);

        if (!feed.items || feed.items.length === 0) {
            throw new Error("No items found in RSS feed");
        }

        logger.info(`[GeekNews] Found ${feed.items.length} articles`);

        // 2. 제목에서 키워드 추출 (최근 20개 기사)
        const rawKeywords = new Set();
        
        feed.items.slice(0, 20).forEach(item => {
            if (item.title) {
                const keywords = extractKeywords(item.title);
                keywords.forEach(kw => {
                    // 2글자 이상의 유의미한 키워드만 추가
                    if (kw.length >= 2) {
                        rawKeywords.add(kw);
                    }
                });
            }
        });

        const rawKeywordArray = Array.from(rawKeywords);
        logger.info(`[GeekNews] Extracted ${rawKeywordArray.length} raw keywords`);

        if (rawKeywordArray.length === 0) {
            throw new Error("No keywords extracted from RSS feed");
        }

        // 3. Gemini로 IT/기술 관련 키워드만 필터링
        let finalKeywords = [];

        try {
            const prompt = `
다음은 긱뉴스 RSS 피드에서 추출한 키워드 리스트입니다.
이 중에서 **IT, 기술, 프로그래밍, 개발, 소프트웨어, 하드웨어**와 관련된 키워드만 선택하세요.

[입력 키워드]:
${JSON.stringify(rawKeywordArray)}

[선택 기준]:
- IT 기술, 프로그래밍 언어, 프레임워크, 라이브러리
- 소프트웨어, 앱, 서비스, 플랫폼
- 하드웨어, 디바이스, 가젯
- AI, 머신러닝, 데이터, 클라우드
- 개발 도구, 개발 방법론
- 기술 기업, 스타트업 (단, IT 관련인 경우만)

[제외 기준]:
- 일반 명사, 동사, 형용사
- 정치, 경제, 사회 이슈
- 연예, 스포츠
- 너무 포괄적인 단어 ("기술", "개발", "서비스" 등 단독)

[출력 조건]:
1. 설명 없이 오직 **JSON 배열**만 출력하세요.
2. 중복 제거하세요.
3. IT/기술 관련성이 높은 키워드 최대 15개 선택하세요.
4. 포맷 예시: ["Python", "React", "ChatGPT", "AWS"]

출력:`;

            const aiResponse = await callGemini(prompt);
            
            // JSON 파싱
            let jsonText = aiResponse
                .replace(/```json\s*/g, '')
                .replace(/```javascript\s*/g, '')
                .replace(/```\s*/g, '')
                .trim();
            
            const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonText = arrayMatch[0];
            }
            
            finalKeywords = JSON.parse(jsonText);
            
            if (!Array.isArray(finalKeywords) || finalKeywords.length === 0) {
                throw new Error("Empty or invalid array from AI");
            }

            // 중복 제거 및 정제
            const uniqueKeywords = [...new Set(finalKeywords.map(k => k.trim()))];
            finalKeywords = uniqueKeywords.filter(k => k.length > 0);

            logger.info(`[GeekNews] Filtered IT keywords (${finalKeywords.length}): ${finalKeywords.slice(0, 5).join(', ')}...`);

        } catch (llmError) {
            logger.error(`[GeekNews] Gemini Filtering Failed: ${llmError.message}`);
            // 필터링 실패 시 원본 키워드 중 상위 10개 사용
            const uniqueRaw = [...new Set(rawKeywordArray.map(k => k.trim()))];
            finalKeywords = uniqueRaw.filter(k => k.length > 0).slice(0, 10);
            logger.info(`[GeekNews] Using raw keywords as fallback (${finalKeywords.length})`);
        }

        // 4. 응답
        if (res) res.send({ result: "success", data: finalKeywords, source: "geeknews" });
        return finalKeywords;

    } catch (e) {
        logger.error(`[GeekNews] Error: ${e.message}`);
        
        // 최종 fallback: IT 관련 기본 키워드
        const fallbackKeywords = [
            'AI',
            'ChatGPT',
            'Python',
            'JavaScript',
            'React',
            'Node.js',
            'AWS',
            'Docker',
            '클라우드',
            '머신러닝'
        ];
        
        if (res) res.send({ result: "success", data: fallbackKeywords, source: "fallback" });
        return fallbackKeywords;
    }
};

/**
 * 한국경제 RSS 피드에서 주식/금융 관련 트렌드 키워드 추출
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @returns {Promise<Array>} 주식/금융 트렌드 키워드 목록
 */
exports.getStockTrend = async function(req, res) {
    const HANKYUNG_RSS = 'https://www.hankyung.com/feed/finance';

    try {
        logger.info('[Hankyung] Fetching stock/finance trends from RSS feed');

        // 1. RSS 피드 파싱
        const Parser = require('rss-parser');
        const parser = new Parser({
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const feed = await parser.parseURL(HANKYUNG_RSS);

        if (!feed.items || feed.items.length === 0) {
            throw new Error("No items found in RSS feed");
        }

        logger.info(`[Hankyung] Found ${feed.items.length} articles`);

        // 2. 제목에서 키워드 추출 (최근 20개 기사)
        const rawKeywords = new Set();
        
        feed.items.slice(0, 20).forEach(item => {
            if (item.title) {
                const keywords = extractKeywords(item.title);
                keywords.forEach(kw => {
                    // 2글자 이상의 유의미한 키워드만 추가
                    if (kw.length >= 2) {
                        rawKeywords.add(kw);
                    }
                });
            }
        });

        const rawKeywordArray = Array.from(rawKeywords);
        logger.info(`[Hankyung] Extracted ${rawKeywordArray.length} raw keywords`);

        if (rawKeywordArray.length === 0) {
            throw new Error("No keywords extracted from RSS feed");
        }

        // 3. Gemini로 주식/금융 관련 키워드만 필터링
        let finalKeywords = [];

        try {
            const prompt = `
다음은 한국경제 금융 RSS 피드에서 추출한 키워드 리스트입니다.
이 중에서 **주식, 금융, 경제, 투자, 기업**과 관련된 키워드만 선택하세요.

[입력 키워드]:
${JSON.stringify(rawKeywordArray)}

[선택 기준]:
- 기업명, 브랜드명 (삼성전자, 네이버, 카카오 등)
- 산업 분야 (반도체, 자동차, 바이오, 금융 등)
- 주식 관련 용어 (배당, IPO, 상장 등)
- 경제 지표, 금융 상품
- 투자 관련 키워드
- 국가/지역 (투자 관련인 경우)

[제외 기준]:
- 정치인 이름, 정치 이슈
- 일반 명사, 동사, 형용사
- 연예, 스포츠
- 너무 포괄적인 단어 ("기업", "경제", "금융" 등 단독)

[출력 조건]:
1. 설명 없이 오직 **JSON 배열**만 출력하세요.
2. 중복 제거하세요.
3. 주식/금융 관련성이 높은 키워드 최대 15개 선택하세요.
4. 포맷 예시: ["삼성전자", "반도체", "배당", "IPO"]

출력:`;

            const aiResponse = await callGemini(prompt);
            
            // JSON 파싱
            let jsonText = aiResponse
                .replace(/```json\s*/g, '')
                .replace(/```javascript\s*/g, '')
                .replace(/```\s*/g, '')
                .trim();
            
            const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonText = arrayMatch[0];
            }
            
            finalKeywords = JSON.parse(jsonText);
            
            if (!Array.isArray(finalKeywords) || finalKeywords.length === 0) {
                throw new Error("Empty or invalid array from AI");
            }

            // 중복 제거 및 정제
            const uniqueKeywords = [...new Set(finalKeywords.map(k => k.trim()))];
            finalKeywords = uniqueKeywords.filter(k => k.length > 0);

            logger.info(`[Hankyung] Filtered stock keywords (${finalKeywords.length}): ${finalKeywords.slice(0, 5).join(', ')}...`);

        } catch (llmError) {
            logger.error(`[Hankyung] Gemini Filtering Failed: ${llmError.message}`);
            // 필터링 실패 시 원본 키워드 중 상위 10개 사용
            const uniqueRaw = [...new Set(rawKeywordArray.map(k => k.trim()))];
            finalKeywords = uniqueRaw.filter(k => k.length > 0).slice(0, 10);
            logger.info(`[Hankyung] Using raw keywords as fallback (${finalKeywords.length})`);
        }

        // 4. 응답
        if (res) res.send({ result: "success", data: finalKeywords, source: "hankyung" });
        return finalKeywords;

    } catch (e) {
        logger.error(`[Hankyung] Error: ${e.message}`);
        
        // 최종 fallback: 주식 관련 기본 키워드
        const fallbackKeywords = [
            '삼성전자',
            'SK하이닉스',
            '네이버',
            '카카오',
            '현대차',
            '반도체',
            '배터리',
            '바이오',
            '금융',
            '부동산'
        ];
        
        if (res) res.send({ result: "success", data: fallbackKeywords, source: "fallback" });
        return fallbackKeywords;
    }
};

/**
 * 텍스트에서 주요 키워드 추출 헬퍼 함수
 * @param {string} text - 추출할 텍스트
 * @returns {Array<string>} 키워드 배열
 */
function extractKeywords(text) {
    if (!text) return [];
    
    // 불용어 제거 및 키워드 추출
    const stopWords = ['의', '가', '이', '은', '들', '는', '좋', '잘', '걍', '과', '도', '를', '으로', '자', '에', '와', '한', '하다'];
    const words = text
        .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ') // 특수문자 제거
        .split(/\s+/)
        .filter(word => word.length >= 2) // 2글자 이상
        .filter(word => !stopWords.includes(word))
        .slice(0, 3); // 상위 3개만
    
    return words;
}

/**
 * 트렌드 캐시 초기화 (서버 시작 시 호출)
 * - IT 트렌드와 주식 트렌드 캐시를 미리 로드
 */
exports.initTrendCache = async function() {
    try {
        logger.info('[SNS] Initializing trend cache...');
        
        // IT 트렌드 캐시 초기화
        await updateItTrendCache();
        
        // 주식 트렌드 캐시 초기화
        await updateStockTrendCache();
        
        logger.info('[SNS] Trend cache initialization completed');
    } catch (error) {
        logger.error(`[SNS] Error initializing trend cache: ${error.message}`);
    }
};