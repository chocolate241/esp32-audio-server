const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let isProcessing = false; 
const audioBuffers = new Map();    
const recordingTimers = new Map();  

app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>ESP32 Console</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-[#0b0f19] text-slate-200 p-6">
        <div class="max-w-4xl mx-auto space-y-6">
            <div class="flex justify-between border-b border-slate-800 pb-4">
                <h1 class="text-xl font-bold text-cyan-400">🎙️ ESP32 Audio AI Radar</h1>
                <div id="status" class="text-xs px-3 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">🔴 Offline</div>
            </div>
            <div class="grid grid-cols-3 gap-4">
                <div class="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <span class="text-xs text-slate-400">Trạng thái</span>
                    <div id="state" class="text-base font-bold mt-1 text-emerald-400">SẴN SÀNG</div>
                </div>
                <div class="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <span class="text-xs text-slate-400">Gói dữ liệu</span>
                    <div id="buffer" class="text-base font-bold mt-1 text-cyan-400">0</div>
                </div>
                <div class="bg-slate-900 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                    <label class="text-xs text-slate-400 cursor-pointer" for="live">Nghe giọng nói (Live)</label>
                    <input type="checkbox" id="live" class="rounded bg-slate-950 border-slate-800" checked>
                </div>
            </div>
            <div class="bg-slate-900 p-4 rounded-xl border border-slate-800">
                <span class="text-xs text-slate-400">Phản hồi AI</span>
                <div id="ai" class="bg-slate-950 p-3 rounded mt-2 text-xs font-mono min-h-[60px]">Chờ lệnh...</div>
            </div>
            <div class="bg-slate-900 p-4 rounded-xl border border-slate-800">
                <span class="text-xs text-slate-400">Log</span>
                <div id="log" class="bg-slate-950 p-3 rounded mt-2 text-[11px] font-mono h-32 overflow-y-auto space-y-1 text-slate-400"></div>
            </div>
        </div>
        <script>
            const logBox = document.getElementById('log');
            let audioCtx = null;
            let nextPlayTime = 0;

            function addLog(msg) {
                logBox.innerHTML += '<div>' + msg + '</div>';
                logBox.scrollTop = logBox.scrollHeight;
            }

            const ws = new WebSocket(window.location.protocol === 'https:' ? 'wss://' : 'ws://' + window.location.host);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {  document.getElementById('status').innerText = '🟢 Online'; };
            ws.onclose = () => { document.getElementById('status').innerText = '🔴 Offline'; };

            ws.onmessage = (e) => {
                if (typeof e.data === 'string') {
                    try {
                        const d = JSON.parse(e.data);
                        if(d.state) document.getElementById('state').innerText = d.state;
                        if(d.buffer !== undefined) document.getElementById('buffer').innerText = d.buffer;
                        if(d.log) addLog(d.log);
                        if(d.ai) document.getElementById('ai').innerText = d.ai;
                    } catch(err){}
                    return;
                }
                
                // PHÁT LIVE AUDIO CHUẨN: Đồng bộ thẳng mảng Int16 từ ESP32 mà không qua xử lý trung gian gây delay
                if (e.data.byteLength > 0 && document.getElementById('live').checked) {
                    if(!audioCtx) {
                        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                        nextPlayTime = audioCtx.currentTime;
                    }
                    if (audioCtx.state === 'suspended') audioCtx.resume();

                    let int16 = new Int16Array(e.data);
                    let f32 = new Float32Array(int16.length);
                    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768.0;

                    let buffer = audioCtx.createBuffer(1, f32.length, 16000);
                    buffer.getChannelData(0).set(f32);
                    let src = audioCtx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(audioCtx.destination);
                    
                    if (nextPlayTime < audioCtx.currentTime) nextPlayTime = audioCtx.currentTime;
                    src.start(nextPlayTime);
                    nextPlayTime += buffer.duration;
                }
            };
            window.addEventListener('click', () => { if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });
        </script>
    </body>
    </html>
    `);
});

app.get('/', (req, res) => res.redirect('/dashboard'));

const server = app.listen(PORT, () => console.log(`Running on ${PORT}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.isHardware = false;
   
    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            ws.isHardware = true;
            if (isProcessing) return;

            // QUY TRÌNH TIMEOUT 5 GIÂY GỐC CỦA BẠN - KHÔNG SỬA ĐỔI ĐỂ TRÁNH TRỄ LŨY KẾ
            if (!recordingTimers.has(ws)) {
                audioBuffers.set(ws, []);
                broadcastToMonitor({ state: '🔴 ĐANG THU LỆNH', buffer: 0, log: '🎙️ Bắt đầu ghi âm câu lệnh...' });
               
                let timer = setTimeout(() => {
                    processCommand(ws);
                }, 5000);
                recordingTimers.set(ws, timer);
            }

            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Forward nguyên bản data nhị phân về giao diện Client để vẽ đồ thị / phát Live nhanh nhất
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message);
                }
            });

            if (bufferList.length % 10 === 0) {
                broadcastToMonitor({ buffer: bufferList.length });
            }
        } else {
            if (message.toString() === "RESET_STATE") {
                isProcessing = false;
                broadcastToMonitor({ state: '🟢 SẴN SÀNG', buffer: 0, log: '🔓 Hệ thống rảnh.' });
            }
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);
    });
});

