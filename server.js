const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái hệ thống [cite: 8]
let isProcessing = false; // Khóa chống trùng lặp toàn cục [cite: 9]
const audioBuffers = new Map(); [cite: 10]
const recordingTimers = new Map(); [cite: 11]

app.get('/dashboard', (req, res) => { [cite: 12]
    res.send(`<!DOCTYPE html>
<html lang="vi"> [cite: 15]
<head> [cite: 16]
    <meta charset="UTF-8"> [cite: 17]
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> [cite: 18, 19]
    <title>ESP32 Audio & Gemini AI Radar</title> [cite: 20]
    <script src="https://cdn.tailwindcss.com"></script> [cite: 21]
    <style>
        body { background-color: #0b0f19; } [cite: 22]
        .log-container::-webkit-scrollbar { width: 4px; } [cite: 23]
        .log-container::-webkit-scrollbar-thumb { background-color: #1e293b; border-radius: 2px; } [cite: 24, 25]
    </style>
</head>
<body class="text-slate-200 font-sans p-4 md:p-6"> [cite: 28]
    <div class="max-w-6xl mx-auto space-y-6"> [cite: 29]
        <header class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4"> [cite: 30, 31]
            <div>
                <h1 class="text-2xl font-bold text-cyan-400 flex items-center gap-2"> Hệ Thống Radar Âm Thanh & AI</h1> [cite: 33, 34]
                <p class="text-xs text-slate-400 mt-1">Kết nối liên tục | Kích hoạt Realtime | Phân tích phổ tần số</p> [cite: 35, 36, 37, 39]
            </div>
            <div id="connection-status" class="mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit"> [cite: 40]
                Mất kết nối Monitor [cite: 41]
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4"> [cite: 45]
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 46, 53]
                <h2 class="text-xs text-slate-400 uppercase font-semibold">Trạng thái hệ thống</h2> [cite: 47, 48]
                <div id="system-state" class="text-lg font-bold text-emerald-400 mt-1">HỆ THỐNG SẴN SÀNG</div> [cite: 49, 50]
            </div>
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 52, 53]
                <h2 class="text-xs text-slate-400 uppercase font-semibold">Gói lệnh thu âm</h2> [cite: 54, 55]
                <div id="buffer-count" class="text-2xl font-extrabold text-cyan-400 mt-1">0</div> [cite: 56, 57]
            </div>
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 59, 65]
                <h2 class="text-xs text-slate-400 uppercase font-semibold">Độ trễ Ping-Pong</h2> [cite: 60, 62]
                <div id="latency" class="text-lg font-bold text-emerald-400 mt-1">0 ms</div> [cite: 61, 63]
            </div>
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 64, 65]
                <h2 class="text-xs text-slate-400 uppercase font-semibold">Âm thanh phản hồi</h2> [cite: 66, 67]
                <div class="flex items-center gap-2 mt-2"> [cite: 68]
                    <input type="checkbox" id="mute-voice" class="rounded bg-slate-950 border-slate-800 text-cyan-500"> [cite: 68]
                    <label for="mute-voice" class="text-xs text-slate-300 cursor-pointer">Nghe giọng nói (Live)</label> [cite: 69, 70]
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4"> [cite: 74]
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 75, 76]
                <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Sơ đồ sóng âm (Waveform)</h2> [cite: 76, 77]
                <canvas id="waveform" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas> [cite: 78]
            </div>
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl"> [cite: 80, 81]
                <h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">Phổ tần số nhiễu bệnh (FFT Spectrum)</h2> [cite: 82, 83]
                <canvas id="spectrum" class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50"></canvas> [cite: 84]
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4"> [cite: 87]
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-1"> [cite: 87, 88]
                <h2 class="text-sm font-bold text-slate-100 mb-2">Phản hồi từ Gemini AI</h2> [cite: 89, 90]
                <div id="ai-response" class="bg-slate-950 border border-slate-800 p-3 rounded-lg text-slate-300 font-mono text-xs min-h-[120px] whitespace-pre-wrap"> [cite: 91]
                    Chờ lệnh từ thiết bị... [cite: 92]
                </div>
            </div>
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-2 flex flex-col h-[180px]"> [cite: 95, 96]
                <div class="flex items-center justify-between mb-2"> [cite: 97]
                    <h2 class="text-sm font-bold text-slate-100">Nhật Ký Hệ Thống</h2> [cite: 97, 98]
                    <button onclick="document.getElementById('log-box').innerHTML=''" class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Xóa</button> [cite: 100, 101]
                </div>
                <div id="log-box" class="log-container bg-slate-950 border border-slate-800 p-3 rounded-lg font-mono text-[11px] text-slate-400 overflow-y-auto flex-1 space-y-1"> [cite: 103, 104, 105]
                    [Hệ thống] Trình giám sát đã khởi tạo thành công. [cite: 106]
                </div>
            </div>
        </div>
    </div>

    <script>
        const logBox = document.getElementById('log-box'); [cite: 112]
        const stateDiv = document.getElementById('system-state'); [cite: 113]
        const bufferDiv = document.getElementById('buffer-count'); [cite: 114]
        const latencyDiv = document.getElementById('latency'); [cite: 115]
        const aiDiv = document.getElementById('ai-response'); [cite: 115]
        const connStatus = document.getElementById('connection-status'); [cite: 115, 116]
        const muteVoice = document.getElementById('mute-voice'); [cite: 117]
        
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); [cite: 118, 119]
        let analyser = audioCtx.createAnalyser(); [cite: 120]
        analyser.fftSize = 256; [cite: 121]
        let bufferLength = analyser.frequencyBinCount; [cite: 122]
        let dataArray = new Uint8Array(bufferLength); [cite: 123]
        
        const canvasWave = document.getElementById('waveform'); [cite: 124]
        const ctxWave = canvasWave.getContext('2d'); [cite: 125]
        const canvasSpec = document.getElementById('spectrum'); [cite: 126]
        const ctxSpec = canvasSpec.getContext('2d'); [cite: 127]

        function resizeCanvases () { [cite: 128]
            canvasWave.width = canvasWave.clientWidth; [cite: 129]
            canvasWave.height = canvasWave.clientHeight; [cite: 130]
            canvasSpec.width = canvasSpec.clientWidth; [cite: 131]
            canvasSpec.height = canvasSpec.clientHeight; [cite: 132]
        }
        window.addEventListener('resize', resizeCanvases); [cite: 134]
        resizeCanvases(); [cite: 135]

        function addLog (message, type = 'info') { [cite: 136]
            const now = new Date(); [cite: 137]
            const timeStr = now.toTimeString().split(' ')[0]; [cite: 138]
            let color = 'text-slate-400'; [cite: 138]
            if (type === 'success') color = 'text-emerald-400 font-semibold'; [cite: 139, 140]
            if (type === 'warn') color = 'text-amber-400'; [cite: 141]
            if (type === 'error') color = 'text-red-400 font-bold'; [cite: 142]
            logBox.innerHTML += '<div class="' + color + '">[' + timeStr + '] ' + message + '</div>'; [cite: 143, 144, 146]
            logBox.scrollTop = logBox.scrollHeight; [cite: 147]
        }

        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'; [cite: 149, 150]
        const ws = new WebSocket(protocol + window.location.host); [cite: 151]
        ws.binaryType = 'arraybuffer'; [cite: 151]
        let lastPacketTime = Date.now(); [cite: 152]

        ws.onopen = () => { [cite: 153]
            connStatus.className = "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit"; [cite: 153, 154]
            connStatus.innerText = 'Hệ thống trực tuyến'; [cite: 155]
        };

        ws.onclose = () => { [cite: 157]
            connStatus.className = "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit"; [cite: 158]
            connStatus.innerText = 'Mất kết nối Monitor'; [cite: 159, 160]
        };

        ws.onmessage = (event) => { [cite: 162]
            if (typeof event.data === 'string') { [cite: 163]
                try {
                    const data = JSON.parse(event.data); [cite: 165]
                    if (data.type === 'MONITOR_UPDATE') { [cite: 165]
                        if(data.state) stateDiv.innerText = data.state; [cite: 165]
                        if(data.bufferLength !== undefined) bufferDiv.innerText = data.bufferLength; [cite: 165]
                        if (data.log) addLog(data.log, data.logType || 'info'); [cite: 166, 168]
                        if (data.aiResponse) aiDiv.innerText = data.aiResponse; [cite: 167, 169]
                    }
                } catch(e) {}
                return; [cite: 172]
            }
            if (event.data.byteLength > 0) { [cite: 174]
                let now = Date.now(); [cite: 175]
                latencyDiv.innerText = (now - lastPacketTime) + " ms"; [cite: 176]
                lastPacketTime = now; [cite: 177]
                let int16Array = new Int16Array(event.data); [cite: 178]
                let float32Array = new Float32Array(int16Array.length); [cite: 178, 179]
                for (let i = 0; i < int16Array.length; i++) { [cite: 180]
                    float32Array[i] = int16Array[i] / 32768.0; [cite: 181]
                }
                
                let audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000); [cite: 184, 185]
                audioBuffer.getChannelData(0).set(float32Array); [cite: 186]
                let source = audioCtx.createBufferSource(); [cite: 187]
                source.buffer = audioBuffer; [cite: 188]
                source.connect(analyser); [cite: 189]
                
                if (!muteVoice.checked) { [cite: 183]
                    analyser.connect(audioCtx.destination); [cite: 190]
                }
                source.start(); [cite: 191]
            }
        };

        function drawCharts() { [cite: 203]
            requestAnimationFrame(drawCharts); [cite: 204]
            analyser.getByteTimeDomainData(dataArray); [cite: 205]
            ctxWave.fillStyle = '#0b0f19'; [cite: 206]
            ctxWave.fillRect(0, 0, canvasWave.width, canvasWave.height); [cite: 207, 208]
            ctxWave.lineWidth = 2; [cite: 209]
            ctxWave.strokeStyle = '#22d3ee'; [cite: 210]
            ctxWave.beginPath(); [cite: 211]
            let sliceWidth = canvasWave.width * 1.0 / bufferLength; [cite: 212]
            let x = 0; [cite: 213]
            for (let i = 0; i < bufferLength; i++) { [cite: 214]
                let v = dataArray[i] / 128.0; [cite: 215]
                let y = v * canvasWave.height / 2; [cite: 216]
                if (i === 0) ctxWave.moveTo(x, y); else ctxWave.lineTo(x, y); [cite: 217, 218]
                x += sliceWidth; [cite: 219]
            }
            ctxWave.lineTo(canvasWave.width, canvasWave.height / 2); [cite: 221]
            ctxWave.stroke(); [cite: 222]

            analyser.getByteFrequencyData(dataArray); [cite: 223]
            ctxSpec.fillStyle = '#0b0f19'; [cite: 224]
            ctxSpec.fillRect(0, 0, canvasSpec.width, canvasSpec.height); [cite: 225, 226]
            let barWidth = (canvasSpec.width / bufferLength) * 1.5; [cite: 227]
            let xSpec = 0; [cite: 229]
            for (let i = 0; i < bufferLength; i++) { [cite: 230]
                let barHeight = dataArray[i] / 1.5; [cite: 230]
                ctxSpec.fillStyle = 'rgb(' + (barHeight + 100) + ',34,180)'; [cite: 230, 231]
                ctxSpec.fillRect(xSpec, canvasSpec.height - barHeight, barWidth - 1, barHeight); [cite: 232, 234]
                xSpec += barWidth; [cite: 235]
            }
        }
        drawCharts(); [cite: 239]
        window.addEventListener('click', () => { if (audioCtx.state === 'suspended') audioCtx.resume(); }); [cite: 240, 241]
    </script>
</body>
</html>`);
});

