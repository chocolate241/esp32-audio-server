const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Cấu hình cổng (Render cung cấp biến môi trường PORT)
const PORT = process.env.PORT || 3000;

// Middleware cơ bản
app.get('/', (req, res) => res.send('ESP32 Audio Server is running!'));

// Xử lý kết nối WebSocket
wss.on('connection', (ws) => {
    console.log('ESP32 đã kết nối thành công.');

    ws.on('message', (message) => {
        // message là Buffer từ ESP32 gửi lên
        if (Buffer.isBuffer(message)) {
            // XỬ LÝ ÂM THANH (TĂNG ÂM LƯỢNG)
            const processedBuffer = boostVolume(message, 2.5); // Tăng âm lượng 2.5 lần
            
            // Ở ĐÂY: Gửi dữ liệu đã xử lý sang AI hoặc luồng Speech-to-Text
            // Ví dụ: handleVoiceCommand(processedBuffer);
        }
    });

    ws.on('close', () => console.log('ESP32 đã ngắt kết nối.'));
});

// HÀM TĂNG ÂM LƯỢNG (PCM 16-bit)
function boostVolume(buffer, multiplier) {
    const output = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i += 2) {
        let sample = buffer.readInt16LE(i);
        sample = Math.min(32767, Math.max(-32768, sample * multiplier));
        output.writeInt16LE(sample, i);
    }
    return output;
}

// HÀM GỬI LỆNH ĐIỀU KHIỂN ĐÈN (Gọi hàm này khi cần bật/tắt)
function sendLedCommand(command) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(command); // Gửi "LED_ON" hoặc "LED_OFF"
        }
    });
}

server.listen(PORT, () => {
    console.log(`Server đang lắng nghe tại port ${PORT}`);
});
