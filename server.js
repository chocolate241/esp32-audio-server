const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Khởi tạo Gemini Client (Dùng API Key trong file .env hoặc cấu hình Render)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

            /* Khu vực hiển thị câu trả lời của Gemini */
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

        <!-- Khung hiển thị câu trả lời của Gemini AI -->
        <div class="gemini-box">
            <div class="gemini-title">🤖 Trợ lý Gemini AI Phản hồi:</div>
            <div id="geminiResponse" class="gemini-text">Đang chờ âm thanh lệnh từ ESP32...</div>
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
            const geminiResponse = document.getElementById('geminiResponse');

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
                    // Nhận phản hồi văn bản JSON của Gemini từ Server gửi xuống web
                    if (typeof event.data === 'string') {
                        try {
                            const resJson = JSON.parse(event.data);
                            if(resJson.text) {
                                geminiResponse.innerText = resJson.text;
                            }
                        } catch(e) { 
                            // Bỏ qua text thô
                        }
                        return;
                    }

                    if (event.data.byteLength === 0) return;

                    packetCount++;
                    let now = Date.now();
                    let delta = now - lastPacketTime;
                    lastPacketTime = now;
                    
                    // Xử lý đúng dải 32-bit theo thiết bị ESP32 của bạn
                    let int32Array = new Int32Array(event.data);
                    let samplesCount = int32Array.length;
                    sampleRateCounter += samplesCount;

                    let maxVal = 0;
                    for (let i = 0; i < samplesCount; i++) {
                        let absVal = Math.abs(int32Array[i]);
                        if (absVal > maxVal) maxVal = absVal;
                    }
                    let peakPercentage = ((maxVal / 2147483648) * 100).toFixed(1);

                    valPackets.innerText = packetCount;
                    valPeak.innerText = peakPercentage + "%";
                    valLatency.innerText = delta + "ms";

                    if (now - lastSecTime >= 1000) {
                        valSample.innerText = sampleRateCounter + " Hz";
                        sampleRateCounter = 0;
                        lastSecTime = now;
                    }

                    // Giải mã âm thanh 32-bit nguyên bản sang Float [-1.0, 1.0] để phát ra loa mượt mà
                    let audioBuffer = audioCtx.createBuffer(1, samplesCount, 16000);
                    let channelData = audioBuffer.getChannelData(0);
                    
                    for (let i = 0; i < samplesCount; i++) {
                        channelData[i] = int32Array[i] / 2147483648.0;
                    }
                    
                    let source = audioCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(analyser);
                    analyser.connect(audioCtx.destination);
                    
                    if (nextStartTime < audioCtx.currentTime) {
                        nextStartTime = audioCtx.currentTime + 0.03;
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
                canvasCtx.shadowBlur = 0;
            }
        </script>
    </body>
    </html>
    `);
});

const server = app.listen(PORT, () => console.log(`Analytics Server đang chạy tại cổng: ${PORT}`));
const wss = new WebSocketServer({ server });

const audioBuffers = new Map();
const silenceTimers = new Map();

wss.on('connection', (ws) => {
    console.log('🔴 Có thiết bị kết nối vào hệ thống WebSocket');
    audioBuffers.set(ws, []);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            let bufferList = audioBuffers.get(ws) || [];
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Forward âm thanh nhị phân sang Trình duyệt web
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) {
                    client.send(message);
                }
            });

            // Sau 1.5 giây tĩnh lặng kể từ gói âm thanh cuối, gọi Gemini xử lý âm thanh tích lũy
            clearTimeout(silenceTimers.get(ws));
            let timer = setTimeout(() => {
                processAudioAndCommand(ws);
            }, 1500);
            silenceTimers.set(ws, timer);
        }
    });

    ws.on('close', () => {
        audioBuffers.delete(ws);
        clearTimeout(silenceTimers.get(ws));
    });
});

// Hàm tạo cấu trúc file WAV 32-bit PCM chuẩn cho Gemini đọc
function createWavBuffer(pcmBuffers, sampleRate = 16000) {
    let pcmBuffer = Buffer.concat(pcmBuffers);
    let wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20); // Định dạng PCM
    wavBuffer.writeUInt16LE(1, 22); // Mono (1 kênh)
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 4, 28); // SampleRate * 4 bytes (32-bit)
    wavBuffer.writeUInt16LE(4, 32);              // 4 bytes per sample
    wavBuffer.writeUInt16LE(32, 34);             // 32 bits per sample
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
    pcmBuffer.copy(wavBuffer, 44);
    return wavBuffer;
}

async function processAudioAndCommand(ws) {
    let pcmBuffers = audioBuffers.get(ws) || [];
    if (pcmBuffers.length === 0) return;
    
    audioBuffers.set(ws, []);
    console.log("⚡ Đang phân tích giọng nói bằng Gemini AI...");

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý điều khiển thiết bị thông minh bằng tiếng Việt. Hãy lắng nghe đoạn âm thanh trên.
                    - Nếu họ muốn BẬT đèn hoặc thiết bị (ví dụ: "bật đèn", "mở đèn", "bật led"), trả về JSON: {"led": 1, "text": "Đang bật đèn cho bạn"}.
                    - Nếu họ muốn TẮT đèn hoặc thiết bị (ví dụ: "tắt đèn", "tắt led"), trả về JSON: {"led": 0, "text": "Đã tắt đèn xong"}.
                    - Nếu không có lệnh rõ ràng hoặc chỉ là tiếng động, trả về JSON: {"led": -1, "text": "Tôi nghe không rõ lệnh hoặc không có yêu cầu điều khiển"}.
                    CHỈ TRẢ VỀ JSON THÔ, KHÔNG ĐƯỢC CHÈN MARKDOWN HOẶC CHỮ THỪA.`
                }
            ],
            config: { responseMimeType: "application/json" }
        });

        // Xử lý bóc tách text phòng trường hợp AI trả về text có chứa ký tự lạ
        let cleanText = response.text.trim();
        if (cleanText.startsWith("```json")) cleanText = cleanText.replace(/```json|```/g, "").trim();
        
        const resultJson = JSON.parse(cleanText);
        console.log("🤖 Phản hồi:", resultJson);

        // 1. Đồng bộ kết quả văn bản lên giao diện Trình duyệt Web
        wss.clients.forEach((client) => {
            if (client.readyState === 1) {
                client.send(JSON.stringify(resultJson)); 
            }
        });

        // 2. Gửi lệnh text điều khiển ngược về cho chính client ESP32 đang kết nối
        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
            }
        }
        
    } catch (error) {
        console.error("❌ Lỗi xử lý Gemini:", error);
    }
}


