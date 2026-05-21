const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái thông minh
let isProcessing = false;
const audioBuffers = new Map();    
const silenceTrackers = new Map(); // Theo dõi khoảng lặng để ngắt lệnh sớm

app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ESP32 Audio Smart Console</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body { background-color: #0b0f19; }
            .log-container::-webkit-scrollbar { width: 4px; }
            .log-container::-webkit-scrollbar-thumb { background-color: #1e293b; border-radius: 2px; }
        </style>
    </head>
    <body class="text-slate-200 font-sans p-4 md:p-6">
        <div class="max-w-6xl mx-auto space-y-6">
            <header class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4">
                <div>
                    <h1 class="text-2xl font-bold text-cyan-400 flex items-center gap-2">🎙️ Hệ Thống Điều Khiển Giọng Nói AI v2.0</h1>
                    <p class="text-xs text-slate-400 mt-1">Tối ưu nén âm tần - Xử lý VAD ngắt sớm thông minh</p>
                </div>
                <div id="connection-status" class="mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit">
                    🔴 Mất kết nối Monitor
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Trạng thái hệ thống</h2>
                    <div id="system-state" class="text-lg font-bold text-emerald-400 mt-1">SẴN SÀNG</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Gói lệnh hiện tại</h2>
                    <div id="buffer-count" class="text-2xl font-extrabold text-cyan-400 mt-1">0</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Độ trễ Mạng</h2>
                    <div id="latency" class="text-lg font-bold text-emerald-400 mt-1">0 ms</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Âm thanh phản hồi</h2>
                    <div class="flex items-center gap-2 mt-2">
                        <input type="checkbox" id="live-voice" class="rounded bg-slate-950 border-slate-800 text-cyan-500" checked>
                        <label for="live-voice" class="text-xs text-slate-300 cursor-pointer">Nghe giọng nói (Live)</label>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Sơ đồ sóng âm (Waveform)</h2>
                    <canvas id="waveform" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Phổ tần số (FFT Spectrum)</h2>
                    <canvas id="spectrum" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-1">
                    <h2 class="text-sm font-bold text-slate-100 mb-2">🤖 Phản hồi từ Gemini AI</h2>
                    <div id="ai-response" class="bg-slate-950 border border-slate-800 p-3 rounded-lg text-emerald-400 font-mono text-xs min-h-[120px] whitespace-pre-wrap">
                        Chờ lệnh từ thiết bị...
                    </div>
                </div>
                <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-2 flex flex-col h-[180px]">
                    <div class="flex items-center justify-between mb-2">
                        <h2 class="text-sm font-bold text-slate-100">📋 Nhật Ký Thực Thi</h2>
                        <button onclick="document.getElementById('log-box').innerHTML=''" class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Xóa</button>
                    </div>
                    <div id="log-box" class="log-container bg-slate-950 border border-slate-800 p-3 rounded-lg font-mono text-[11px] text-slate-400 overflow-y-auto flex-1 space-y-1">
                        [Hệ thống] Monitor sẵn sàng.
                    </div>
                </div>
            </div>
        </div>

        <script>
            const logBox = document.getElementById('log-box');
            const stateDiv = document.getElementById('system-state');
            const bufferDiv = document.getElementById('buffer-count');
            const latencyDiv = document.getElementById('latency');
            const aiDiv = document.getElementById('ai-response');
            const connStatus = document.getElementById('connection-status');
            const liveVoice = document.getElementById('live-voice');

            // Thiết lập Web Audio API để phát âm thanh Live từ ESP32 chuẩn xác
            let audioCtx = null;
            let analyser = null;
            let dataArray = null;
            let bufferLength = 0;
            let nextPlayTime = 0; // Tránh hiện tượng chồng chéo giật cục tiếng

            function initAudio() {
                if(audioCtx) return;
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                nextPlayTime = audioCtx.currentTime;
                drawCharts();
            }

            const canvasWave = document.getElementById('waveform');
            const ctxWave = canvasWave.getContext('2d');
            const canvasSpec = document.getElementById('spectrum');
            const ctxSpec = canvasSpec.getContext('2d');

            function resizeCanvases() {
                canvasWave.width = canvasWave.clientWidth; canvasWave.height = canvasWave.clientHeight;
                canvasSpec.width = canvasSpec.clientWidth; canvasSpec.height = canvasSpec.clientHeight;
            }
            window.addEventListener('resize', resizeCanvases);
            resizeCanvases();

            function addLog(message, type = 'info') {
                const now = new Date();
                const timeStr = now.toTimeString().split(' ')[0];
                let color = 'text-slate-400';
                if (type === 'success') color = 'text-emerald-400 font-semibold';
                if (type === 'warn') color = 'text-amber-400';
                if (type === 'error') color = 'text-red-400 font-bold';
                logBox.innerHTML += \`<div class="\${color}">[\${timeStr}] \${message}</div>\`;
                logBox.scrollTop = logBox.scrollHeight;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            const ws = new WebSocket(protocol + window.location.host);
            ws.binaryType = 'arraybuffer';

            let lastPacketTime = Date.now();

            ws.onopen = () => {
                connStatus.className = "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit";
                connStatus.innerText = '🟢 Hệ thống trực tuyến';
            };

            ws.onclose = () => {
                connStatus.className = "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit";
                connStatus.innerText = '🔴 Mất kết nối Monitor';
            };

            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'MONITOR_UPDATE') {
                            if(data.state) stateDiv.innerText = data.state;
                            if(data.bufferLength !== undefined) bufferDiv.innerText = data.bufferLength;
                            if (data.log) addLog(data.log, data.logType || 'info');
                            if (data.aiResponse) aiDiv.innerText = data.aiResponse;
                        }
                    } catch(e) {}
                    return;
                }

                // SỬA LỖI LIVE AUDIO BUTTON: Xử lý mảng nhị phân nhận được phát ra loa liên tục không trễ
                if (event.data.byteLength > 0 && liveVoice.checked) {
                    initAudio();
                    if (audioCtx.state === 'suspended') audioCtx.resume();

                    let now = Date.now();
                    latencyDiv.innerText = (now - lastPacketTime) + " ms";
                    lastPacketTime = now;

                    let int16Array = new Int16Array(event.data);
                    let float32Array = new Float32Array(int16Array.length);
                    for (let i = 0; i < int16Array.length; i++) {
                        float32Array[i] = int16Array[i] / 32768.0;
                    }

                    let audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000);
                    audioBuffer.getChannelData(0).set(float32Array);
                    
                    let source = audioCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(analyser);
                    analyser.connect(audioCtx.destination);
                    
                    // Lên lịch phát chính xác từng gói để âm thanh mượt mà liên tục
                    if (nextPlayTime < audioCtx.currentTime) {
                        nextPlayTime = audioCtx.currentTime;
                    }
                    source.start(nextPlayTime);
                    nextPlayTime += audioBuffer.duration;
                }
            };

            function drawCharts() {
                if(!analyser) return;
                requestAnimationFrame(drawCharts);
               
                analyser.getByteTimeDomainData(dataArray);
                ctxWave.fillStyle = '#0b0f19';
                ctxWave.fillRect(0, 0, canvasWave.width, canvasWave.height);
                ctxWave.lineWidth = 2;
                ctxWave.strokeStyle = '#22d3ee';
                ctxWave.beginPath();
                let sliceWidth = canvasWave.width * 1.0 / bufferLength;
                let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    let v = dataArray[i] / 128.0;
                    let y = v * canvasWave.height / 2;
                    if (i === 0) ctxWave.moveTo(x, y); else ctxWave.lineTo(x, y);
                    x += sliceWidth;
                }
                ctxWave.lineTo(canvasWave.width, canvasWave.height / 2);
                ctxWave.stroke();

                analyser.getByteFrequencyData(dataArray);
                ctxSpec.fillStyle = '#0b0f19';
                ctxSpec.fillRect(0, 0, canvasSpec.width, canvasSpec.height);
                let barWidth = (canvasSpec.width / bufferLength) * 1.5;
                let barHeight;
                let xSpec = 0;
                for (let i = 0; i < bufferLength; i++) {
                    barHeight = dataArray[i] / 1.5;
                    ctxSpec.fillStyle = 'rgb(' + (barHeight+100) + ',34,180)';
                    ctxSpec.fillRect(xSpec, canvasSpec.height - barHeight, barWidth - 1, barHeight);
                    xSpec += barWidth;
                }
            }
            
            window.addEventListener('click', () => { initAudio(); if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });
        </script>
    </body>
    </html>
    `);
});

