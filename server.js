const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Khởi tạo SDK Gemini mới nhất
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Quản lý trạng thái và bộ đệm của từng kết nối
const deviceStates = new Map();     // 'WAIT_WAKE' hoặc 'RECORDING'
const audioBuffers = new Map();     // Nơi lưu trữ các Buffer nhị phân từ ESP32
const recordingTimers = new Map();  // Quản lý thời gian đếm ngược 5 giây câu lệnh
const isScanningMap = new Map();    // Khóa chống spam gọi API trùng lặp khi đang xử lý

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
    console.log('🟢 [WS] Thiết bị đã kết nối thành công!');
    
    // Khởi tạo các trạng thái ban đầu cho kết nối mới
    deviceStates.set(ws, 'WAIT_WAKE');
    audioBuffers.set(ws, []);
    isScanningMap.set(ws, false);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            let state = deviceStates.get(ws) || 'WAIT_WAKE';
            let bufferList = audioBuffers.get(ws) || [];
            
            bufferList.push(Buffer.from(message));
            audioBuffers.set(ws, bufferList);

            // Gửi luồng dữ liệu sang trình duyệt phục vụ biểu đồ trực quan
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) {
                    client.send(message);
                }
            });

            // LOGIC CHẾ ĐỘ CHỜ WAKE WORD
            if (state === 'WAIT_WAKE') {
                let isScanning = isScanningMap.get(ws);
                
                // Thu thập đủ khoảng ~1.5 giây dữ liệu âm thanh (khoảng 25-30 gói nhỏ từ ESP32)
                if (bufferList.length >= 45) {
                    if (!isScanning) {
                        // Khóa mạch lại để tiến hành phân tích, cắt mảng gối đầu chống mất từ
                        let pcmToScan = [...bufferList];
                        audioBuffers.set(ws, bufferList.slice(12)); 
                        
                        // Kích hoạt quét từ khóa
                        checkWakeWord(ws, pcmToScan);
                    } else {
                        // Nếu Gemini đang bận quét gói trước, thực hiện cuốn chiếu cắt đuôi bộ đệm liên tục
                        if(bufferList.length > 40) {
                            audioBuffers.set(ws, bufferList.slice(20));
                        }
                    }
                }
            }
        }
    });

    ws.on('close', () => {
        console.log('🔴 [WS] Thiết bị đã ngắt kết nối.');
        audioBuffers.delete(ws);
        deviceStates.delete(ws);
        isScanningMap.delete(ws);
        if (recordingTimers.has(ws)) clearTimeout(recordingTimers.get(ws));
        recordingTimers.delete(ws);
    });
});

// ==================== HÀM QUÉT TỪ KHÓA CHỦ ĐỘNG ====================
async function checkWakeWord(ws, pcmBuffers) {
    isScanningMap.set(ws, true); // Đặt khóa bận
    console.log("🔍 [WakeWord] Đang kiểm tra âm thanh nền...");

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                { text: `Lắng nghe âm thanh ngắn này. Người dùng có gọi cụm từ "hey gemini" hoặc "hey gemi" không? Hãy bỏ qua các tiếng ồn xung quanh. Trả về cấu trúc JSON nghiêm ngặt: {"detected": true} hoặc {"detected": false}.` }
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
        console.log(`📊 [WakeWord] Kết quả phân tích: ${result.detected}`);

        if (result.detected === true) {
            console.log("🔓 [KÍCH HOẠT] Phát hiện chính xác cụm từ 'Hey Gemini'! Chuyển mạch thu âm lệnh...");
            
            deviceStates.set(ws, 'RECORDING');
            audioBuffers.set(ws, []); // Xóa sạch dữ liệu chờ để đón nhận câu lệnh mới tinh

            // Phát lệnh bật sáng đèn LED D32 trên ESP32
            if (ws.readyState === 1) ws.send("WAKE_UP");

            // Cập nhật trạng thái trên trang web theo dõi
            sendTextToWeb({ status: "🔴 ĐANG NGHE LỆNH ĐIỀU KHIỂN (5S)...", text: "Hệ thống đã kích hoạt! Mời bạn đọc lệnh (Bật/Tắt đèn)..." });

            // Hẹn giờ đúng 5 giây sau sẽ tự động khóa và biên dịch câu lệnh chính
            let timer = setTimeout(() => {
                processCommand(ws);
            }, 5000);
            recordingTimers.set(ws, timer);
        }
    } catch (e) {
        console.error("⚠️ [WakeWord] Lỗi quét dữ liệu nền hoặc lỗi JSON.");
    } finally {
        // Chỉ mở khóa quét tiếp nếu trạng thái vẫn đang là WAIT_WAKE
        if (deviceStates.get(ws) === 'WAIT_WAKE') {
            isScanningMap.set(ws, false);
        }
    }
}

