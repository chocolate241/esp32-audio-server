const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Giao diện Web dành cho Laptop truy cập từ xa để nghe
app.get('/nghe', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Cloud Audio Stream</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial; text-align: center; margin-top: 50px; background: #1e1e24; color: white; }
            button { padding: 15px 30px; font-size: 18px; cursor: pointer; background: #00b4d8; color: white; border: none; border-radius: 5px; font-weight: bold;}
            #status { margin-top: 20px; color: #90e0ef; font-weight: bold; }
        </style>
    </head>
    <body>
        <h2>ESP32 INMP441 Listening via Cloud</h2>
        <button id="startBtn">BẮT ĐẦU NGHE TỪ XA</button>
        <div id="status">Chưa kết nối Cloud Server</div>

        <script>
            let audioCtx;
            let ws;
            const startBtn = document.getElementById('startBtn');
            const statusDiv = document.getElementById('status');

            startBtn.onclick = () => {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                startBtn.style.display = 'none';
                statusDiv.innerText = "Đang kết nối tới Cloud Server...";
                
                // Tự động lấy địa chỉ IP/Domain của Server hiện tại
                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                ws = new WebSocket(protocol + window.location.host);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => { statusDiv.innerText = "Đã kết nối! Đang nghe micro thời gian thực..."; };
                ws.onclose = () => { statusDiv.innerText = "Mất kết nối với Server!"; };
                
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
                        source.connect(audioCtx.destination);
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
    console.log(`Laptop truy cập link này để nghe: http://localhost:${PORT}/nghe`);
});

// Khởi tạo WebSocket Server chạy chung cổng với HTTP
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Có thiết bị mới kết nối (ESP32 hoặc Trình duyệt Laptop)');

    ws.on('message', (message) => {
        // Nhận dữ liệu Binary từ ESP32 và phát lại (Broadcast) cho tất cả các Laptop đang vào xem link /nghe
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => console.log('Một thiết bị đã ngắt kết nối.'));
});