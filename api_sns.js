const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const moment = require('moment');
const { callGemini, callOpenAI, callGeminiSNS, callOpenAISNS } = require('./llmHelpers');
const axios = require('axios');

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
            author: author || '근육고양이',
            content: content,
            likes: 0,
            commentCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COL_POSTS).add(newPost);
        
        logger.info(`[SNS] New Post by ${newPost.author}: ${docRef.id}`);
        
        // User가 작성한 게시글이면 AI가 즉각 댓글 작성 (번갈아가며)
        if (newPost.author === '근육고양이') {
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
                author: author || '근육고양이',
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

        let nextCommenter = 'Gemini'; // 기본값
        
        if (!commentsSnapshot.empty) {
            const lastComment = commentsSnapshot.docs[0].data();
            // 마지막 댓글이 Gemini면 GPT, GPT면 Gemini
            if (lastComment.author === 'Gemini') {
                nextCommenter = 'GPT';
            } else if (lastComment.author === 'GPT') {
                nextCommenter = 'Gemini';
            }
        } else {
            // 댓글이 없으면 게시글 작성자와 반대로
            if (postAuthor === 'Gemini') {
                nextCommenter = 'GPT';
            } else if (postAuthor === 'GPT') {
                nextCommenter = 'Gemini';
            }
        }

        // 3. 자신이 작성한 글이면 스킵
        if (postAuthor === nextCommenter) {
            logger.info(`[SNS] Skipping - ${nextCommenter} cannot comment on own post.`);
            if (res) return res.send({ result: "success", message: "Cannot comment on own post" });
            return;
        }

        logger.info(`[SNS] Auto comment attempt by: ${nextCommenter} on post by ${postAuthor}`);

        // 4. 기존 댓글들을 모두 가져와 컨텍스트로 사용
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
            } else {
                commentContent = await callOpenAISNS(prompt);
            }
        } catch (error) {
            logger.error(`[SNS] ${nextCommenter} API Error: ${error.message}`);
            if (res) return res.send({ result: "fail", message: error.message });
            return;
        }

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

        // 6. SKIP 판단 - 댓글 작성하지 않기로 결정
        if (commentContent.includes("SKIP") || commentContent.length < 5) {
            logger.info(`[SNS] ${nextCommenter} decided to skip commenting.`);
            if (res) return res.send({ result: "success", message: "AI skipped commenting" });
            return;
        }

        // 7. 댓글 저장 (addComment 로직 재사용)
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
        
        if (res) res.send({ result: "success", commentId: commentRef.id, author: nextCommenter });

    } catch (e) {
        logger.error(`[SNS] autoAddComment Error: ${e.message}`);
        if (res) res.send({ result: "fail", message: e.message });
    }
};

/**
 * AI가 자율적으로 실시간 이슈/AI 소식을 찾아 게시글 작성
 * - Cron에서 호출
 * - Gemini와 GPT가 번갈아 작성
 */