// ==================== HÀM BIÊN DỊCH CÂU LỆNH CHÍNH ====================
async function processCommand(ws) {
    console.log("🔒 [Ghi Âm] Hết 5 giây. Khóa cổng thu âm và gửi câu lệnh lên Gemini...");
    sendTextToWeb({ status: "🤖 GEMINI ĐANG PHÂN TÍCH CÂU LỆNH...", text: "Vui lòng đợi giây lát..." });

    let pcmBuffers = audioBuffers.get(ws) || [];
    
    // Đưa thiết bị quay về trạng thái chờ từ khóa ngay lập tức để giải phóng tài nguyên
    deviceStates.set(ws, 'WAIT_WAKE');
    audioBuffers.set(ws, []);
    isScanningMap.set(ws, false);

    if (pcmBuffers.length === 0) {
        console.log("⚠️ [Ghi Âm] Bộ đệm trống, không có âm thanh lệnh.");
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        sendTextToWeb({ status: "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢", text: "Không nhận được âm thanh câu lệnh." });
        return;
    }

    try {
        const wavBuffer = createWavBuffer(pcmBuffers, 16000);
        const base64Audio = wavBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                    text: `Bạn là trợ lý điều khiển thiết bị thông minh bằng tiếng Việt. Hãy lắng nghe đoạn âm thanh trên.
                    - Nếu họ muốn BẬT đèn hoặc thiết bị (ví dụ: "bật đèn", "mở đèn", "bật led"), trả về led = 1 và một câu text thông báo phản hồi ngắn gọn tương ứng.
                    - Nếu họ muốn TẮT đèn hoặc thiết bị (ví dụ: "tắt đèn", "tắt led"), trả về led = 0 và một câu text thông báo phản hồi ngắn gọn tương ứng.
                    - Nếu không nghe thấy câu lệnh điều khiển nào rõ ràng, trả về led = -1 và câu text giải thích.`
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
        if (!cleanText) throw new Error("Phản hồi rỗng");

        const resultJson = JSON.parse(cleanText);
        console.log("📊 [Kết Quả Lệnh] Gemini phản hồi cấu trúc:", resultJson);

        // Thực thi điều khiển phần cứng của mạch ESP32 thông qua tín hiệu truyền về
        if (ws.readyState === 1) {
            if (resultJson.led === 1) {
                ws.send("LED2_ON");
                console.log("🚀 [Điều Khiển] Đã gửi lệnh bật thiết bị: LED2_ON");
            } else if (resultJson.led === 0) {
                ws.send("LED2_OFF");
                console.log("🚀 [Điều Khiển] Đã gửi lệnh tắt thiết bị: LED2_OFF");
            } else {
                ws.send("GO_SLEEP");
                console.log("🚀 [Điều Khiển] Không khớp lệnh, tắt đèn trạng thái D32.");
            }
        }

        // Cập nhật kết quả lên giao diện Web Monitor
        sendTextToWeb({
            status: "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢",
            text: resultJson.text
        });

    } catch (error) {
        console.error("❌ [Lỗi Hệ Thống] Tầng xử lý Gemini:", error);
        if (ws.readyState === 1) ws.send("GO_SLEEP");
        sendTextToWeb({ status: "HỆ THỐNG ONLINE - ĐANG QUÉT WAKE WORD 🟢", text: "Lỗi kết nối API hoặc không nhận dạng được lệnh." });
    }
}

// Hàm cấu trúc hóa mảng byte nhị phân thành file .WAV chuẩn PCM 16-bit
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

// Hàm đồng bộ phát thông tin lên trình duyệt web giám sát
function sendTextToWeb(obj) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(obj));
        }
    });
}
