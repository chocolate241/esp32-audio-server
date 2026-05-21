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
        <title>Cloud Audio Analytics PRO</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; background: #0b0c10; color: #c5c6c7; margin: 0; padding: 20px; }
            h2 { color: #66fcf1; margin-bottom: 5px; font-weight: 600; }
            p { color: #45f3ff; font-size: 14px; margin-top: 0; margin-bottom: 25px; }
            button { padding: 15px 35px; font-size: 16px; cursor: pointer; background: #66fcf1; color: #0b0c10; border: none; border-radius: 25px; font-weight: bold; box-shadow: 0 4px 15px rgba(102,252,241,0.3); transition: 0.3s; }
            button:hover { background: #45f3ff; transform: translateY(-2px); }
           
            /* Khu vực Dashboard số liệu */
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
            <div class="card">
                <div class="card-title">Biên độ Đỉnh</div>
                <div id="valPeak" class="card-value">0%</div>
            </div>
            <div class="card">
                <div class="card-title">Tần số mẫu</div>
                <div id="valSample" class="card-value">0 Hz</div>
            </div>
            <div class="card">
                <div class="card-title">Số Gói Nhận</div>
                <div id="valPackets" class="card-value">0</div>
            </div>
            <div class="card">
                <div class="card-title">Độ Trễ 🛡️</div>
                <div id="valLatency" class="card-value">0ms</div>
            </div>
        </div>


        <canvas id="visualizer" width="600" height="160"></canvas>


        <script>
            let audioCtx;
            let ws;
            let analyser;
            let nextStartTime = 0;
           
            // Các biến phục vụ thống kê số liệu
            let packetCount = 0;
            let lastPacketTime = Date.now();
            let sampleRateCounter = 0;
            let lastSecTime = Date.now();


            const startBtn = document.getElementById('startBtn');
            const statusDiv = document.getElementById('status');
            const canvas = document.getElementById('visualizer');
            const canvasCtx = canvas.getContext('2d');


            // Các thẻ hiển thị số liệu
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
                statusDiv.innerText = "Đang bắt tín hiệu từ Cloud...";


                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                ws = new WebSocket(protocol + window.location.host);
                ws.binaryType = 'arraybuffer';


                ws.onopen = () => {
    statusDiv.innerText = "HỆ THỐNG ONLINE - ĐANG ĐO ĐẠC ĐƯỜNG TRUYỀN 🟢";
    statusDiv.style.color = "#66fcf1";
    nextStartTime = audioCtx.currentTime;
    draw();
};


ws.onmessage = (event) => {
    if (event.data.byteLength === 0) return;


    // 1. Phân tích số liệu gói tin
    packetCount++;
    let now = Date.now();
    let delta = now - lastPacketTime;
    lastPacketTime = now;
    
    // Nhận dữ liệu dưới dạng Int32Array (Mỗi mẫu chiếm 2 bytes, khớp với cấu hình 16-bit mới của ESP32)
    let Int32Array = new Int32Array(event.data);
    let samplesCount = Int32Array.length;
    sampleRateCounter += samplesCount;


    // Tính toán Biên độ đỉnh (Peak Amplitude) chính xác cho hệ 16-bit
    let maxVal = 0;
    for (let i = 0; i < samplesCount; i++) {
        let absVal = Math.abs(Int32Array[i]);
        if (absVal > maxVal) maxVal = absVal;
    }
    let peakPercentage = ((maxVal / 32768) * 100).toFixed(1);


    // Cập nhật số liệu lên màn hình sau mỗi gói
    valPackets.innerText = packetCount;
    valPeak.innerText = peakPercentage + "%";
    valLatency.innerText = delta + "ms";


    // Cập nhật tần số mẫu thực tế (Chuẩn 16000 Hz)
    if (now - lastSecTime >= 1000) {
        valSample.innerText = sampleRateCounter + " Hz";
        sampleRateCounter = 0;
        lastSecTime = now;
    }


    // 2. Xử lý giải mã và đẩy vào mạch phát âm thanh chống giật
    let audioBuffer = audioCtx.createBuffer(1, samplesCount, 16000);
    let channelData = audioBuffer.getChannelData(0);
   
    for (let i = 0; i < samplesCount; i++) {
        channelData[i] = Int32Array[i] / 32768.0; // Chuẩn hóa biên độ về khoảng [-1.0, 1.0]
    }
   
    let source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
   
    if (nextStartTime < audioCtx.currentTime) {
        nextStartTime = audioCtx.currentTime + 0.03; // Buffer chống giật 30ms
    }
   
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;
};
};


            // Vẽ đồ thị sóng âm Radar Cyan chuyên nghiệp
            function draw() {
                requestAnimationFrame(draw);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);


                canvasCtx.fillStyle = '#1f2833';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
               
                // Vẽ lưới tọa độ âm thanh nền (Grid)
                canvasCtx.strokeStyle = '#45f3ff11';
                canvasCtx.lineWidth = 1;
                for(let i = 0; i < canvas.width; i += 40) {
                    canvasCtx.beginPath(); canvasCtx.moveTo(i, 0); canvasCtx.lineTo(i, canvas.height); canvasCtx.stroke();
                }
                for(let i = 0; i < canvas.height; i += 30) {
                    canvasCtx.beginPath(); canvasCtx.moveTo(0, i); canvasCtx.lineTo(canvas.width, i); canvasCtx.stroke();
                }


                // Vẽ đường sóng chính
                canvasCtx.lineWidth = 2.5;
                canvasCtx.strokeStyle = '#66fcf1';
                canvasCtx.shadowBlur = 4;
                canvasCtx.shadowColor = '#66fcf1';
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
                canvasCtx.shadowBlur = 0; // reset shadow
            }
        </script>
    </body>
    </html>
    `);
});


const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
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