app.get('/', (req, res) => res.redirect('/dashboard')); [cite: 246]

const server = app.listen(PORT, () => console.log(`Server chạy tại: http://localhost:${PORT}`)); [cite: 247, 248]
const wss = new WebSocketServer({ server }); [cite: 249]

wss.on('connection', (ws) => { [cite: 250]
    ws.isHardware = false; [cite: 251]
    
    ws.on('message', async (message, isBinary) => { [cite: 252]
        if (isBinary) { [cite: 253]
            ws.isHardware = true; [cite: 254]
            if (isProcessing) return; [cite: 255, 257]

            if (!recordingTimers.has(ws)) { [cite: 259]
                audioBuffers.set(ws, []); [cite: 260]
                console.log(' [Kích hoạt] Thu âm câu lệnh (Tối đa 5s)...'); [cite: 261]
                
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: 'ĐANG THU LỆNH CHÍNH', [cite: 264]
                    bufferLength: 0, [cite: 265]
                    log: 'Phát hiện giọng nói! Đang nạp luồng âm thanh thời gian thực...', [cite: 266, 267]
                    logType: 'success' [cite: 268]
                });

                let timer = setTimeout(() => { [cite: 273]
                    processCommand(ws); [cite: 274]
                }, 5000); [cite: 275]
                recordingTimers.set(ws, timer); [cite: 276]
            }

            let bufferList = audioBuffers.get(ws) || []; [cite: 277]
            bufferList.push(Buffer.from(message)); [cite: 278]
            audioBuffers.set(ws, bufferList);

            // Đồng bộ đẩy luồng nhị phân xuống giao diện Monitor để vẽ đồ thị
            wss.clients.forEach((client) => { [cite: 280]
                if (client !== ws && client.readyState === 1 && !client.isHardware) { [cite: 281, 282]
                    client.send(message); [cite: 283]
                }
            });

            if (bufferList.length % 8 === 0) { [cite: 286]
                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: 'ĐANG THU LỆNH CHÍNH', [cite: 290]
                    bufferLength: bufferList.length [cite: 291]
                });
            }
        } else {
            try {
                const textMsg = message.toString().trim(); [cite: 295]
                if (textMsg === "RESET_STATE") {
                    isProcessing = false; [cite: 297]
                    broadcastToMonitor({
                        type: 'MONITOR_UPDATE',
                        state: 'HỆ THỐNG SẴN SÀNG', [cite: 300]
                        bufferLength: 0, [cite: 301]
                        log: 'ESP32 đã sẵn sàng quét âm thanh cho chu kỳ mới.', [cite: 302]
                        logType: 'info' [cite: 303]
                    });
                }
            } catch(e) {}
        }
    });

    ws.on('close', () => { [cite: 309]
        audioBuffers.delete(ws); [cite: 310]
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws)); [cite: 311, 312]
        recordingTimers.delete(ws); [cite: 313]
    });
});

