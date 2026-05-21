const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái hệ thống
let isProcessing = false; // Khóa chống trùng lặp toàn cục
const audioBuffers = new Map();     
const recordingTimers = new Map();  

app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ESP32 Audio & Gemini AI Radar</title>
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
                    <h1 class="text-2xl font-bold text-cyan-400 flex items-center gap-2">🎙️ Hệ Thống Radar Âm Thanh & AI</h1>
                    <p class="text-xs text-slate-400 mt-1">Kết nối liên tục - Kích hoạt Realtime - Phân tích phổ tần số</p>
                </div>
                <div id="connection-status" class="mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit">
                    🔴 Mất kết nối Monitor
                </div>
            </header>

            <!-- Thống kê trạng thái -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Trạng thái hệ thống</h2>
                    <div id="system-state" class="text-lg font-bold text-emerald-400 mt-1">HỆ THỐNG SẴN SÀNG</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Gói lệnh thu âm</h2>
                    <div id="buffer-count" class="text-2xl font-extrabold text-cyan-400 mt-1">0</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Độ trễ Ping-Pong</h2>
                    <div id="latency" class="text-lg font-bold text-emerald-400 mt-1">0 ms</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs text-slate-400 uppercase font-semibold">Âm thanh phản hồi</h2>
                    <div class="flex items-center gap-2 mt-2">
                        <input type="checkbox" id="mute-voice" class="rounded bg-slate-950 border-slate-800 text-cyan-500">
                        <label for="mute-voice" class="text-xs text-slate-300 cursor-pointer">Nghe giọng nói (Live)</label>
                    </div>
                </div>
            </div>

            <!-- Khu vực đồ thị trực quan -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Sơ đồ sóng âm (Waveform)</h2>
                    <canvas id="waveform" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Phổ tần số nhiễu bệnh (FFT Spectrum)</h2>
                    <canvas id="spectrum" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas>
                </div>
            </div>

            <!-- Kết quả AI và Log -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-1">
                    <h2 class="text-sm font-bold text-slate-100 mb-2">🤖 Phản hồi từ Gemini AI</h2>
                    <div id="ai-response" class="bg-slate-950 border border-slate-800 p-3 rounded-lg text-slate-300 font-mono text-xs min-h-[120px] whitespace-pre-wrap">
                        Chờ lệnh từ thiết bị...
                    </div>
                </div>
                <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-2 flex flex-col h-[180px]">
                    <div class="flex items-center justify-between mb-2">
                        <h2 class="text-sm font-bold text-slate-100">📋 Nhật Ký Hệ Thống</h2>
                        <button onclick="document.getElementById('log-box').innerHTML=''" class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Xóa</button>
                    </div>
                    <div id="log-box" class="log-container bg-slate-950 border border-slate-800 p-3 rounded-lg font-mono text-[11px] text-slate-400 overflow-y-auto flex-1 space-y-1">
                        [Hệ thống] Trình giám sát đã khởi tạo thành công.
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
            const muteVoice = document.getElementById('mute-voice');

            // Khởi tạo Audio Context để nghe tiếng bản thân và phân tích FFT
            let audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            let analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            let bufferLength = analyser.frequencyBinCount;
            let dataArray = new Uint8Array(bufferLength);

            // Cấu hình Canvas vẽ đồ thị
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
                            stateDiv.innerText = data.state;
                            bufferDiv.innerText = data.bufferLength;
                            if (data.log) addLog(data.log, data.logType || 'info');
                            if (data.aiResponse) aiDiv.innerText = data.aiResponse;
                        }
                    } catch(e) {}
                    return;
                }

                // XỬ LÝ ÂM THANH NHỊ PHÂN RAW PCM 16-BIT TỪ ESP32 GỬI QUA SERVER
                if (event.data.byteLength > 0) {
                    let now = Date.now();
                    latencyDiv.innerText = (now - lastPacketTime) + " ms";
                    lastPacketTime = now;

                    let int16Array = new Int16Array(event.data);
                    let float32Array = new Float32Array(int16Array.length);
                    
                    // Chuẩn hóa PCM 16-bit về khoảng [-1.0, 1.0] cho Web Audio API
                    for (let i = 0; i < int16Array.length; i++) {
                        float32Array[i] = int16Array[i] / 32768.0;
                    }

                    // Phát ra loa máy tính nếu người dùng tích chọn "Nghe giọng"
                    if (!muteVoice.checked) {
                        let audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000);
                        audioBuffer.getChannelData(0).set(float32Array);
                        let source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(analyser);
                        analyser.connect(audioCtx.destination);
                        source.start();
                    } else {
                        // Vẫn đưa vào bộ phân tích đồ thị nhưng không cho ra loa ngoài
                        let audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000);
                        audioBuffer.getChannelData(0).set(float32Array);
                        let source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(analyser);
                        source.start();
                    }
                }
            };

            // Vòng lặp Render đồ thị tần số (FFT) và Sóng âm
            function drawCharts() {
                requestAnimationFrame(drawCharts);
                
                // 1. Vẽ Đồ thị dạng Sóng (Waveform)
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

                // 2. Vẽ Biểu đồ cột tần số nhiễu (Spectrum)
                analyser.getByteFrequencyData(dataArray);
                ctxSpec.fillStyle = '#0b0f19';
                ctxSpec.fillRect(0, 0, canvasSpec.width, canvasSpec.height);
                let barWidth = (canvasSpec.width / bufferLength) * 1.5;
                let barHeight;
                let xSpec = 0;
                for (let i = 0; i < bufferLength; i++) {
                    barHeight = dataArray[i] / 1.5;
                    // Đổi màu sắc từ xanh sang đỏ dựa vào dải tần (giúp phát hiện nhiễu xung cao tần)
                    ctxSpec.fillStyle = 'rgb(' + (barHeight+100) + ',34,180)';
                    ctxSpec.fillRect(xSpec, canvasSpec.height - barHeight, barWidth - 1, barHeight);
                    xSpec += barWidth;
                }
            }
            drawCharts();
            
            // Kích hoạt AudioContext khi click màn hình (Luật bảo mật Chrome)
            window.addEventListener('click', () => { if(audioCtx.state === 'suspended') audioCtx.resume(); });
        </script>
    </body>
    </html>
    `);
});

app.get('/', (req, res) => res.redirect('/dashboard'));

const server = app.listen(PORT, () => console.log(`Server chạy tại: http://localhost:${PORT}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    ws.isHardware = false; 
    
    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            // Nhận diện luồng từ phần cứng gửi lên
            ws.isHardware = true; 

            // NẾU HỆ THỐNG ĐANG BẬN XỬ LÝ -> KHÔNG NHẬN YÊU CẦU, NGẮT NGAY
            if (isProcessing) {
                return; 
            }

            // Gói nhị phân đầu tiên của phiên ghi âm mới
            if (!recordingTimers.has(ws)) {
                audioBuffers.set(ws, []);
                console.log('🎙️ [Kích hoạt] Thu âm câu lệnh (Tối đa 5s)...');
                
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG THU LỆNH CHÍNH',
                    bufferLength: 0,
                    log: '🔊 Phát hiện giọng nói! Đang nạp luồng âm thanh thời gian thực...',
                    logType: 'success'
                });

                // Đồng hồ đếm ngược đúng 4.5 giây (rút ngắn thời gian để giảm dung lượng tải lên Gemini)
                let timer = setTimeout(() => {
                    processCommand(ws);
                }, 4500);
                recordingTimers.set(ws, timer);
            }

            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Stream ngược gói tin thô về cho Trình duyệt Dashboard vẽ đồ thị & phát tiếng kêu
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message);
                }
            });

            if (bufferList.length % 8 === 0) {
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG THU LỆNH CHÍNH',
                    bufferLength: bufferList.length
                });
            }
        } else {
            // Xử lý gói Text điều khiển trạng thái từ ESP32 gửi lên
            try {
                const textMsg = message.toString();
                if (textMsg === "RESET_STATE") {
                    isProcessing = false; // Mở khóa hệ thống, cho phép nhận lệnh tiếp theo
                    broadcastToMonitor({
                        type: 'MONITOR_UPDATE',
                        state: '🟢 SẴN SÀNG',
                        bufferLength: 0,
                        log: '🔓 ESP32 đã sẵn sàng quét âm thanh cho chu kỳ mới.',
                        logType: 'info'
                    });
                }
            } catch(e) {}
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);
    });
});

