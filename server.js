const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const genAI = new GoogleGenerativeAI("AIzaSyAaHN8Ot1-uX792aKgNxm3RD11HJALgBLs");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.get('/nghe', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Audio Fix 32bit</title></head>
    <body style="background:#0b0c10; color:#66fcf1; text-align:center;">
        <h2>🎙️ GIÁM SÁT ÂM THANH (FIXED)</h2>
        <button id="startBtn" style="padding:15px; border-radius:20px; cursor:pointer;">BẮT ĐẦU NGHE</button>
        <canvas id="visualizer" width="600" height="160" style="display:block; margin:20px auto; background:#1f2833;"></canvas>
        <script>
            let audioCtx, ws, analyser, nextStartTime = 0;
            const canvas = document.getElementById('visualizer'), canvasCtx = canvas.getContext('2d');

            document.getElementById('startBtn').onclick = () => {
                audioCtx = new (window.AudioContext)({ sampleRate: 16000 });
                analyser = audioCtx.createAnalyser();
                ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
                ws.binaryType = 'arraybuffer';
                ws.onmessage = (e) => {
                    if (e.data instanceof ArrayBuffer) {
                        // SỬA LỖI TẠI ĐÂY: Dùng Int32Array vì ESP32 gửi 32-bit
                        let data32 = new Int32Array(e.data);
                        let audioBuffer = audioCtx.createBuffer(1, data32.length, 16000);
                        let channelData = audioBuffer.getChannelData(0);
                        for (let i = 0; i < data32.length; i++) {
                            // Chuẩn hóa 32-bit về range -1.0 đến 1.0
                            channelData[i] = data32[i] / 2147483648.0;
                        }
                        let source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(analyser); analyser.connect(audioCtx.destination);
                        if (nextStartTime < audioCtx.currentTime) nextStartTime = audioCtx.currentTime + 0.05;
                        source.start(nextStartTime);
                        nextStartTime += audioBuffer.duration;
                    }
                };
                draw();
            };
            function draw() {
                requestAnimationFrame(draw);
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteTimeDomainData(dataArray);
                canvasCtx.fillStyle = '#1f2833'; canvasCtx.fillRect(0,0,600,160);
                canvasCtx.strokeStyle = '#66fcf1'; canvasCtx.beginPath();
                let x = 0, sliceWidth = 600/dataArray.length;
                for(let i=0; i<dataArray.length; i++) {
                    let v = dataArray[i]/128.0, y = v*80;
                    if(i===0) canvasCtx.moveTo(x,y); else canvasCtx.lineTo(x,y);
                    x+=sliceWidth;
                }
                canvasCtx.stroke();
            }
        </script>
    </body></html>
    `);
});

const server = app.listen(process.env.PORT || 8080);
const wss = new WebSocketServer({ server });
let audioChunks = [];

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        wss.clients.forEach(c => { if(c !== ws && c.readyState === 1) c.send(message); });

        if (Buffer.isBuffer(message)) {
            audioChunks.push(message);
            // 5 giây 32-bit: 16000 * 4 bytes * 5s = 320,000 bytes
            if (Buffer.concat(audioChunks).length >= 320000) {
                const audioBuffer = Buffer.concat(audioChunks);
                audioChunks = [];
                try {
                    const result = await model.generateContent([
                        { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/pcm;rate=16000" } },
                        "Trả về 'LED2_ON' nếu nghe lệnh bật đèn, 'LED2_OFF' nếu tắt. Khác thì trả về 'NONE'."
                    ]);
                    const cmd = result.response.text().trim();
                    if(cmd.includes("LED2")) wss.clients.forEach(c => c.send(cmd));
                } catch (e) { console.log(e); }
            }
        }
    });
});
