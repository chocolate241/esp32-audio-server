const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Khởi tạo Gemini Client (Sử dụng SDK mới chính hãng)
const ai = new GoogleGenAI("AIzaSyAaHN8Ot1-uX792aKgNxm3RD11HJALgBLs");

app.get('/nghe', (req, res) => {
    // [Giữ nguyên code HTML Giao diện của bạn, chỉ chỉnh sửa nhẹ logic nhận text/audio nếu muốn]
    // Để giữ bài viết ngắn gọn và tập trung xử lý lõi, tôi xin phép không paste lại cụm HTML giao diện cực đẹp của bạn ở đây.
    res.send(`...[HTML Giao diện của bạn]...`);
});

const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

// Object lưu trữ buffer âm thanh của từng ESP32 Client dựa trên kết nối
const audioBuffers = new Map();
const silenceTimers = new Map();

wss.on('connection', (ws) => {
    console.log('🔴 Có kết nối mới vào Server');
    audioBuffers.set(ws, []);

    ws.on('message', async (message, isBinary) => {
        // 1. Nếu là dữ liệu Âm thanh (Binary) gửi từ ESP32
        if (isBinary) {
            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Xử lý Broadcast gói tin âm thanh sang trang giao diện Web (gạt bỏ header nếu cần)
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) {
                    client.send(message);
                }
            });

            // Tự động kích hoạt xử lý nếu sau 1.5 giây không nhận thêm dữ liệu âm thanh từ ESP32 (người dùng nói xong)
            clearTimeout(silenceTimers.get(ws));
            let timer = setTimeout(() => {
                processAudioAndCommand(ws);
            }, 1500); 
            silenceTimers.set(ws, timer);
        } else {
            // 2. Nếu là dữ liệu điều khiển Text từ Web (nếu có)
            console.log("Nhận được tin nhắn văn bản:", message.toString());
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        clearTimeout(silenceTimers.get(ws));
        console.log('⚪ Client ngắt kết nối');
    });
});

// Hàm chuyển đổi mảng các buffer PCM 16-bit thành một file WAV hợp lệ (Buffer)
function createWavBuffer(pcmBuffers, sampleRate = 16000) {
    let pcmBuffer = Buffer.concat(pcmBuffers);
    let wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
    
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20); // PCM Format
    wavBuffer.writeUInt16LE(1, 22); // Mono
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (16000 * 1 kênh * 2 bytes)
    wavBuffer.writeUInt16LE(2, 32); // BlockAlign
    wavBuffer.writeUInt16LE(16, 34); // Bits per sample
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
    pcmBuffer.copy(wavBuffer, 44);
    
    return wavBuffer;
}

// Hàm gửi file âm thanh sang Gemini AI xử lý lệnh và phản hồi về ESP32
async function processAudioAndCommand(ws) {
    let pcmBuffers = audioBuffers.get(ws) || [];
    if (pcmBuffers.length === 0) return;
    
    // Reset buffer lưu trữ chuẩn bị cho lần nói tiếp theo
    audioBuffers.set(ws, []);
    console.log("⚡ Đang tạo file WAV và gửi sang Gemini AI Studio...");

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        // Gọi phiên bản gemini-2.5-flash tối ưu tốc độ cao (Dòng Flash xử lý audio cực nhạy)
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    inlineData: {
                        mimeType: 'audio/wav',
                        data: base64Audio
                    }
                },
                {
                    text: `Bạn là trợ lý điều khiển thiết bị nhà thông minh qua giọng nói. 
                    Hãy lắng nghe đoạn âm thanh trên. Nếu người dùng muốn bật đèn/LED, hãy trả về kết quả chính xác dạng JSON: {"led": 1, "text": "Đang bật đèn cho bạn"}. 
                    Nếu họ muốn tắt đèn/LED, trả về: {"led": 0, "text": "Đã tắt đèn xong"}.
                    Nếu đoạn âm thanh không rõ ràng hoặc không có lệnh bật tắt, trả về: {"led": -1, "text": "Tôi nghe không rõ lệnh"}.
                    LƯU Ý: CHỈ TRẢ VỀ JSON, KHÔNG THÊM BẤT KỲ CHỮ NÀO KHÁC NGOÀI CÚ PHÁP JSON.`
                }
            ],
            // Ép cấu trúc đầu ra là JSON để tránh AI trả về chữ thừa làm lỗi ESP32
            config: {
                responseMimeType: "application/json"
            }
        });

        const resultText = response.text;
        console.log("🤖 Gemini Phản hồi:", resultText);

        // Parse kết quả để lấy lệnh gửi về ESP32
        const configJson = JSON.parse(resultText);
        
        // Gửi chuỗi text điều khiển dạng thô "LED_ON" hoặc "LED_OFF" về cho ESP32 dễ xử lý
        if (configJson.led === 1) {
            ws.send("LED_ON");
        } else if (configJson.led === 0) {
            ws.send("LED_OFF");
        }
        
    } catch (error) {
        console.error("❌ Lỗi khi gọi Gemini API:", error);
    }
}
