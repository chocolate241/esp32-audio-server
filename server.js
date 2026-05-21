const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const audioBuffers = new Map();     
const recordingTimers = new Map();  

// Biến lưu trữ file WAV mới nhất để người dùng tải về test mic
let lastWavBuffer = null;

// --- DASHBOARD MONITOR NÂNG CẤP HIỆN SÓNG ÂM & NGHE THỬ ---
app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ESP32 Audio & Gemini AI Monitor</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body { background-color: #0f172a; }
            .log-container::-webkit-scrollbar { width: 6px; }
            .log-container::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 3px; }
        </style>
    </head>
    <body class="text-slate-200 font-sans antialiased p-4 md:p-8">
        <div class="max-w-5xl mx-auto space-y-6">
            <header class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4">
                <div>
                    <h1 class="text-2xl font-bold text-cyan-400">🎙️ Hệ Thống Giám Sát & Kiểm Tra Micro</h1>
                    <p class="text-sm text-slate-400">Hỗ trợ hiển thị sóng âm Oscilloscope Realtime & Tải file nghe thử giọng</p>
                </div>
                <div class="mt-2 md:mt-0">
                    <span id="connection-status" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        <span class="h-2 w-2 rounded-full bg-red-500"></span> Mất kết nối Monitor
                    </span>
                </div>
            </header>

            <!-- KHU VỰC ĐỒ THỊ SÓNG ÂM REALTIME -->
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xl">📊</span>
                        <h2 class="text-md font-semibold text-slate-300">Biểu đồ sóng âm Realtime từ ESP32 (Oscilloscope)</h2>
                    </div>
                    <button id="download-btn" onclick="downloadAudio()" class="hidden bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 px-3 rounded transition shadow">
                        📥 Tải file âm thanh vừa nói (.wav)
                    </button>
                </div>
                <div class="relative w-full h-32 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                    <canvas id="waveform" class="w-full h-full"></canvas>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Trạng thái ESP32</h2>
                    <div id="system-state" class="text-xl font-bold text-emerald-400">CHỜ KÍCH HOẠT ÂM THANH...</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Số Gói Lệnh Tích Lũy</h2>
                    <div id="buffer-count" class="text-3xl font-extrabold text-cyan-400">0</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tốc độ mạng stream</h2>
                    <div id="latency" class="text-xl font-bold text-emerald-400">0 ms</div>
                </div>
            </div>

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-xl">🤖</span>
                    <h2 class="text-lg font-bold text-slate-100">Kết quả xử lý từ Gemini AI</h2>
                </div>
                <div id="ai-response" class="bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-300 font-mono text-sm min-h-[60px] whitespace-pre-wrap">
                    Đang ở chế độ ngủ đông... Hãy nói trực tiếp vào micro của ESP32 để kích hoạt luồng điều khiển.
                </div>
            </div>

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col h-[250px]">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-xl">📋</span>
                        <h2 class="text-lg font-bold text-slate-100">Nhật Ký Thực Thi (System Log)</h2>
                    </div>
                    <button onclick="document.getElementById('log-box').innerHTML=''" class="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition">Xóa Log</button>
                </div>
                <div id="log-box" class="log-container bg-slate-950 border border-slate-800 p-4 rounded-lg font-mono text-xs text-slate-400 overflow-y-auto flex-1 space-y-1">
                    [Hệ thống] Máy chủ sẵn sàng nhận luồng dữ liệu kích hoạt bằng âm lượng...
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
            const downloadBtn = document.getElementById('download-btn');

            // Cấu hình Canvas vẽ sóng âm
            const canvas = document.getElementById('waveform');
            const ctx = canvas.getContext('2d');
            
            function resizeCanvas() {
                canvas.width = canvas.parentElement.clientWidth;
                canvas.height = canvas.parentElement.clientHeight;
            }
            window.addEventListener('resize', resizeCanvas);
            resizeCanvas();

            // Vẽ đường thẳng ban đầu (Trạng thái tĩnh)
            function drawSilentLine() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height / 2);
                ctx.lineTo(canvas.width, canvas.height / 2);
                ctx.stroke();
            }
            drawSilentLine();

            let lastPacketTime = Date.now();

            function addLog(message, type = 'info') {
                const now = new Date();
                const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
                let color = 'text-slate-400';
                if (type === 'success') color = 'text-emerald-400 font-semibold';
                if (type === 'warn') color = 'text-amber-400';
                if (type === 'error') color = 'text-red-400 font-bold';
                
                logBox.innerHTML += `<div class="\${color}">[\${timeStr}] \${message}</div>`;
                logBox.scrollTop = logBox.scrollHeight;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            const ws = new WebSocket(protocol + window.location.host);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                connStatus.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                connStatus.innerHTML = '<span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span> Hệ thống giám sát trực tuyến';
                addLog("Kết nối thành công cổng WebSocket Monitor!", "success");
            };

            ws.onclose = () => {
                connStatus.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20";
                connStatus.innerHTML = '<span class="h-2 w-2 rounded-full bg-red-500"></span> Mất kết nối Monitor';
                addLog("Mất kết nối với Server!", "error");
            };

            ws.onmessage = (event) => {
                // Xử lý dữ liệu Text điều khiển UI từ Server
                if (typeof event.data === 'string') {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'MONITOR_UPDATE') {
                            stateDiv.innerText = data.state;
                            bufferDiv.innerText = data.bufferLength;
                            
                            if (data.state.includes('NGHE LỆNH CHÍNH')) {
                                stateDiv.className = "text-xl font-bold text-red-500 animate-pulse";
                            } else if (data.state.includes('CHỜ KÍCH HOẠT')) {
                                stateDiv.className = "text-xl font-bold text-emerald-400";
                                drawSilentLine();
                            } else {
                                stateDiv.className = "text-xl font-bold text-amber-400";
                            }

                            if (data.log) addLog(data.log, data.logType || 'info');
                            if (data.aiResponse) aiDiv.innerText = data.aiResponse;
                            if (data.hasAudio) downloadBtn.classList.remove('hidden');
                        }
                    } catch(e) {}
                    return;
                }

                // Xử lý dữ liệu nhị phân (Binary) -> Vẽ sóng âm trực tiếp
                if (event.data.byteLength > 0) {
                    let now = Date.now();
                    latencyDiv.innerText = (now - lastPacketTime) + " ms";
                    lastPacketTime = now;

                    // Chuyển mảng ArrayBuffer thô 16-bit PCM thành Int16Array để đọc dữ liệu biên độ sóng
                    const audioData = new Int16Array(event.data);
                    drawWaveform(audioData);
                }
            };

            // Hàm xử lý đồ họa vẽ sóng âm lên Canvas
            function drawWaveform(data) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = '#22d3ee'; // Màu Cyan nổi bật
                ctx.lineWidth = 2;
                ctx.beginPath();

                const sliceWidth = canvas.width / data.length;
                let x = 0;

                for (let i = 0; i < data.length; i++) {
                    // Chuẩn hóa biên độ sóng int16 (-32768 đến 32767) vừa khớp chiều cao canvas
                    const v = data[i] / 32768.0; 
                    const y = (v * canvas.height / 2) + (canvas.height / 2);

                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);

                    x += sliceWidth;
                }
                ctx.lineTo(canvas.width, canvas.height / 2);
                ctx.stroke();
            }

            function downloadAudio() {
                window.location.href = '/download-latest-audio';
            }
        </script>
    </body>
    </html>
    `);
});

// Endpoint cho phép tải file âm thanh WAV gần nhất về PC để kiểm tra tiếng micro
app.get('/download-latest-audio', (req, res) => {
    if (!lastWavBuffer) {
        return res.status(404).send("Chưa có file ghi âm nào được lưu lại. Hãy nói vào mic trước.");
    }
    res.set({
        'Content-Type': 'audio/wav',
        'Content-Disposition': 'attachment; filename="esp32_test_mic.wav"',
        'Content-Length': lastWavBuffer.length
    });
    res.send(lastWavBuffer);
});

app.get('/', (req, res) => res.redirect('/dashboard'));

const server = app.listen(PORT, () => console.log(`Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

