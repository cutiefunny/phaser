const { db, admin } = require('./firebaseConfig');
const logger = require("./logger");
const axios = require('axios');
const moment = require('moment');
const { SolapiMessageService } = require("solapi");
require('dotenv').config();


const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

// ==========================================
// 내부 사용용 (영어 명언 -> 한글 운세)
// ==========================================
async function generateFortune() {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        const adviceResponse = await axios.get('https://api.adviceslip.com/advice');
        const originalText = adviceResponse.data.slip.advice;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const geminiBody = {
            contents: [{
                parts: [{
                    text: `Translate the following sentence into Korean efficiently and naturally, like a one-line fortune. Output only the Korean text without quotes.\n\nSentence: "${originalText}"`
                }]
            }]
        };

        const geminiResponse = await axios.post(geminiUrl, geminiBody, { headers: { 'Content-Type': 'application/json' } });
        return geminiResponse.data.candidates[0].content.parts[0].text.trim();
    } catch (e) {
        logger.error("generateFortune internal error:", e);
        throw e;
    }
}

exports.generateFortune = generateFortune;

// ==========================================
// Solapi (알림톡) 관련 API
// ==========================================

exports.sendKakaotalk = async function (req, res) {
    let { to, pfId, templateId, variables, text } = req.body;
    if (!to || !pfId || !templateId) {
        return res.send({ result: "fail", message: "Missing required fields" });
    }

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: text || "알림톡 발송에 실패하여 문자로 대신 발송합니다.",
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: variables || {}
            }
        });
        res.send({ result: "success", op: "sendKakaotalk", data: response });
    } catch (e) {
        logger.error("sendKakaotalk exception: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendClassConfirmation = async function (req, res) {
    let { to, className, classDate, userName } = req.body;
    if (!to || !className || !classDate || !userName) {
        return res.send({ result: "fail", message: "필수 정보(to, className, classDate, userName)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260331024937668DR33pfsqSPu";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수강 확정 안내]\n\n수업명 : ${className}\n수업일시 : ${classDate}\n신청자 : ${userName}\n\nmusclecat.co.kr/lesson\n\n취소는 수업신청 페이지에서 가능!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "수업일시": classDate,
                    "이름": `${userName}\n\nhttps://musclecat.co.kr/lesson`
                }
            }
        });
        res.send({ result: "success", op: "sendClassConfirmation", data: response });
    } catch (e) {
        logger.error("sendClassConfirmation exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendClassWaiting = async function (req, res) {
    let { to, className, classDate, userName, waitingNo } = req.body;
    if (!to || !className || !classDate || !userName || !waitingNo) {
        return res.send({ result: "fail", message: "필수 정보(to, className, classDate, userName, waitingNo)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260401033715801lucYG02Twnu";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수강 대기 안내]\n\n수업명 : ${className}\n수업일시 : ${classDate}\n신청자 : ${userName}\n대기순번 : ${waitingNo}\n\n기존 참여자의 취소로 인한 수강 확정 시 다시 카카오톡으로 알려 드립니다!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "수업일시": classDate,
                    "이름": userName,
                    "순번": waitingNo
                }
            }
        });
        res.send({ result: "success", op: "sendClassWaiting", data: response });
    } catch (e) {
        logger.error("sendClassWaiting exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendClassChange = async function (req, res) {
    let { to, className, guide } = req.body;
    if (!to || !className || !guide) {
        return res.send({ result: "fail", message: "필수 정보(to, className, guide)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260331025036945mj7yaWFz7BK";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[수업 변경 안내]\n\n수업명 : ${className}\n${guide}\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "안내문": guide
                }
            }
        });
        res.send({ result: "success", op: "sendClassChange", data: response });
    } catch (e) {
        logger.error("sendClassChange exception: " + e.message);
        console.error("[Solapi Error Details]", JSON.stringify(e, null, 2));
        res.send({ result: "fail", message: e.message, details: e });
    }
};