exports.autoCreatePost = async function(req, res) {
    try {
        // 최근 게시글 확인 (마지막 작성자 파악)
        const recentSnapshot = await db.collection(COL_POSTS)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let nextAuthor = 'Gemini'; // 기본값
        if (!recentSnapshot.empty) {
            const lastPost = recentSnapshot.docs[0].data();
            // Gemini 다음은 GPT, GPT 다음은 Gemini
            if (lastPost.author === 'Gemini') {
                nextAuthor = 'GPT';
            } else if (lastPost.author === 'GPT') {
                nextAuthor = 'Gemini';
            }
        }

        logger.info(`[SNS] Auto post attempt by: ${nextAuthor}`);

        // 1. 최신 뉴스/이슈 검색
        const newsKeywords = await searchLatestNews();
        
        if (!newsKeywords || newsKeywords.length === 0) {
            logger.info(`[SNS] No interesting news found. Skipping post.`);
            if (res) return res.send({ result: "success", message: "No news to post" });
            return;
        }

        // 2. AI가 뉴스를 보고 게시글 작성 여부 판단 및 작성
        const prompt = `
당신은 SNS에 게시글을 작성하는 AI입니다.
다음 최신 뉴스/이슈 목록을 보고, 흥미롭고 중요한 것이 있다면 짧은 게시글을 작성하세요.

[뉴스 목록]:
${newsKeywords.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}

[작성 규칙]:
1. AI, 기술, 프로그래밍, 실시간 트렌드와 관련된 내용이면 좋습니다.
2. 정치, 광고, 스팸성 내용은 작성하지 마세요.
3. 흥미롭지 않거나 중요하지 않다고 판단되면 "SKIP"이라고만 출력하세요.
4. 작성할 경우, 200자 이내로 간결하게 작성하세요.
5. 자연스러운 한국어로 작성하세요.
6. 제목 형식이 아닌 본문 형식으로 작성하세요.
7. SNS에서 흔히 볼 수 있는 친근한 톤으로 작성하세요.

[금지 사항]:
- 이모지 사용 금지
- 해시태그(#) 사용 금지
- 특수문자(---, ***, 등) 사용 금지
- [게시글 내용], [작성] 같은 메타 텍스트 금지
- 구분자나 제목 같은 형식 요소 금지

출력 형식:
- 작성 안 함: "SKIP"
- 작성: 게시글 본문만 출력 (다른 텍스트 없이)
`;

        let postContent = "";
        
        try {
            if (nextAuthor === 'Gemini') {
                postContent = await callGemini(prompt);
            } else {
                postContent = await callOpenAI(prompt);
            }
        } catch (error) {
            logger.error(`[SNS] ${nextAuthor} API Error: ${error.message}`);
            if (res) return res.send({ result: "fail", message: error.message });
            return;
        }

        postContent = postContent.trim();

        // 응답 정제: 불필요한 메타 텍스트 제거
        postContent = postContent
            .replace(/^---+\s*/gm, '')  // 구분자 제거
            .replace(/\s*---+$/gm, '')
            .replace(/^\[게시글 내용\]\s*/i, '')  // 메타 텍스트 제거
            .replace(/^\[작성\]\s*/i, '')
            .replace(/#\S+/g, '')  // 해시태그 제거
            .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // 이모지 제거 (이모티콘)
            .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // 이모지 제거 (기호)
            .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // 이모지 제거 (교통)
            .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')  // 이모지 제거 (국기)
            .replace(/[\u{2600}-\u{26FF}]/gu, '')    // 이모지 제거 (기타)
            .replace(/[\u{2700}-\u{27BF}]/gu, '')    // 이모지 제거 (딩뱃)
            .trim();

        // 3. SKIP 판단 - 작성하지 않기로 결정
        if (postContent.includes("SKIP") || postContent.length < 10) {
            logger.info(`[SNS] ${nextAuthor} decided to skip posting.`);
            if (res) return res.send({ result: "success", message: "AI skipped posting" });
            return;
        }

        // 4. 게시글 저장
        const newPost = {
            author: nextAuthor,
            content: postContent,
            likes: 0,
            commentCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COL_POSTS).add(newPost);
        
        logger.info(`[SNS] Auto Post Created by ${nextAuthor}: ${docRef.id}`);
        logger.info(`[SNS] Content: ${postContent.substring(0, 50)}...`);
        
        if (res) res.send({ result: "success", postId: docRef.id, author: nextAuthor });

    } catch (e) {
        logger.error(`[SNS] autoCreatePost Error: ${e.message}`);
        if (res) res.send({ result: "fail", message: e.message });
    }
};

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
        if (aiName === 'Gemini') {
            result = await callGeminiSNS(prompt);
        } else {
            result = await callOpenAISNS(prompt);
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
            if (aiName === 'Gemini') {
                commentContent = await callGeminiSNS(prompt);
            } else {
                commentContent = await callOpenAISNS(prompt);
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

            t.set(commentRef, {
                postId: postId,
                author: aiName,
                content: commentContent,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

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
 * User의 게시글/댓글에 Gemini와 GPT 모두 답변하는 헬퍼 함수
 */
async function replyBothAIs(postId, userContent) {
    try {
        logger.info(`[SNS] Both AIs replying to User's content on post ${postId}`);
        
        // 사용자의 댓글이 질문인지 확인
        const isQuestion = userContent.includes('?') || 
                          userContent.includes('？') ||
                          /어떻게|어떤|왜|뭐|무엇|언제|어디|누가|질문|알려|궁금/.test(userContent);
        
        // Gemini가 먼저 답변
        await createAIReply(postId, userContent, 'Gemini');
        
        // 질문성 댓글이면 Gemini만 답변하고 GPT는 답변하지 않음
        if (isQuestion) {
            logger.info(`[SNS] User's content is a question. Only Gemini replied, GPT skipped.`);
            return;
        }
        
        // 질문이 아닌 경우에만 GPT도 답변
        // 짧은 대기 후 GPT가 답변 (Gemini 댓글이 저장될 시간 확보)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // GPT가 답변
        await createAIReply(postId, userContent, 'GPT');
        
        logger.info(`[SNS] Both AIs replied successfully to post ${postId}`);
    } catch (error) {
        logger.error(`[SNS] replyBothAIs Error: ${error.message}`);
    }
}

/**
 * User의 게시글/댓글에 AI가 답변하는 헬퍼 함수
 * - Gemini와 GPT가 번갈아가며 답변 (autoAddComment용)
 */
async function replyToPost(postId, userContent) {
    try {
        // 해당 게시글의 댓글 확인하여 다음 답변자 결정
        const commentsSnapshot = await db.collection(COL_COMMENTS)
            .where('postId', '==', postId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let nextCommenter = 'Gemini'; // 기본값
        
        if (!commentsSnapshot.empty) {
            const lastComment = commentsSnapshot.docs[0].data();
            // 마지막 댓글이 Gemini면 GPT, GPT면 Gemini
            if (lastComment.author === 'Gemini') {
                nextCommenter = 'GPT';
            } else if (lastComment.author === 'GPT') {
                nextCommenter = 'Gemini';
            }
        }

        logger.info(`[SNS] ${nextCommenter} replying to User's content`);

        // createAIReply를 사용하여 검색 기능 포함한 답변 생성
        await createAIReply(postId, userContent, nextCommenter);

    } catch (error) {
        logger.error(`[SNS] replyToPost Error: ${error.message}`);
    }
}

/**
 * 최신 뉴스/이슈 검색 헬퍼
 * - Google Trends API 또는 RSS 피드에서 키워드 수집
 * - 실패 시 기본 AI 관련 주제 반환
 */
async function searchLatestNews() {
    try {
        // 옵션 1: 저장된 뉴스 DB에서 최근 AI/기술 관련 뉴스 가져오기
        const newsSnapshot = await db.collection('eink-news')
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        if (!newsSnapshot.empty) {
            const newsTitles = newsSnapshot.docs.map(doc => {
                const data = doc.data();
                return `${data.title} - ${data.summary ? data.summary.substring(0, 100) : ''}`;
            });
            
            if (newsTitles.length > 0) {
                logger.info(`[SNS] Found ${newsTitles.length} recent news items`);
                return newsTitles;
            }
        }

        // 옵션 2: 외부 RSS 피드 (AI 관련 뉴스)
        const rssFeeds = [
            'https://news.google.com/rss/search?q=AI+인공지능&hl=ko&gl=KR&ceid=KR:ko',
            'https://news.google.com/rss/search?q=ChatGPT+Gemini&hl=ko&gl=KR&ceid=KR:ko'
        ];

        const Parser = require('rss-parser');
        const parser = new Parser();
        
        for (const feedUrl of rssFeeds) {
            try {
                const feed = await parser.parseURL(feedUrl);
                if (feed.items && feed.items.length > 0) {
                    const titles = feed.items.slice(0, 5).map(item => item.title);
                    logger.info(`[SNS] Found ${titles.length} items from RSS feed`);
                    return titles;
                }
            } catch (rssError) {
                logger.warn(`[SNS] RSS feed error: ${rssError.message}`);
            }
        }

        // 옵션 3: 기본 AI 주제 (검색 실패 시)
        logger.info(`[SNS] Using fallback AI topics`);
        return [
            "최근 AI 기술 발전 동향",
            "ChatGPT와 Gemini의 최신 업데이트",
            "프로그래밍 트렌드와 개발자 도구",
            "실시간 기술 이슈"
        ];

    } catch (error) {
        logger.error(`[SNS] searchLatestNews Error: ${error.message}`);
        return [];
    }
}