const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 8080;

// [ADD-ON] Cấu hình Gemini AI - Hãy thay API Key của bạn vào đây
const genAI = new GoogleGenerativeAI("AIzaSyAaHN8Ot1-uX792aKgNxm3RD11HJALgBLs");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        <canvas id="visualizer" width="600" height="160"></canvas>
        <script>
            let audioCtx, ws, analyser, nextStartTime = 0;
            let packetCount = 0, lastPacketTime = Date.now(), sampleRateCounter = 0, lastSecTime = Date.now();
            const startBtn = document.getElementById('startBtn'), statusDiv = document.getElementById('status');
            const canvas = document.getElementById('visualizer'), canvasCtx = canvas.getContext('2d');
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
                    statusDiv.innerText = "HỆ THỐNG ONLINE 🟢"; statusDiv.style.color = "#66fcf1";
                    nextStartTime = audioCtx.currentTime; draw();
                };
                ws.onmessage = (event) => {
                    if (event.data instanceof ArrayBuffer) {
                        packetCount++; let now = Date.now();
                        valLatency.innerText = (now - lastPacketTime) + "ms"; lastPacketTime = now;
                        let int16Array = new Int16Array(event.data);
                        let samplesCount = int16Array.length; sampleRateCounter += samplesCount;
                        let maxVal = 0; for (let i = 0; i < samplesCount; i++) { if (Math.abs(int16Array[i]) > maxVal) maxVal = Math.abs(int16Array[i]); }
                        valPeak.innerText = ((maxVal / 32768) * 100).toFixed(1) + "%";
                        valPackets.innerText = packetCount;
                        if (now - lastSecTime >= 1000) { valSample.innerText = sampleRateCounter + " Hz"; sampleRateCounter = 0; lastSecTime = now; }
                        let audioBuffer = audioCtx.createBuffer(1, samplesCount, 16000);
                        let channelData = audioBuffer.getChannelData(0);
                        for (let i = 0; i < samplesCount; i++) { channelData[i] = int16Array[i] / 32768.0; }
                        let source = audioCtx.createBufferSource(); source.buffer = audioBuffer;
                        source.connect(analyser); analyser.connect(audioCtx.destination);
                        if (nextStartTime < audioCtx.currentTime) nextStartTime = audioCtx.currentTime + 0.03;
                        source.start(nextStartTime); nextStartTime += audioBuffer.duration;
                    }
                };
            };
            function draw() {
                requestAnimationFrame(draw); const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength); analyser.getByteTimeDomainData(dataArray);
                canvasCtx.fillStyle = '#1f2833'; canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                canvasCtx.strokeStyle = '#66fcf1'; canvasCtx.lineWidth = 2; canvasCtx.beginPath();
                let sliceWidth = canvas.width / bufferLength, x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    let v = dataArray[i] / 128.0, y = v * canvas.height / 2;
                    if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
                    x += sliceWidth;
                }
                canvasCtx.lineTo(canvas.width, canvas.height / 2); canvasCtx.stroke();
            }
        </script>
    </body>
    </html>
    `);
});

const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

// [ADD-ON] Bộ đệm âm thanh để xử lý Gemini
let audioChunks = [];

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        // Luồng 1: Forward dữ liệu âm thanh tới giao diện web (Giữ nguyên)
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(message);
            }
        });

        // Luồng 2: [ADD-ON] Xử lý Gemini STT
        if (Buffer.isBuffer(message) || message instanceof Uint8Array) {
            audioChunks.push(Buffer.from(message));

            // Đợi đủ ~5 giây (16000Hz * 4bytes * 5s = 320000 bytes)
            if (Buffer.concat(audioChunks).length >= 320000) {
                const fullAudio = Buffer.concat(audioChunks);
                audioChunks = []; // Clear buffer ngay lập tức

                try {
                    const base64Audio = fullAudio.toString('base64');
                    const result = await model.generateContent([
                        {
                            inlineData: {
                                data: base64Audio,
                                mimeType: "audio/pcm;rate=16000"
                            }
                        },
                        "Phân tích giọng nói tiếng Việt. Nếu người dùng muốn bật đèn hoặc bật LED hãy trả về chính xác 'LED2_ON'. Nếu muốn tắt hãy trả về 'LED2_OFF'. Ngoài ra trả về 'NONE'. Không giải thích thêm."
                    ]);

                    const responseText = result.response.text().toUpperCase();
                    
                    // Gửi lệnh văn bản xuống cho ESP32
                    if (responseText.includes("LED2_ON") || responseText.includes("LED2_OFF")) {
                        const finalCmd = responseText.includes("LED2_ON") ? "LED2_ON" : "LED2_OFF";
                        wss.clients.forEach(client => {
                            if (client.readyState === 1) client.send(finalCmd);
                        });
                        console.log("-> Sent command to ESP32:", finalCmd);
                    }
                } catch (error) {
                    console.error("Gemini Error:", error.message);
                }
            }
        }
    });
});