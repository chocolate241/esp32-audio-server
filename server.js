const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');

// 1. CẤU HÌNH HỆ THỐNG & PORT (Render tự cấp cổng qua process.env.PORT)
const PORT = process.env.PORT || 443;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Khởi tạo Gemini API (Lấy API KEY từ Environment Variables trên Render)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Biến toàn cục để hiển thị trạng thái lên giao diện Web HTML
let systemStatus = {
    esp32Connected: false,
    lastActive: "Chưa có kết nối",
    lastAiResponse: "Chưa có dữ liệu",
    totalAudioBytes: 0
};

// --- 2. GIAO DIỆN HTML CỦA SERVER.JS (Hiện thị khi truy cập link Render trên trình duyệt) ---
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Trợ Lý AI ESP32 - Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; margin: 0; padding: 20px; color: #333; text-align: center; }
            .container { max-width: 600px; margin: 30px auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: left; }
            h1 { text-align: center; color: #1a73e8; margin-bottom: 10px; }
            p.subtitle { text-align: center; color: #666; margin-top: 0; font-size: 14px; }
            .status-card { display: flex; align-items: center; justify-content: space-between; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-weight: bold; }
            .online { background-color: #e6f4ea; color: #137333; }
            .offline { background-color: #fce8e6; color: #c5221f; }
            .indicator { width: 12px; height: 12px; border-radius: 50%; display: inline-block; margin-right: 8px; }
            .online .indicator { background-color: #137333; }
            .offline .indicator { background-color: #c5221f; }
            .info-box { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 5px solid #1a73e8; margin-bottom: 15px; }
            .info-box strong { display: block; color: #5f6368; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
            .info-box span { font-size: 16px; word-break: break-all; }
            .footer { margin-top: 30px; font-size: 12px; color: #aaa; text-align: center; }
            .btn-refresh { display: block; width: 100%; text-align: center; background: #1a73e8; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: bold; transition: background 0.2s; }
            .btn-refresh:hover { background: #1557b0; }
        </style>
        <script>
            // Tự động làm mới trang mỗi 3 giây để cập nhật trạng thái mới nhất từ ESP32
            setInterval(() => { location.reload(); }, 3000);
        </script>
    </head>
    <body>
        <div class="container">
            <h1>AI Voice Assistant Server</h1>
            <p class="subtitle">Hệ thống kết nối ESP32 & Gemini AI (Render Cloud)</p>
            
            <div class="status-card ${systemStatus.esp32Connected ? 'online' : 'offline'}">
                <span>Trạng thái ESP32:</span>
                <span><span class="indicator"></span>${systemStatus.esp32Connected ? 'Đang kết nối (Online)' : 'Mất kết nối (Offline)'}</span>
            </div>

            <div class="info-box">
                <strong>Hoạt động cuối cùng:</strong>
                <span>${systemStatus.lastActive}</span>
            </div>

            <div class="info-box">
                <strong>Dung lượng âm thanh nhận được (lần cuối):</strong>
                <span>${systemStatus.totalAudioBytes > 0 ? (systemStatus.totalAudioBytes + ' bytes') : '0 bytes'}</span>
            </div>

            <div class="info-box" style="border-left-color: #34a853;">
                <strong>Phản hồi mới nhất từ Gemini AI:</strong>
                <span>${systemStatus.lastAiResponse}</span>
            </div>

            <button class="btn-refresh" onclick="location.reload()">CẬP NHẬT TRẠNG THÁI</button>
            <p class="footer">Server hoạt động thời gian thực qua WebSocket mã hóa (WSS)</p>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// --- 3. LUỒNG XỬ LÝ WEBSOCKET CHO ESP32 ---
wss.on('connection', (ws) => {
    console.log('🔌 [Kết nối] Một ESP32 đã kết nối vào server!');
    systemStatus.esp32Connected = true;
    systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - ESP32 vừa kết nối thành công.";
    
    let audioChunks = []; 
    let isProcessing = false;

    ws.on('message', async (message, isBinary) => {
        
        // TRẠNG THÁI A: Xử lý dữ liệu TEXT
        if (!isBinary) {
            const command = message.toString().trim();
            
            // Xử lý gói tin PING để Render không đưa server vào chế độ ngủ đông
            if (command === "PING") {
                systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - Nhận gói PING giữ mạng từ ESP32.";
                return;
            }

            // Nhận lệnh báo kết thúc thu âm từ ESP32
            if (command === "RESET_STATE") {
                console.log("⏱️ ESP32 hết 5 giây thu âm. Bắt đầu xử lý...");
                systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - Đang xử lý file âm thanh...";

                if (audioChunks.length > 0 && !isProcessing) {
                    isProcessing = true;
                    
                    // Gọi hàm xử lý AI
                    await processAudioAndCallGemini(ws, audioChunks);
                    
                    audioChunks = []; // Xóa bộ đệm cũ
                    isProcessing = false;
                } else {
                    console.log("⚠️ Bộ đệm rỗng hoặc hệ thống đang bận.");
                    systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - Lỗi: Bộ đệm trống hoặc server đang bận.";
                }
            }
            return;
        }

        // TRẠNG THÁI B: Gom dữ liệu nhị phân (Âm thanh thô PCM) từ I2S
        if (isBinary) {
            audioChunks.push(message);
        }
    });

    ws.on('close', () => {
        console.log('❌ [Ngắt kết nối] ESP32 đã rời mạng.');
        systemStatus.esp32Connected = false;
        systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - ESP32 đã ngắt kết nối.";
        audioChunks = [];
    });

    ws.on('error', (error) => {
        console.error('🔥 Lỗi Socket:', error.message);
    });
});

// --- 4. HÀM XỬ LÝ PCM VÀ LIÊN KẾT GEMINI AI ---
async function processAudioAndCallGemini(ws, chunks) {
    try {
        const pcmBuffer = Buffer.concat(chunks);
        systemStatus.totalAudioBytes = pcmBuffer.length;
        console.log(`📦 Tổng dung lượng âm thanh nhận được: ${pcmBuffer.length} bytes`);

        if (pcmBuffer.length < 4000) { 
            console.log("❌ Âm thanh quá ngắn, bỏ qua.");
            systemStatus.lastAiResponse = "Âm thanh quá ngắn (nhiễu môi trường), không xử lý.";
            ws.send("LED2_OFF"); 
            return;
        }

        // Chuyển mã sang Base64 để nhúng thẳng vào JSON gửi API cho Gemini
        const base64Audio = pcmBuffer.toString('base64');
        console.log("🤖 Đang gửi dữ liệu âm thanh tới Gemini AI...");

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    inlineData: {
                        mimeType: 'audio/pcm;rate=16000', // Khai báo tần số 16kHz mã hóa 16bit giống I2S ESP32
                        data: base64Audio
                    }
                },
                { text: "Bạn là một trợ lý ảo chạy trên mạch phần cứng ESP32. Hãy lắng nghe và trả lời lại người dùng bằng văn bản thật ngắn gọn dưới 20 từ. Đặc biệt lưu ý: Nếu người dùng yêu cầu 'bật đèn' hoặc câu từ tương tự có ý định bật đèn, hãy trả về ĐÚNG từ khóa 'LED2_ON'. Nếu người dùng yêu cầu 'tắt đèn', hãy trả về ĐÚNG từ khóa 'LED2_OFF'. Ngoài 2 lệnh này ra thì bạn cứ trả lời giao tiếp bình thường ngắn gọn." }
            ],
        });

        const aiResponse = response.text.trim();
        console.log(`📩 Phản hồi từ Gemini: ${aiResponse}`);
        
        // Cập nhật lên giao diện HTML web
        systemStatus.lastAiResponse = aiResponse;
        systemStatus.lastActive = new Date().toLocaleTimeString('vi-VN') + " - Đã xử lý xong lệnh từ AI.";

        // Trả kết quả chữ (hoặc lệnh LED2_ON/LED2_OFF) về lại cho mạch ESP32 thực thi
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(aiResponse); 
        }

    } catch (error) {
        console.error("❌ Lỗi trong quá trình xử lý AI:", error);
        systemStatus.lastAiResponse = "Lỗi kết nối API Gemini: " + error.message;
        if (ws.readyState === WebSocket.OPEN) {
            ws.send("Lỗi xử lý hệ thống");
        }
    }
}

// 5. KHỞI CHẠY SERVER TÍCH HỢP HTTP + WEBSOCKET
server.listen(PORT, () => {
    console.log(`✅ Toàn bộ hệ thống đã chạy tại port: ${PORT}`);
});
