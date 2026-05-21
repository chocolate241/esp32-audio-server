const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái kết nối của từng thiết bị: 'WAIT_WAKE' hoặc 'RECORDING'
const deviceStates = new Map();
const audioBuffers = new Map();
const recordingTimers = new Map();

app.get('/nghe', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Cloud Audio Analytics PRO</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; background: #0b0c10; color: #c5c6c7; margin: 0; padding: 20px; }
            h2 { color: #66fcf1; margin-bottom: 5px; font-weight: 600; }
            p { color: #45f3ff; font-size: 14px; margin-top: 0; margin-bottom: 25px; }
            button { padding: 15px 35px; font-size: 16px; cursor: pointer; background: #66fcf1; color: #0b0c10; border: none; border-radius: 25px; font-weight: bold; box-shadow: 0 4px 15px rgba(102,252,241,0.3); transition: 0.3s; }
            button:hover { background: #45f3ff; transform: translateY(-2px); }
            .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; max-width: 600px; margin: 20px auto; padding: 10px; }
            .card { background: #1f2833; padding: 15px; border-radius: 10px; border: 1px solid #45f3ff33; }
            .card-title { font-size: 12px; color: #85929e; text-transform: uppercase; margin-bottom: 5px; }
            .card-value { font-size: 20px; font-weight: bold; color: #66fcf1; }
            #status { margin: 15px 0; font-size: 16px; font-weight: bold; color: #ff9f43; }
            canvas { background: #1f2833; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); display: none; margin: 0 auto; border: 1px solid #1f2833; }
            .gemini-box { max-width: 600px; margin: 20px auto; background: #1f2833; border: 1px solid #ff9f4333; border-radius: 10px; padding: 15px; text-align: left; }
            .gemini-title { font-size: 14px; color: #ff9f43; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; }
            .gemini-text { color: #ffffff; font-size: 16px; line-height: 1.5; min-height: 24px; }
        </style>
    </head>
    <body>
        <h2>🎙️ HỆ THỐNG GIÁM SÁT ÂM THANH CLOUD</h2>
        <p>Real-time Audio Digital Signal Processing (DSP) Analytics</p>
        <button id="startBtn">KẾT NỐI & PHÂN TÍCH</button>
        <div id="status">Hệ thống đang chờ lệnh...</div>

        <div class="dashboard">
            <div class="card"><div class="card-title">Biên độ Đỉnh</div><div id="valPeak" class="card-value">0%</div></div>
            <div class="card"><div class="card-title">Tần số mẫu</div><div id="valSample" class="card-value">0 Hz</div></div>
            <div class="card"><div class="card-title">Số Gói Nhận</div><div id="valPackets" class="card-value">0</div></div>
            <div class="card"><div class="card-title">Độ Trễ 🛡️</div><div id="valLatency" class="card-value">0ms</div></div>
        </div>

        <div class="gemini-box">
            <div class="gemini-title">🤖 Trợ lý Gemini AI Phản hồi:</div>
            <div id="geminiResponse" class="gemini-text">Đang ở chế độ chờ... Hãy gọi "Hey Gemini"</div>
        </div>

        <canvas id="visualizer" width="600" height="160"></canvas>

        <script>
            let audioCtx, ws, analyser, nextStartTime = 0;
            let packetCount = 0, lastPacketTime = Date.now(), sampleRateCounter = 0, lastSecTime = Date.now();

            const startBtn = document.getElementById('startBtn'), statusDiv = document.getElementById('status');
            const canvas = document.getElementById('visualizer'), canvasCtx = canvas.getContext('2d');
            const geminiResponse = document.getElementById('geminiResponse');
            const valPeak = document.getElementById('valPeak'), valSample = document.getElementById('valSample'), valPackets = document.getElementById('valPackets'), valLatency = document.getElementById('valLatency');

            startBtn.onclick = () => {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                analyser = audioCtx.createAnalyser(); analyser.fftSize = 512;
                startBtn.style.display = 'none'; canvas.style.display = 'block';
                statusDiv.innerText = "Đang bắt tín hiệu từ Cloud...";

                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                ws = new WebSocket(protocol + window.location.host);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => {
                    statusDiv.innerText = "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢";
                    statusDiv.style.color = "#66fcf1";
                    nextStartTime = audioCtx.currentTime; draw();
                };

                ws.onmessage = (event) => {
                    if (typeof event.data === 'string') {
                        try {
                            const resJson = JSON.parse(event.data);
                            if(resJson.text) geminiResponse.innerText = resJson.text;
                            if(resJson.status) statusDiv.innerText = resJson.status;
                        } catch(e) {}
                        return;
                    }
                    if (event.data.byteLength === 0) return;

                    packetCount++; let now = Date.now();
                    let delta = now - lastPacketTime; lastPacketTime = now;
                    
                    let int16Array = new Int16Array(event.data);
                    let samplesCount = int16Array.length; sampleRateCounter += samplesCount;

                    let maxVal = 0;
                    for (let i = 0; i < samplesCount; i++) {
                        let absVal = Math.abs(int16Array[i]);
                        if (absVal > maxVal) maxVal = absVal;
                    }
                    let peakPercentage = ((maxVal / 32768) * 100).toFixed(1);

                    valPackets.innerText = packetCount; valPeak.innerText = peakPercentage + "%"; valLatency.innerText = delta + "ms";

                    if (now - lastSecTime >= 1000) {
                        valSample.innerText = sampleRateCounter + " Hz";
                        sampleRateCounter = 0; lastSecTime = now;
                    }

                    let audioBuffer = audioCtx.createBuffer(1, samplesCount, 16000);
                    let channelData = audioBuffer.getChannelData(0);
                    for (let i = 0; i < samplesCount; i++) {
                        channelData[i] = int16Array[i] / 32768.0;
                    }
                    
                    let source = audioCtx.createBufferSource(); source.buffer = audioBuffer;
                    source.connect(analyser); analyser.connect(audioCtx.destination);
                    if (nextStartTime < audioCtx.currentTime) nextStartTime = audioCtx.currentTime + 0.03;
                    source.start(nextStartTime); nextStartTime += audioBuffer.duration;
                };
            };

            function draw() {
                requestAnimationFrame(draw);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);
                canvasCtx.fillStyle = '#1f2833'; canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                canvasCtx.strokeStyle = '#45f3ff11'; canvasCtx.lineWidth = 1;
                for(let i = 0; i < canvas.width; i += 40) { canvasCtx.beginPath(); canvasCtx.moveTo(i, 0); canvasCtx.lineTo(i, canvas.height); canvasCtx.stroke(); }
                for(let i = 0; i < canvas.height; i += 30) { canvasCtx.beginPath(); canvasCtx.moveTo(0, i); canvasCtx.lineTo(canvas.width, i); canvasCtx.stroke(); }
                canvasCtx.lineWidth = 2.5; canvasCtx.strokeStyle = '#66fcf1'; canvasCtx.shadowBlur = 4; canvasCtx.shadowColor = '#66fcf1'; canvasCtx.beginPath();
                let sliceWidth = canvas.width / bufferLength; let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    let v = dataArray[i] / 128.0; let y = v * canvas.height / 2;
                    if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
                    x += sliceWidth;
                }
                canvasCtx.lineTo(canvas.width, canvas.height / 2); canvasCtx.stroke(); canvasCtx.shadowBlur = 0;
            }
        </script>
    </body>
    </html>
    `);
});

const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('🔴 Có thiết bị kết nối vào hệ thống WebSocket');
    
    // Mặc định ban đầu cấu hình thiết bị ở chế độ chờ Wake Word
    deviceStates.set(ws, 'WAIT_WAKE');
    audioBuffers.set(ws, []);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            let state = deviceStates.get(ws) || 'WAIT_WAKE';
            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Forward luồng dữ liệu thô sang trình duyệt hiển thị biểu đồ trực quan
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) {
                    client.send(message);
                }
            });

            if (state === 'WAIT_WAKE') {
                // Ở chế độ chờ: Khi tích đủ tầm ~1.5 giây âm thanh nền, tiến hành quét từ khóa ẩn
                if (bufferList.length >= 15) { 
                    let pcmToScan = [...bufferList];
                    // Giữ lại một nửa bộ đệm gối đầu để chống mất từ khóa giữa các gói băm
                    audioBuffers.set(ws, bufferList.slice(7)); 
                    checkWakeWord(ws, pcmToScan);
                }
            }
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        deviceStates.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);
    });
});

// HÀM 1: QUÉT TỪ KHÓA MỚI "HEY GEMINI / HEY GEMI"
async function checkWakeWord(ws, pcmBuffers) {
    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                { text: `Lắng nghe âm thanh ngắn này. Người dùng có gọi cụm từ "hey gemini" hoặc "hey gemi" không? Trả về JSON nghiêm ngặt: {"detected": true} hoặc {"detected": false}.` }
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

        const result = JSON.parse(response.text.trim());
        if (result.detected === true) {
            console.log("🔓 KÍCH HOẠT: Phát hiện tiếng 'Hey Gemini'! Chuyển sang ghi âm câu lệnh...");
            
            deviceStates.set(ws, 'RECORDING');
            audioBuffers.set(ws, []); // Reset sạch bộ đệm để hứng câu lệnh chính xác

            // Gửi tín hiệu điều khiển phần cứng bắt đầu mở cửa sổ lệnh sáng đèn LED D32
            if (ws.readyState === 1) ws.send("WAKE_UP");

            // Đồng bộ trạng thái giao diện web
            sendTextToWeb({ status: "🔴 ĐANG NGHE CÂU LỆNH CHÍNH (5S)...", text: "Đang lắng nghe lệnh điều khiển của bạn..." });

            // Đặt thời gian đóng cửa sổ thu âm sau đúng 5 giây
            let timer = setTimeout(() => {
                processCommand(ws);
            }, 5000);
            recordingTimers.set(ws, timer);
        }
    } catch (e) {
        // Bỏ qua lỗi bắt nhiễu trùng lặp nền
    }
}

// HÀM 2: BIÊN DỊCH VÀ XỬ LÝ CÂU LỆNH CHÍNH CHUYỂN MẠCH THIẾT BỊ
async function processCommand(ws) {
    let pcmBuffers = audioBuffers.get(ws) || [];
    deviceStates.set(ws, 'WAIT_WAKE'); // Đưa thiết bị quay về chế độ chờ quét từ khóa ngay lập tức
    audioBuffers.set(ws, []);

    if (pcmBuffers.length === 0) {
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        return;
    }

    console.log("⚡ Hết 5 giây lệnh. Đang gửi dữ liệu phân tích điều khiển...");
    sendTextToWeb({ status: "🤖 GEMINI ĐANG XỬ LÝ LỆNH...", text: "Đang phân tích cú pháp câu lệnh..." });

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý điều khiển thiết bị thông minh bằng tiếng Việt. Hãy lắng nghe đoạn âm thanh trên.
                    - Nếu họ muốn BẬT đèn hoặc thiết bị (ví dụ: "bật đèn", "mở đèn", "bật led", "bật led d2"), trả về led = 1 và một câu text phản hồi thân thiện tương ứng.
                    - Nếu họ muốn TẮT đèn hoặc thiết bị (ví dụ: "tắt đèn", "tắt led"), trả về led = 0 và một câu text phản hồi thân thiện tương ứng.
                    - Nếu không nghe rõ hoặc không có lệnh điều khiển liên quan, trả về led = -1 và câu text giải thích.`
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
        if (!cleanText) return;

        const resultJson = JSON.parse(cleanText);
        console.log("📊 Cấu trúc kết quả:", resultJson);

        // Phát lệnh xử lý phần cứng trả lại cho ESP32 và tắt đèn báo D32
        if (ws.readyState === 1) {
            if (resultJson.led === 1) ws.send("LED2_ON");
            else if (resultJson.led === 0) ws.send("LED2_OFF");
            else ws.send("GO_SLEEP");
        }

        // Cập nhật kết quả cuối cùng lên Web Monitor
        sendTextToWeb({
            status: "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢",
            text: resultJson.text
        });

    } catch (error) {
        console.error("❌ Lỗi xử lý tại tầng Gemini:", error);
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        sendTextToWeb({ status: "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢", text: "Lỗi hệ thống hoặc không nhận diện được giọng nói." });
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

function sendTextToWeb(obj) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(obj));
        }
    });
}