async function processCommand(ws) {
    isProcessing = true; [cite: 317]
    broadcastToMonitor({
        type: 'MONITOR_UPDATE',
        state: 'ĐANG XỬ LÝ LỆNH...', [cite: 320]
        bufferLength: 0, [cite: 321]
        log: 'Khóa luồng thu âm! Đang đóng gói dữ liệu và biên dịch qua Gemini AI...', [cite: 322, 323]
        logType: 'warn' [cite: 324]
    });

    let pcmBuffers = audioBuffers.get(ws) || []; [cite: 326, 327]
    audioBuffers.delete(ws); [cite: 328]
    if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws)); [cite: 329]
    recordingTimers.delete(ws); [cite: 330]

    if (pcmBuffers.length === 0) { [cite: 331]
        isProcessing = false; [cite: 332]
        if (ws.readyState === 1) ws.send("CMD_DONE"); [cite: 332]
        return; [cite: 332]
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000); [cite: 333]
        const base64Audio = wavBuffer.toString('base64'); [cite: 333]

        // Sử dụng đúng model gemini-1.5-flash theo chuẩn SDK mới nhất 
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite', [cite: 334]
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } }, [cite: 334]
                { text: `Bạn là trợ lý nhà thông minh tiếng Việt. Phân tích đoạn âm thanh:\n- Nếu muốn BẬT đèn/led/thiết bị -> trả về led = 1 và text phản hồi.\n- Nếu muốn TẮT đèn/led/thiết bị -> trả về led = 0 và text phản hồi.\n- Các trường hợp khác hoặc không rõ ràng -> trả về led = -1.` } [cite: 334, 335]
            ],
            config: {
                responseMimeType: "application/json", [cite: 335]
                responseSchema: { [cite: 335]
                    type: Type.OBJECT, [cite: 335]
                    properties: { [cite: 335]
                        led: { type: Type.INTEGER }, [cite: 335]
                        text: { type: Type.STRING } [cite: 335]
                    },
                    required: ["led", "text"] [cite: 335]
                }
            }
        });

        let cleanText = response.text ? response.text.trim() : "{}"; [cite: 336]
        const resultJson = JSON.parse(cleanText); [cite: 336]

        if (ws.readyState === 1) { [cite: 337]
            if (resultJson.led === 1) { [cite: 337]
                ws.send("LED2_ON"); [cite: 337]
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '🟢 AI quyết định: BẬT LED D2.', logType: 'success', aiResponse: resultJson.text }); [cite: 338]
            } else if (resultJson.led === 0) { [cite: 339]
                ws.send("LED2_OFF"); [cite: 339]
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '🔴 AI quyết định: TẮT LED D2.', logType: 'success', aiResponse: resultJson.text }); [cite: 339]
            } else { [cite: 340]
                ws.send("CMD_DONE"); [cite: 340]
                broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '⚙️ ĐANG XỬ LÝ LỆNH...', bufferLength: 0, log: '⚠️ AI không nhận diện rõ câu lệnh.', logType: 'warn', aiResponse: resultJson.text }); [cite: 340]
            }
        }
    } catch (error) {
        if (ws.readyState === 1) ws.send("CMD_DONE"); [cite: 341]
        broadcastToMonitor({ type: 'MONITOR_UPDATE', state: '🟢 LỖI HỆ THỐNG', bufferLength: 0, log: `Lỗi API Gemini: ${error.message}`, logType: 'error' }); [cite: 342]
    } finally {
        isProcessing = false; [cite: 343]
    }
}