app.get('/', (req, res) => res.redirect('/dashboard'));

const server = app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.isHardware = false;
   
    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            ws.isHardware = true;
            if (isProcessing) return;

            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Thuật toán VAD: Tính toán biên độ trung bình gói âm thanh hiện tại
            let int16Array = new Int16Array(message.buffer, message.byteOffset, message.byteLength / 2);
            let sum = 0;
            for(let i = 0; i < int16Array.length; i++) {
                sum += Math.abs(int16Array[i]);
            }
            let avgVolume = sum / int16Array.length;

            // Nếu âm lượng sụt xuống dưới 800 (yên lặng), tăng biến đếm khoảng lặng lên
            let silenceState = silenceTrackers.get(ws) || { silencePackets: 0 };
            if (avgVolume < 800) {
                silenceState.silencePackets++;
            } else {
                silenceState.silencePackets = 0; // Có tiếng động lại thì reset
            }
            silenceTrackers.set(ws, silenceState);

            // Bán trực tiếp gói tin về Web Dashboard để hiển thị sóng
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message);
                }
            });

            if (bufferList.length % 5 === 0) {
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG THU ÂM...',
                    bufferLength: bufferList.length
                });
            }

            // TỰ ĐỘNG NGẮT SỚM (VAD): Khoảng 25 gói tin liên tục (~800ms) im lặng -> Đóng gói gửi AI ngay lập tức!
            if (silenceState.silencePackets >= 25 && bufferList.length > 30) {
                console.log("➡️ [VAD] Phát hiện khoảng lặng dứt câu. Tự động xử lý sớm!");
                processCommand(ws);
            }

        } else {
            const textMsg = message.toString();
            if (textMsg === "START_RECORD") {
                audioBuffers.set(ws, []);
                silenceTrackers.set(ws, { silencePackets: 0 });
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG THU LỆNH',
                    bufferLength: 0,
                    log: '🔊 Kích hoạt luồng nhận tín hiệu...',
                    logType: 'success'
                });
            }
            if (textMsg === "STOP_RECORD") {
                processCommand(ws); // Kích hoạt xử lý khi chạm timeout cứng bên ESP32
            }
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        silenceTrackers.delete(ws);
    });
});