async function processCommand(ws) {
    isProcessing = true;
    broadcastToMonitor({ state: '⚙️ XỬ LÝ LỆNH...', log: '⚡ Đang gửi dữ liệu sang Gemini AI...' });

    let pcmBuffers = audioBuffers.get(ws) || [];
    audioBuffers.delete(ws);
    if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
    recordingTimers.delete(ws);

    if (pcmBuffers.length === 0) {
        isProcessing = false;
        if (ws.readyState === 1) ws.send("CMD_DONE");
        return;
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        // SỬ DỤNG STRICT SCHEMA ĐỂ ĐẢM BẢO CHÍNH XÁC KẾT QUẢ TRẢ VỀ
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Phân tích âm thanh điều khiển nhà thông minh bằng tiếng Việt:
                    - Nếu muốn BẬT thiết bị/đèn/led -> trả về led = 1 và một câu text ngắn gọn.
                    - Nếu muốn TẮT thiết bị/đèn/led -> trả về led = 0 và một câu text ngắn gọn.
                    - Khác hoặc không rõ -> trả về led = -1 và một câu phản hồi tương ứng.`
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        led: { type: Type.INTEGER },
                        text: { type: Type.STRING }
                    },
                    required: ["led", "text"]
                }
            }
        });

        let cleanText = response.text ? response.text.trim() : "{\"led\":-1,\"text\":\"Error\"}";
        const resultJson = JSON.parse(cleanText);

        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
                broadcastToMonitor({ log: '🟢 Kết quả: BẬT LED D2', ai: resultJson.text });
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                broadcastToMonitor({ log: '🔴 Kết quả: TẮT LED D2', ai: resultJson.text });
            } else {
                ws.send("CMD_DONE");
                broadcastToMonitor({ log: '⚠️ Lệnh không rõ ràng', ai: resultJson.text });
            }
        }
    } catch (error) {
        if (ws.readyState === 1) ws.send("CMD_DONE");
        broadcastToMonitor({ log: `❌ Lỗi API: ${error.message}` });
        isProcessing = false;
    }
}

function createWavBuffer(pcmBuffers, sampleRate = 16000) {
    let pcmBuffer = Buffer.concat(pcmBuffers);
    let wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(1, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28);
    wavBuffer.writeUInt16LE(2, 32);
    wavBuffer.writeUInt16LE(16, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
    pcmBuffer.copy(wavBuffer, 44);
    return wavBuffer;
}

function broadcastToMonitor(obj) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1 && !client.isHardware) {
            client.send(JSON.stringify(obj));
        }
    });
}