function createWavBuffer(pcmBuffers, sampleRate = 16000) { [cite: 343]
    let pcmBuffer = Buffer.concat(pcmBuffers); [cite: 343]
    let wavBuffer = Buffer.alloc(44 + pcmBuffer.length); [cite: 344]
    wavBuffer.write('RIFF', 0); [cite: 344]
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4); [cite: 344]
    wavBuffer.write('WAVE', 8); [cite: 344]
    wavBuffer.write('fmt ', 12); [cite: 344]
    wavBuffer.writeUInt32LE(16, 16); [cite: 345]
    wavBuffer.writeUInt16LE(1, 20); [cite: 345]
    wavBuffer.writeUInt16LE(1, 22); [cite: 345]
    wavBuffer.writeUInt32LE(sampleRate, 24); [cite: 345]
    wavBuffer.writeUInt32LE(sampleRate * 2, 28); [cite: 345]
    wavBuffer.writeUInt16LE(2, 32); [cite: 345]
    wavBuffer.writeUInt16LE(16, 34); [cite: 345]
    wavBuffer.write('data', 36); [cite: 345]
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40); [cite: 345]
    pcmBuffer.copy(wavBuffer, 44); [cite: 346]
    return wavBuffer; [cite: 346]
}

function broadcastToMonitor(obj) { [cite: 346]
    wss.clients.forEach((client) => { [cite: 346]
        if (client.readyState === 1 && !client.isHardware) { [cite: 346]
            client.send(JSON.stringify(obj)); [cite: 346]
        }
    });
}