async function processCommand(ws) {
    if (isProcessing) return;
    isProcessing = true;

    broadcastToMonitor({
        type: 'MONITOR_UPDATE',
        state: '⚙️ AI ĐANG BIÊN DỊCH...',
        bufferLength: 0,
        log: '⚡ Đang phân tích ngữ nghĩa bằng Gemini AI...',
        logType: 'warn'
    });

    let pcmBuffers = audioBuffers.get(ws) || [];
    audioBuffers.delete(ws);
    silenceTrackers.delete(ws);

    if (pcmBuffers.length < 15) { // Bộ đệm quá ngắn, bỏ qua lỗi nhiễu kích hoạt giả
        isProcessing = false;
        if (ws.readyState === 1) ws.send("CMD_DONE");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 SẴN SÀNG', log: '⚠️ Đoạn âm thanh quá ngắn hoặc chỉ là tiếng động rác.', logType: 'warn'});
        return;
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        // SỬ DỤNG MODEL GEMINI-1.5-FLASH: Tối ưu phản hồi nhanh, miễn phí quota lớn và hiểu lệnh cực nhạy
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý ảo Smarthome tiếng Việt siêu thông minh. Hãy nghe đoạn âm thanh này:
                    - Nếu người dùng muốn BẬT/MỞ đèn, led, thiết bị -> Trả về JSON với led = 1.
                    - Nếu người dùng muốn TẮT/ĐÓNG đèn, led, thiết bị -> Trả về JSON với led = 0.
                    - Mọi trường hợp khác (hỏi đáp vu vơ, không rõ nghĩa, hoặc không liên quan thiết bị) -> Trả về JSON với led = -1.
                    Phần 'text' là câu trả lời ngắn gọn, tự nhiên, thân thiện đáp lại người dùng.`
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

        let cleanText = response.text ? response.text.trim() : "{\"led\":-1, \"text\":\"Không phản hồi\"}";
        const resultJson = JSON.parse(cleanText);

        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 SẴN SÀNG', log: `🟢 [BẬT ĐÈN] -> ${resultJson.text}`, logType: 'success', aiResponse: resultJson.text });
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 SẴN SÀNG', log: `🔴 [TẮT ĐÈN] -> ${resultJson.text}`, logType: 'success', aiResponse: resultJson.text });
            } else {
                ws.send("CMD_DONE");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 SẴN SÀNG', log: `⚠️ [HỎI ĐÁP] -> ${resultJson.text}`, logType: 'warn', aiResponse: resultJson.text });
            }
        }

    } catch (error) {
        console.error(error);
        if (ws.readyState === 1) ws.send("CMD_DONE");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 SẴN SÀNG', log: `❌ Lỗi hệ thống/API: ${error.message}`, logType: 'error' });
    } finally {
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