async function processCommand(ws) {
    isProcessing = true; // BẬT KHÓA TOÀN CỤC CHỐNG TRÙNG LẶP

    broadcastToMonitor({ 
        type: 'MONITOR_UPDATE', 
        state: '⚙️ ĐANG XỬ LÝ LỆNH...', 
        bufferLength: 0, 
        log: '⚡ Khóa luồng thu âm! Đang nén dữ liệu và biên dịch qua Gemini AI...', 
        logType: 'warn' 
    });

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

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý nhà thông minh tiếng Việt. Phân tích đoạn âm thanh:
                    - Nếu muốn BẬT đèn/led/thiết bị -> trả về led = 1 và text phản hồi.
                    - Nếu muốn TẮT đèn/led/thiết bị -> trả về led = 0 và text phản hồi.
                    - Các trường hợp khác hoặc không rõ ràng -> trả về led = -1.`
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

        let cleanText = response.text ? response.text.trim() : null;
        const resultJson = JSON.parse(cleanText);

        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '🟢 AI quyết định: BẬT LED D2.', logType: 'success', aiResponse: resultJson.text });
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '🔴 AI quyết định: TẮT LED D2.', logType: 'success', aiResponse: resultJson.text });
            } else {
                ws.send("CMD_DONE");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '⚠️ AI không nhận diện rõ câu lệnh.', logType: 'warn', aiResponse: resultJson.text });
            }
        }

    } catch (error) {
        if (ws.readyState === 1) ws.send("CMD_DONE");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 LỖI HỆ THỐNG', bufferLength: 0, log: `Lỗi API Gemini: ${error.message}`, logType: 'error' });
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