// ==================== QUẢN LÝ KẾT NỐI WEBSOCKET ====================
wss.on('connection', (ws, req) => {
    ws.isHardware = false; 
    audioBuffers.set(ws, []);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            if (!ws.isHardware) {
                ws.isHardware = true; 
                audioBuffers.set(ws, []); 
                
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG NGHE LỆNH CHÍNH',
                    bufferLength: 0,
                    log: '🔊 ESP32 phát hiện âm thanh lớn! Bắt đầu truyền luồng sóng âm liên tục...',
                    logType: 'success'
                });

                let timer = setTimeout(() => {
                    processCommand(ws);
                }, 5000);
                recordingTimers.set(ws, timer);
            }

            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Gửi trực tiếp dữ liệu âm thanh thô (Binary) sang Web Monitor để vẽ đồ thị sóng realtime
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message); 
                }
            });

            if (bufferList.length % 2 === 0) {
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG NGHE LỆNH CHÍNH',
                    bufferLength: bufferList.length
                });
            }
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);
    });
});

// ==================== BIÊN DỊCH BẰNG GEMINI AI ====================
async function processCommand(ws) {
    broadcastToMonitor({ 
        type: 'MONITOR_UPDATE', 
        state: '⚙️ GEMINI ĐANG BIÊN DỊCH CÂU LỆNH', 
        bufferLength: 0, 
        log: '⏱️ Kết thúc 5 giây thu âm! Đang đóng gói file âm thanh...', 
        logType: 'warn' 
    });

    let pcmBuffers = audioBuffers.get(ws) || [];
    audioBuffers.set(ws, []); 

    if (pcmBuffers.length === 0) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        return;
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        lastWavBuffer = wavBuffer; // Lưu trữ vào biến Global để người dùng có thể tải về nghe thử

        const base64Audio = wavBuffer.toString('base64');

        // Báo cho giao diện Web biết là đã có file âm thanh sẵn sàng để tải về
        broadcastToMonitor({
            type: 'MONITOR_UPDATE',
            state: '⚙️ GEMINI ĐANG BIÊN DỊCH CÂU LỆNH',
            bufferLength: 0,
            hasAudio: true,
            log: '💾 Đã lưu file cache cục bộ! Bạn có thể ấn nút \"Tải file âm thanh\" ở góc trên biểu đồ để nghe thử.'
        });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', 
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là một trợ lý nhà thông minh Việt Nam chuyên nghe lệnh thoại thu âm từ micro phần cứng. Tạp âm nền có thể lớn. Hãy tập trung nghe kỹ từ khóa hành động:
                    - Nếu người dùng nói muốn BẬT/MỞ đèn hoặc thiết bị (Ví dụ: "bật đèn", "bật led", "bật d2", "mở đèn", "sáng đèn"), hãy trả về led = 1.
                    - Nếu người dùng nói muốn TẮT đèn hoặc thiết bị (Ví dụ: "tắt đèn", "tắt led", "tắt d2", "cúp đèn"), hãy trả về led = 0.
                    - Nếu âm thanh chỉ là tiếng ồn hoặc không nghe rõ khẩu lệnh hành động nào, trả về led = -1.
                    
                    Trả về cấu trúc JSON chính xác theo Schema.`
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
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...', bufferLength: 0, log: '🚀 THỰC THI THÀNH CÔNG: Gửi tín hiệu LED2_ON về mạch.', logType: 'success', aiResponse: resultJson.text });
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...', bufferLength: 0, log: '🚀 THỰC THI THÀNH CÔNG: Gửi tín hiệu LED2_OFF về mạch.', logType: 'success', aiResponse: resultJson.text });
            } else {
                ws.send("GO_SLEEP");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...', bufferLength: 0, log: '⚠️ KHÔNG KHỚP LỆNH: Ra lệnh ESP32 ngủ tiếp.', logType: 'warn', aiResponse: resultJson.text });
            }
        }

    } catch (error) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...', bufferLength: 0, log: `Lỗi: ${error.message}`, logType: 'error' });
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
