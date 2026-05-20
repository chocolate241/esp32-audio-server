const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

// Giao diện Web dành cho Laptop truy cập từ xa để nghe (Có Radar Sóng âm)
app.get('/nghe', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Cloud Audio Stream PRO</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial; text-align: center; margin-top: 50px; background: #1a1a2e; color: white; }
            button { padding: 15px 30px; font-size: 18px; cursor: pointer; background: #e94560; color: white; border: none; border-radius: 5px; font-weight: bold; margin-bottom: 20px; transition: 0.3s; box-shadow: 0 4px 15px rgba(233,69,96,0.4); }
            button:hover { background: #ff4757; transform: scale(1.05); }
            #status { margin-top: 10px; color: #4cd137; font-weight: bold; margin-bottom: 30px; font-size: 18px; }
            canvas { background: #16213e; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: none; margin: 0 auto; border: 1px solid #0f3460; }
        </style>
    </head>
    <body>
        <h2>🎙️ Trạm Thu Âm ESP32 Toàn Cầu</h2>
        <button id="startBtn">KẾT NỐI VÀ NGHE</button>
        <div id="status">Chưa kết nối Cloud Server</div>
        
        <canvas id="visualizer" width="600" height="150"></canvas>

        <script>
            let audioCtx;
            let ws;
            let analyser;
            const startBtn = document.getElementById('startBtn');
            const statusDiv = document.getElementById('status');
            const canvas = document.getElementById('visualizer');
            const canvasCtx = canvas.getContext('2d');

            // Hàm vẽ Radar sóng âm thời gian thực
            function drawVisualizer() {
                requestAnimationFrame(drawVisualizer);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);

                canvasCtx.fillStyle = '#16213e';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                canvasCtx.lineWidth = 3;
                canvasCtx.strokeStyle = '#00d2d3';
                canvasCtx.beginPath();

                let sliceWidth = canvas.width * 1.0 / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    let v = dataArray[i] / 128.0;
                    let y = v * canvas.height / 2;
                    if (i === 0) { canvasCtx.moveTo(x, y); } 
                    else { canvasCtx.lineTo(x, y); }
                    x += sliceWidth;
                }
                canvasCtx.lineTo(canvas.width, canvas.height / 2);
                canvasCtx.stroke();
            }

            startBtn.onclick = () => {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 2048;

                startBtn.style.display = 'none';
                canvas.style.display = 'block';
                statusDiv.innerText = "Đang kết nối tới Cloud Server...";
                
                // Tự động lấy địa chỉ IP/Domain của Server hiện tại
                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                ws = new WebSocket(protocol + window.location.host);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => { 
                    statusDiv.innerText = "Đã kết nối! Đang truyền âm thanh trực tiếp 🟢"; 
                    statusDiv.style.color = "#00d2d3";
                    drawVisualizer(); 
                };
                ws.onclose = () => { 
                    statusDiv.innerText = "Mất kết nối với Server! 🔴"; 
                    statusDiv.style.color = "#ff4757";
                };
                
                ws.onmessage = (event) => {
                    if (event.data instanceof ArrayBuffer) {
                        let int16Array = new Int16Array(event.data);
                        let float32Array = new Float32Array(int16Array.length);
                        
                        for (let i = 0; i < int16Array.length; i++) {
                            float32Array[i] = int16Array[i] / 32768.0;
                        }
                        
                        let audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000);
                        audioBuffer.getChannelData(0).set(float32Array);
                        
                        let source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        
                        // Nối âm thanh qua bộ phân tích (vẽ sóng) rồi mới ra loa
                        source.connect(analyser);
                        analyser.connect(audioCtx.destination);
                        source.start();
                    }
                };
            };
        </script>
    </body>
    </html>
    `);
});

// Khởi chạy HTTP Server
const server = app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng: ${PORT}`);
});

// Khởi tạo WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Có thiết bị mới kết nối (ESP32 hoặc Trình duyệt Laptop)');

    ws.on('message', (message) => {
        // Nhận dữ liệu từ ESP32 và phát lại cho tất cả các Laptop đang xem
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => console.log('Một thiết bị đã ngắt kết nối.'));
});