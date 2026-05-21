const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Khởi tạo SDK Gemini mới nhất
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái kết nối
const audioBuffers = new Map();     
const recordingTimers = new Map();  

// --- TRANG DASHBOARD THEO DÕI TIẾN ĐỘ CHUYÊN NGHIỆP ---
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
                    <h1 class="text-2xl font-bold text-cyan-400">🎙️ Hệ Thống Giám Sát Ngưỡng Âm Thanh</h1>
                    <p class="text-sm text-slate-400">Chế độ tối ưu hóa tốc độ cao phản hồi Single-Shot kết hợp Gemini AI</p>
                </div>
                <div class="mt-2 md:mt-0">
                    <span id="connection-status" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        <span class="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span> Mất kết nối Monitor
                    </span>
                </div>
            </header>

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

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col h-[350px]">
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

            let lastPacketTime = Date.now();

            function addLog(message, type = 'info') {
                const now = new Date();
                const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
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
                            } else {
                                stateDiv.className = "text-xl font-bold text-amber-400";
                            }

                            if (data.log) addLog(data.log, data.logType || 'info');
                            if (data.aiResponse) aiDiv.innerText = data.aiResponse;
                        }
                    } catch(e) {}
                    return;
                }

                if (event.data.byteLength > 0) {
                    let now = Date.now();
                    let delta = now - lastPacketTime;
                    lastPacketTime = now;
                    latencyDiv.innerText = delta + " ms";
                }
            };
        </script>
    </body>
    </html>
    `);
});

app.get('/', (req, res) => res.redirect('/dashboard'));

const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

// ==================== QUẢN LÝ KẾT NỐI WEBSOCKET TIẾT KIỆM COMMAND ====================
wss.on('connection', (ws, req) => {
    console.log('🟢 [WS] Thiết bị vừa kết nối luồng!');
    ws.isHardware = false; 
    audioBuffers.set(ws, []);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            // Nếu nhận gói nhị phân đầu tiên -> Đăng ký thiết bị phần cứng kích hoạt thành công
            if (!ws.isHardware) {
                ws.isHardware = true; 
                audioBuffers.set(ws, []); // Reset sạch bộ đệm âm thanh ban đầu
                console.log('✈️ [Hệ thống] ESP32 vượt ngưỡng âm lượng! Khởi động bộ đếm 5 giây nhận lệnh chính.');
                
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG NGHE LỆNH CHÍNH',
                    bufferLength: 0,
                    log: '🔊 ESP32 phát hiện âm thanh lớn! Bắt đầu thu âm câu lệnh điều khiển (Giới hạn 5 giây)...',
                    logType: 'success'
                });

                // Khởi động đồng hồ đếm ngược 5 giây cứng. Hết 5s lập tức khóa luồng và đẩy đi xử lý 1 lần duy nhất!
                let timer = setTimeout(() => {
                    processCommand(ws);
                }, 5000);
                recordingTimers.set(ws, timer);
            }

            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Gửi dữ liệu nhị phân về trang Monitor Web để tính độ trễ mạng thời gian thực
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message);
                }
            });

            if (bufferList.length % 5 === 0) {
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔴 ĐANG NGHE LỆNH CHÍNH',
                    bufferLength: bufferList.length
                });
            }
        }
    });

    ws.on('close', () => {
        console.log(`🔴 [WS] Luồng kết nối đã đóng (${ws.isHardware ? "ESP32 đã về chế độ ngủ" : "Trình duyệt Monitor"}).`);
        audioBuffers.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);

        if (ws.isHardware) {
            broadcastToMonitor({
                type: 'MONITOR_UPDATE',
                state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...',
                bufferLength: 0,
                log: '🔒 ESP32 đóng kết nối an toàn, quay về chế độ quét âm lượng cục bộ.',
                logType: 'info'
            });
        }
    });
});

// ==================== HÀM BIÊN DỊCH CÂU LỆNH CHÍNH DUY NHẤT MỘT LẦN ====================
async function processCommand(ws) {
    broadcastToMonitor({ 
        type: 'MONITOR_UPDATE', 
        state: '⚙️ GEMINI ĐANG BIÊN DỊCH CÂU LỆNH', 
        bufferLength: 0, 
        log: '⏱️ Hết 5 giây thu âm! Khóa bộ đệm và tải âm thanh câu lệnh lên Cloud...', 
        logType: 'warn' 
    });

    let pcmBuffers = audioBuffers.get(ws) || [];
    audioBuffers.set(ws, []); // Xóa sạch ngay bộ đệm để tránh xử lý trùng lặp

    if (pcmBuffers.length === 0) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂM THANH...', bufferLength: 0, log: 'Hủy xử lý do không thu được dữ liệu âm thanh.', logType: 'warn' });
        return;
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        // Bắn API lên Gemini để phân tích giọng nói điều khiển thiết bị
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý điều khiển thiết bị thông minh bằng tiếng Việt. Hãy lắng nghe đoạn âm thanh trên.
                    - Nếu họ muốn BẬT đèn hoặc thiết bị (ví dụ: "bật đèn", "mở đèn", "bật led"), trả về led = 1 và một câu text thông báo phản hồi ngắn gọn tương ứng.
                    - Nếu họ muốn TẮT đèn hoặc thiết bị (ví dụ: "tắt đèn", "tắt led"), trả về led = 0 và một câu text thông báo phản hồi ngắn gọn tương ứng.
                    - Nếu không nghe thấy câu lệnh điều khiển nào rõ ràng, trả về led = -1 và câu text giải thích.`
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
        if (!cleanText || cleanText.startsWith("<!DOCTYPE")) throw new Error("Mất kết nối hoặc lỗi dịch từ mô hình Google.");

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
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 CHỜ KÍCH HOẠT ÂMTHANH...', bufferLength: 0, log: `Lỗi biên dịch câu lệnh chính từ API: ${error.message}`, logType: 'error' });
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


