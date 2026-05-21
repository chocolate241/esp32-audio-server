const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Khởi tạo SDK Gemini mới nhất
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái và bộ đệm của từng kết nối
const deviceStates = new Map();     
const audioBuffers = new Map();     
const recordingTimers = new Map();  
const isScanningMap = new Map();    
const lastScanTimeMap = new Map();  

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
            
            <!-- HEADER -->
            <header class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4">
                <div>
                    <h1 class="text-2xl font-bold text-cyan-400">🎙️ Hệ Thống Giám Sát Từ Khóa & Câu Lệnh</h1>
                    <p class="text-sm text-slate-400">Bảng điều khiển phân tích âm thanh thời gian thực phối hợp Gemini AI</p>
                </div>
                <div class="mt-2 md:mt-0">
                    <span id="connection-status" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        <span class="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span> Mất kết nối Monitor
                    </span>
                </div>
            </header>

            <!-- TRẠNG THÁI CHÍNH -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Trạng thái ESP32</h2>
                    <div id="system-state" class="text-xl font-bold text-amber-400">CHỜ KẾT NỐI...</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Số Gói Buffer Tích Lũy</h2>
                    <div id="buffer-count" class="text-3xl font-extrabold text-cyan-400">0</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
                    <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tốc độ quét mạng</h2>
                    <div id="latency" class="text-xl font-bold text-emerald-400">0 ms</div>
                </div>
            </div>

            <!-- KẾT QUẢ TRỢ LÝ AI -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-xl">🤖</span>
                    <h2 class="text-lg font-bold text-slate-100">Trợ Lý Gemini AI Phản Hồi Gần Nhất</h2>
                </div>
                <div id="ai-response" class="bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-300 font-mono text-sm min-h-[60px] whitespace-pre-wrap">
                    Đang ở chế độ chờ... Hãy gọi "Hey Gemini" trước mạch micro của ESP32.
                </div>
            </div>

            <!-- LOG CỦA SERVER -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col h-[350px]">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-xl">📋</span>
                        <h2 class="text-lg font-bold text-slate-100">Nhật Ký Hệ Thống Thực Tế (System Log)</h2>
                    </div>
                    <button onclick="document.getElementById('log-box').innerHTML=''" class="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition">Xóa Log</button>
                </div>
                <div id="log-box" class="log-container bg-slate-950 border border-slate-800 p-4 rounded-lg font-mono text-xs text-slate-400 overflow-y-auto flex-1 space-y-1">
                    [Hệ thống] Bắt đầu khởi tạo luồng dữ liệu...
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
                connStatus.innerHTML = '<span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span> Hệ thống đang giám sát trực tuyến';
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
                            
                            if (data.state.includes('NGHE LỆNH')) {
                                stateDiv.className = "text-xl font-bold text-red-500 animate-pulse";
                            } else if (data.state.includes('QUÝET WAKE WORD')) {
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

// ==================== QUẢN LÝ KẾT NỐI WEBSOCKET (ĐÃ FIX LỖI SPAM) ====================
wss.on('connection', (ws, req) => {
    console.log('🟢 [WS] Có thiết bị vừa kết nối!');
    
    // Khởi tạo flag phân loại client
    ws.isHardware = false; 

    deviceStates.set(ws, 'WAIT_WAKE');
    audioBuffers.set(ws, []);
    isScanningMap.set(ws, false);
    lastScanTimeMap.set(ws, 0);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            // NẾU NHẬN ĐƯỢC DỮ LIỆU NHỊ PHÂN -> ĐÂY CHẮC CHẮN LÀ MẠCH ESP32!
            if (!ws.isHardware) {
                ws.isHardware = true; 
                console.log('✈️ [Hệ thống] Xác nhận Client này là mạch ESP32.');
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🔍 ĐANG QUÝET WAKE WORD',
                    bufferLength: 0,
                    log: 'Thiết bị ESP32 phần cứng đã liên kết thành công!',
                    logType: 'success'
                });
            }

            let state = deviceStates.get(ws) || 'WAIT_WAKE';
            let bufferList = audioBuffers.get(ws) || [];
            
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Forward luồng nhị phân ĐÃ LỌC: Chỉ gửi về cho Trình duyệt Web để tính latency
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1 && !client.isHardware) {
                    client.send(message);
                }
            });

            // Cập nhật số gói buffer định kỳ lên giao diện Monitor Web
            if (bufferList.length % 5 === 0) {
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: state === 'WAIT_WAKE' ? '🔍 ĐANG QUÝET WAKE WORD' : '🔴 ĐANG NGHE LỆNH CHÍNH',
                    bufferLength: bufferList.length
                });
            }

            // LOGIC CHẾ ĐỘ CHỜ WAKE WORD
            if (state === 'WAIT_WAKE') {
                let isScanning = isScanningMap.get(ws);
                let lastScanTime = lastScanTimeMap.get(ws) || 0;
                let now = Date.now();
                
                if (bufferList.length >= 25) {
                    if (!isScanning && (now - lastScanTime > 2500)) {
                        let pcmToScan = [...bufferList];
                        audioBuffers.set(ws, bufferList.slice(15)); 
                        
                        lastScanTimeMap.set(ws, now);
                        checkWakeWord(ws, pcmToScan);
                    } else {
                        if(bufferList.length > 35) {
                            audioBuffers.set(ws, bufferList.slice(15));
                        }
                    }
                }
            }
        }
    });

    ws.on('close', () => {
        console.log(`🔴 [WS] Một kết nối đã ngắt (${ws.isHardware ? "ESP32" : "Web Monitor"}).`);
        audioBuffers.delete(ws);
        deviceStates.delete(ws);
        isScanningMap.delete(ws);
        lastScanTimeMap.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);

        if (ws.isHardware) {
            broadcastToMonitor({
                type: 'MONITOR_UPDATE',
                state: '🔴 MẤT KẾT NỐI PHẦN CỨNG',
                bufferLength: 0,
                log: 'Cảnh báo: Mạch ESP32 đã ngắt kết nối với Cloud.',
                logType: 'error'
            });
        }
    });
});

