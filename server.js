const express = require('express');
const { WebSocketServer } = require('ws');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/nghe', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Cloud Audio 32Bit Raw Analytics</title>
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
            canvas { background: #1f2833; border-radius: 10px; display: none; margin: 0 auto; border: 1px solid #1f2833; }
        </style>
    </head>
    <body>
        <h2>🎙️ HỆ THỐNG GIÁM SÁT ÂM THANH GỐC 32-BIT</h2>
        <p>Chế độ thu: Dữ liệu thô từ mạng nội bộ lên Cloud</p>
        
        <button id="startBtn">KẾT NỐI VÀ NGHE GIỌNG GỐC</button>
        <div id="status">Hệ thống đang chờ lệnh...</div>

        <div class="dashboard">
            <div class="card">
                <div class="card-title">Biên độ Đỉnh</div>
                <div id="valPeak" class="card-value">0%</div>
            </div>
            <div class="card">
                <div class="card-title">Tần số mẫu thực</div>
                <div id="valSample" class="card-value">0 Hz</div>
            </div>
            <div class="card">
                <div class="card-title">Số Gói Nhận</div>
                <div id="valPackets" class="card-value">0</div>
            </div>
            <div class="card">
                <div class="card-title">Độ Trễ Internet</div>
                <div id="valLatency" class="card-value">0ms</div>
            </div>
        </div>

        <canvas id="visualizer" width="600" height="160"></canvas>

        <script>
            let audioCtx;
            let ws;
            let analyser;
            let nextStartTime = 0;
            
            let packetCount = 0;
            let lastPacketTime = Date.now();
            let sampleRateCounter = 0;
            let lastSecTime = Date.now();

            const startBtn = document.getElementById('startBtn');
            const statusDiv = document.getElementById('status');
            const canvas = document.getElementById('visualizer');
            const canvasCtx = canvas.getContext('2d');

            const valPeak = document.getElementById('valPeak');
            const valSample = document.getElementById('valSample');
            const valPackets = document.getElementById('valPackets');
            const valLatency = document.getElementById('valLatency');

            startBtn.onclick = () => {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;

                startBtn.style.display = 'none';
                canvas.style.display = 'block';
                statusDiv.innerText = "Đang kết nối nhận luồng âm thanh...";

                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                ws = new WebSocket(protocol + window.location.host);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => { 
                    statusDiv.innerText = "MÁY CHỦ LIVE - ĐANG PHÁT GIỌNG THỰC 🟢"; 
                    statusDiv.style.color = "#66fcf1";
                    nextStartTime = audioCtx.currentTime;
                    draw();
                };

                ws.onmessage = (event) => {
                    if (event.data.byteLength === 0) return;

                    packetCount++;
                    let now = Date.now();
                    let delta = now - lastPacketTime;
                    lastPacketTime = now;
                    
                    // 🔥 ĐỒNG BỘ: Đọc mảng Int32Array (4 bytes/mẫu) khớp chuẩn 100% dữ liệu bạn gửi
                    let int32Array = new Int32Array(event.data);
                    let samplesCount = int32Array.length;
                    sampleRateCounter += samplesCount;

                    // Đo đạc biên độ đỉnh dựa trên dải động 32-bit thực tế từ chip xử lý
                    let maxVal = 0;
                    for (let i = 0; i < samplesCount; i++) {
                        let absVal = Math.abs(int32Array[i]);
                        if (absVal > maxVal) maxVal = absVal;
                    }
                    
                    // Chuẩn hóa dải đo dựa trên bit thực tế nhận từ INMP441 (thường dịch trái sẵn ở phần cứng)
                    let normalizedMax = maxVal / 2147483648.0;
                    let peakPercentage = (normalizedMax * 100).toFixed(1);

                    valPackets.innerText = packetCount;
                    valPeak.innerText = peakPercentage + "%";
                    valLatency.innerText = delta + "ms";

                    if (now - lastSecTime >= 1000) {
                        valSample.innerText = sampleRateCounter + " Hz";
                        sampleRateCounter = 0;
                        lastSecTime = now;
                    }

                    // Khởi tạo bộ phát âm thanh
                    let audioBuffer = audioCtx.createBuffer(1, samplesCount, 16000);
                    let channelData = audioBuffer.getChannelData(0);
                    
                    for (let i = 0; i < samplesCount; i++) {
                        // Ép dải int32 về khoảng số thực float [-1.0, 1.0] chuẩn Web Audio API
                        channelData[i] = int32Array[i] / 2147483648.0;
                    }
                    
                    let source = audioCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(analyser);
                    analyser.connect(audioCtx.destination);
                    
                    // Thuật toán chống lag nối đuôi jitter buffer
                    if (nextStartTime < audioCtx.currentTime) {
                        nextStartTime = audioCtx.currentTime + 0.04; 
                    }
                    
                    source.start(nextStartTime);
                    nextStartTime += audioBuffer.duration;
                };
            };

            function draw() {
                requestAnimationFrame(draw);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);

                canvasCtx.fillStyle = '#1f2833';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                
                canvasCtx.strokeStyle = '#45f3ff11';
                canvasCtx.lineWidth = 1;
                for(let i = 0; i < canvas.width; i += 40) {
                    canvasCtx.beginPath(); canvasCtx.moveTo(i, 0); canvasCtx.lineTo(i, canvas.height); canvasCtx.stroke();
                }
                for(let i = 0; i < canvas.height; i += 30) {
                    canvasCtx.beginPath(); canvasCtx.moveTo(0, i); canvasCtx.lineTo(canvas.width, i); canvasCtx.stroke();
                }

                canvasCtx.lineWidth = 2.5;
                canvasCtx.strokeStyle = '#66fcf1';
                canvasCtx.beginPath();

                let sliceWidth = canvas.width / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    let v = dataArray[i] / 128.0;
                    let y = v * canvas.height / 2;
                    if (i === 0) canvasCtx.moveTo(x, y);
                    else canvasCtx.lineTo(x, y);
                    x += sliceWidth;
                }
                canvasCtx.lineTo(canvas.width, canvas.height / 2);
                canvasCtx.stroke();
            }
        </script>
    </body>
    </html>
    `);
});

const server = app.listen(PORT, () => console.log(`Server chạy trên cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(message);
            }
        });
    });
});
