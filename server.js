// ========================= SERVER.JS =========================
// Smart Gemini AI Voice Server
// Optimized:
// - Low quota
// - Low latency
// - PCM raw audio
// - Smart intent detection
// - Websocket realtime

const express = require('express');
const { WebSocketServer } = require('ws');

const { GoogleGenAI, Type } = require('@google/genai');

require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// =====================================================

const server = app.listen(PORT, () => {
    console.log("🚀 SERVER RUNNING");
});

const wss = new WebSocketServer({ server });

// =====================================================

let isProcessing = false;

const audioBuffers = new Map();

let lastIntent = "";
let lastIntentTime = 0;

// =====================================================

app.get('/', (req, res) => {

    res.send("ESP32 GEMINI AI SERVER RUNNING");
});

// =====================================================

wss.on('connection', (ws) => {

    console.log("🟢 NEW CONNECTION");

    ws.on('message', async (message, isBinary) => {

        // ================= AUDIO =================

        if (isBinary) {

            if (isProcessing) return;

            if (!audioBuffers.has(ws)) {
                audioBuffers.set(ws, []);
            }

            audioBuffers.get(ws).push(Buffer.from(message));

            return;
        }

        // ================= TEXT =================

        const text = message.toString();

        console.log("📩", text);

        // ================= END AUDIO =================

        if (text === "END_AUDIO") {

            processAudio(ws);
        }

        // ================= RESET =================

        if (text === "RESET_STATE") {

            isProcessing = false;
        }
    });

    ws.on('close', () => {

        audioBuffers.delete(ws);

        console.log("❌ CLIENT DISCONNECTED");
    });
});

// =====================================================

async function processAudio(ws) {

    try {

        isProcessing = true;

        console.log("⚡ PROCESSING AUDIO");

        const buffers = audioBuffers.get(ws) || [];

        audioBuffers.delete(ws);

        if (buffers.length === 0) {

            isProcessing = false;

            ws.send("CMD_DONE");

            return;
        }

        // ================= PCM RAW =================

        const pcmBuffer = Buffer.concat(buffers);

        const base64Audio = pcmBuffer.toString('base64');

        // ================= GEMINI =================

        const response = await ai.models.generateContent({

            model: "gemini-3.1-flash-lite",

            contents: [

                {
                    inlineData: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Audio
                    }
                },

                {
                    text: `
Bạn là AI Smart Home tiếng Việt.

Nhiệm vụ:
- hiểu ý định người dùng
- chỉ điều khiển đèn

Các intent:

1. LIGHT_ON
Ví dụ:
- bật đèn
- mở đèn
- sáng lên
- tối quá
- bật giúp tôi
- cho sáng lên

2. LIGHT_OFF
Ví dụ:
- tắt đèn
- ngủ đi
- tối lại
- tắt hết
- off đèn

3. UNKNOWN

Chỉ trả JSON:
{
 "intent":"LIGHT_ON",
 "text":"Đã bật đèn"
}
`
                }
            ],

            config: {

                responseMimeType: "application/json",

                responseSchema: {

                    type: Type.OBJECT,

                    properties: {

                        intent: {
                            type: Type.STRING
                        },

                        text: {
                            type: Type.STRING
                        }
                    },

                    required: ["intent", "text"]
                }
            }
        });

        const result = JSON.parse(response.text.trim());

        console.log("🤖", result);

        // ================= CACHE =================

        const now = Date.now();

        if (
            result.intent === lastIntent &&
            now - lastIntentTime < 5000
        ) {

            console.log("⚠️ DUPLICATE COMMAND");

            ws.send("CMD_DONE");

            isProcessing = false;

            return;
        }

        lastIntent = result.intent;
        lastIntentTime = now;

        // ================= COMMAND =================

        if (result.intent === "LIGHT_ON") {

            ws.send("LED_ON");
        }

        else if (result.intent === "LIGHT_OFF") {

            ws.send("LED_OFF");
        }

        else {

            ws.send("CMD_DONE");
        }

        console.log("✅ DONE");

        isProcessing = false;
    }

    catch (err) {

        console.log("❌ ERROR:", err.message);

        try {
            ws.send("CMD_DONE");
        }
        catch(e){}

        isProcessing = false;
    }
}