// ==================== HÀM QUÉT TỪ KHÓA CHỦ ĐỘNG ====================
async function checkWakeWord(ws, pcmBuffers) {
    isScanningMap.set(ws, true); 
    broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG GỌI GEMINI KIỂM TRA WAKE WORD', bufferLength: pcmBuffers.length, log: 'Gửi API phân tích cụm từ nền...', logType: 'info' });

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                { text: `Lắng nghe âm thanh ngắn này. Người dùng có gọi cụm từ "hey gemini" hoặc "hey gemi" không? Hãy bỏ qua các tiếng ồn xung quanh. Trả về cấu trúc JSON nghiêm ngặt: {"detected": true} hoặc {"detected": false}.` }
            ],
            config: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { detected: { type: Type.BOOLEAN } },
                    required: ["detected"]
                }
            }
        });

        const rawText = response.text ? response.text.trim() : null;
        if (!rawText || rawText.startsWith("<!DOCTYPE")) {
            throw new Error("Google chặn chặn luồng hoặc trả về mã lỗi HTTP 429.");
        }

        const result = JSON.parse(rawText);
        
        broadcastToMonitor({
            type: 'MONITOR_UPDATE',
            state: '🔍 ĐANG QUÝET WAKE WORD',
            bufferLength: 0,
            log: `Phân tích Wake Word kết thúc. Kết quả: ${result.detected}`,
            logType: result.detected ? 'success' : 'info'
        });

        if (result.detected === true) {
            deviceStates.set(ws, 'RECORDING');
            audioBuffers.set(ws, []); 

            if (ws.readyState === 1) ws.send("WAKE_UP");

            broadcastToMonitor({
                type: 'MONITOR_UPDATE',
                state: '🔴 ĐANG NGHE LỆNH CHÍNH',
                bufferLength: 0,
                log: '🔓 KÍCH HOẠT THÀNH CÔNG! Đèn D32 sáng, Server mở luồng thu câu lệnh điều khiển trong 5 giây...',
                logType: 'success',
                aiResponse: 'Phát hiện chính xác: "Hey Gemini"! Tôi đang nghe câu lệnh của bạn...'
            });

            let timer = setTimeout(() => {
                processCommand(ws);
            }, 5000);
            recordingTimers.set(ws, timer);
        }
    } catch (e) {
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: `Lỗi quét WakeWord: ${e.message}`, logType: 'error' });
    } finally {
        if (deviceStates.get(ws) === 'WAIT_WAKE') {
            isScanningMap.set(ws, false);
        }
    }
}

// ==================== HÀM BIÊN DỊCH CÂU LỆNH CHÍNH ====================
async function processCommand(ws) {
    broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ GEMINI ĐANG BIÊN DỊCH CÂU LỆNH', bufferLength: 0, log: 'Hết 5s. Khóa bộ đệm và tải âm thanh câu lệnh lên Cloud...', logType: 'warn' });

    let pcmBuffers = audioBuffers.get(ws) || [];
    
    deviceStates.set(ws, 'WAIT_WAKE');
    audioBuffers.set(ws, []);
    isScanningMap.set(ws, false);
    lastScanTimeMap.set(ws, Date.now()); 

    if (pcmBuffers.length === 0) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: 'Hủy xử lý do không thu được âm thanh câu lệnh.', logType: 'warn' });
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
        if (!cleanText || cleanText.startsWith("<!DOCTYPE")) throw new Error("Mất kết nối hoặc nhận chuỗi lỗi từ mô hình.");

        const resultJson = JSON.parse(cleanText);

        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: '🚀 THỰC THI: Gửi tín hiệu LED2_ON về mạch phần cứng.', logType: 'success', aiResponse: resultJson.text });
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: '🚀 THỰC THI: Gửi tín hiệu LED2_OFF về mạch phần cứng.', logType: 'success', aiResponse: resultJson.text });
            } else {
                ws.send("GO_SLEEP");
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: '⚠️ THỰC THI: Không khớp câu lệnh điều khiển, ra lệnh ESP32 ngủ tiếp.', logType: 'warn', aiResponse: resultJson.text });
            }
        }

    } catch (error) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🔍 ĐANG QUÝET WAKE WORD', bufferLength: 0, log: `Lỗi biên dịch câu lệnh chính: ${error.message}`, logType: 'error' });
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

// Gửi đồng bộ thông tin trạng thái: CHỈ GỬI TRÌNH DUYỆT WEB, BỎ QUA ESP32
function broadcastToMonitor(obj) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1 && !client.isHardware) {
            client.send(JSON.stringify(obj));
        }
    });
}