exports.sendClassQuestion = async function (req, res) {
    let { className } = req.body;
    if (!className) {
        return res.send({ result: "fail", message: "필수 정보(className)가 누락되었습니다." });
    }

    const to = "01083151379";
    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260402075509258eiV8A49de7P";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[새로운 수업 상담요청]\n\n수업명 : ${className}\n\n위 수업에 대한 새로운 상담요청이 도착했습니다.\n\n-----\n해당 메세지는 수업 상담에 빠르게 응답하기 위한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className
                }
            }
        });
        res.send({ result: "success", op: "sendClassQuestion", data: response });
    } catch (e) {
        logger.error("sendClassQuestion exception: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendClassRequestNotice = async function (req, res) {
    let { className, classDate, userName, userPhone } = req.body;
    if (!className || !classDate || !userName || !userPhone) {
        return res.send({ result: "fail", message: "필수 정보(className, classDate, userName, userPhone)가 누락되었습니다." });
    }

    const to = "01083151379";
    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260402075703908aUaGQwNv1n0";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[새로운 수업 신청 알림]\n\n수업명 : ${className}\n수업일시 : ${classDate}\n신청자 : ${userName}\n전화번호 : ${userPhone}\n\n-----\n해당 메세지는 수업 신청을 빠르게 확인하기 위한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "일시": classDate,
                    "이름": userName,
                    "전화번호": userPhone
                }
            }
        });
        res.send({ result: "success", op: "sendClassRequestNotice", data: response });
    } catch (e) {
        logger.error("sendClassRequestNotice exception: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendClassAlarm = async function (req, res) {
    let { to, className, classTime } = req.body;
    if (!to || !className || !classTime) {
        return res.send({ result: "fail", message: "필수 정보(to, className, classTime)가 누락되었습니다." });
    }

    const pfId = "KA01PF251023155453466zUYSFWha1ci";
    const templateId = "KA01TP260401074810183l3MBCkVj7p2";

    try {
        const response = await messageService.send({
            to: to,
            from: process.env.SOLAPI_SENDER_NUMBER,
            text: `[금일 잡화점 수업 안내]\n\n수업명 : ${className}\n수업시간: ${classTime}\n수업장소 : 독막로79 1층\n\n곧 만나요!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
            kakaoOptions: {
                pfId: pfId,
                templateId: templateId,
                variables: {
                    "수업명": className,
                    "시간": `${classTime}\n수업장소 : 독막로79 1층`
                }
            }
        });
        res.send({ result: "success", op: "sendClassAlarm", data: response });
    } catch (e) {
        logger.error("sendClassAlarm exception: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendFortune = async function (req, res) {
    try {
        const snapshot = await db.collection('luckMembers').get();
        const phoneNumbers = [];
        snapshot.forEach(doc => {
            if (doc.data().phone) phoneNumbers.push(doc.data().phone);
        });

        if (phoneNumbers.length === 0) {
            return res.send({ result: "success", message: "No recipients found." });
        }

        const messagePromises = phoneNumbers.map(async (phone) => {
            try {
                const fortuneText = await generateFortune();
                return {
                    to: phone,
                    from: process.env.SOLAPI_SENDER_NUMBER,
                    text: "오늘의 운세가 도착했어요!",
                    kakaoOptions: {
                        pfId: "KA01PF251023155453466zUYSFWha1ci",
                        templateId: "KA01TP251023175627378FUOi9NrdvXQ",
                        variables: { "운세": fortuneText }
                    }
                };
            } catch (err) {
                return null;
            }
        });

        const results = await Promise.all(messagePromises);
        const messagesToSend = results.filter(msg => msg !== null);

        if (messagesToSend.length > 0) {
            const response = await messageService.send(messagesToSend);
            res.send({ result: "success", count: messagesToSend.length, solapiResponse: response });
        } else {
            throw new Error("발송할 메시지가 없습니다.");
        }
    } catch (e) {
        logger.error("sendFortune error: " + e.message);
        res.send({ result: "fail", message: e.message });
    }
};

exports.sendBatchClassAlarms = async function () {
    try {
        const today = moment().format('YYYY-MM-DD');
        logger.info(`[sendBatchClassAlarms] Checking class for today: ${today}`);
        
        const docRef = db.collection('guitarClass').doc(today);
        const doc = await docRef.get();

        if (!doc.exists) {
            logger.info(`[sendBatchClassAlarms] No class scheduled for today (${today}).`);
            return;
        }

        const classData = doc.data();
        const { className, classTime, students } = classData;

        if (!students || !Array.isArray(students) || students.length === 0) {
            logger.info(`[sendBatchClassAlarms] No students for today's class (${today}).`);
            return;
        }

        logger.info(`[sendBatchClassAlarms] Sending alarms for class: ${className} at ${classTime} to ${students.length} students.`);

        for (const student of students) {
            if (student.phone) {
                try {
                    await messageService.send({
                        to: student.phone,
                        from: process.env.SOLAPI_SENDER_NUMBER,
                        text: `[금일 잡화점 수업 안내]\n\n수업명 : ${className}\n수업시간: ${classTime}\n수업장소 : 독막로79 1층\n\n곧 만나요!\n\n-----\n해당 메세지는 고객님께서 신청하신 잡화점 수업에 대한 알림입니다.\n제공 : 근육고양이잡화점`,
                        kakaoOptions: {
                            pfId: "KA01PF251023155453466zUYSFWha1ci",
                            templateId: "KA01TP260401074810183l3MBCkVj7p2",
                            variables: {
                                "수업명": className,
                                "시간": `${classTime}\n수업장소 : 독막로79 1층`
                            }
                        }
                    });
                    logger.info(`[sendBatchClassAlarms] Sent to ${student.phone}`);
                } catch (err) {
                    logger.error(`[sendBatchClassAlarms] Failed to send to ${student.phone}: ${err.message}`);
                }
            }
        }
    } catch (e) {
        logger.error(`[sendBatchClassAlarms] Error: ${e.message}`);
    }
};
