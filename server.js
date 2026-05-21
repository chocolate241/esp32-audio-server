```js
// ========================== SERVER.JS ==========================
// Gemini AI Smart Home Server
// Optimized for Render + ESP32 + INMP441

const express = require('express');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Type } = require('@google/genai');

require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// =====================================================

let isProcessing = false;

const audioBuffers = new Map();

let lastCommand = "";
let lastCommandTime = 0;

// =====================================================

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// =====================================================

app.get('/dashboard', (req, res) => {

    res.send(`
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>ESP32 AI Dashboard</title>

<script src="https://cdn.tailwindcss.com"></script>

<style>

body {
    background-color: #0b0f19;
}

.log-container::-webkit-scrollbar {
    width: 4px;
}

.log-container::-webkit-scrollbar-thumb {
    background-color: #1e293b;
    border-radius: 2px;
}

</style>

</head>

<body class="text-slate-200 font-sans p-4 md:p-6">

<div class="max-w-6xl mx-auto space-y-6">

<header class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4">

<div>
<h1 class="text-2xl font-bold text-cyan-400">
🎙️ ESP32 Gemini AI Radar
</h1>

<p class="text-xs text-slate-400 mt-1">
Realtime Audio + FFT + Smart AI
</p>
</div>

<div id="connection-status"
class="mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit">

🔴 Offline

</div>

</header>

<div class="grid grid-cols-1 md:grid-cols-4 gap-4">

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
<h2 class="text-xs text-slate-400 uppercase font-semibold">
Trạng thái hệ thống
</h2>

<div id="system-state"
class="text-lg font-bold text-emerald-400 mt-1">

SẴN SÀNG

</div>
</div>

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">

<h2 class="text-xs text-slate-400 uppercase font-semibold">
Buffer Audio
</h2>

<div id="buffer-count"
class="text-2xl font-extrabold text-cyan-400 mt-1">

0

</div>

</div>

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">

<h2 class="text-xs text-slate-400 uppercase font-semibold">
Latency
</h2>

<div id="latency"
class="text-lg font-bold text-emerald-400 mt-1">

0 ms

</div>

</div>

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">

<h2 class="text-xs text-slate-400 uppercase font-semibold">
Audio Monitor
</h2>

<div class="mt-2 text-xs text-slate-400">
Realtime Waveform
</div>

</div>

</div>

<div class="grid grid-cols-1 md:grid-cols-2 gap-4">

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">

<h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">
Waveform
</h2>

<canvas id="waveform"
class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50">

</canvas>

</div>

<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">

<h2 class="text-xs font-semibold text-slate-400 uppercase mb-2">
FFT Spectrum
</h2>

<canvas id="spectrum"
class="w-full h-40 bg-slate-950 rounded-lg border border-slate-800/50">

</canvas>

</div>

</div>

<div class="grid grid-cols-1 md:grid-cols-3 gap-4">

<div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-1">

<h2 class="text-sm font-bold text-slate-100 mb-2">
🤖 Gemini AI
</h2>

<div id="ai-response"
class="bg-slate-950 border border-slate-800 p-3 rounded-lg text-slate-300 font-mono text-xs min-h-[120px] whitespace-pre-wrap">

Waiting...

</div>

</div>

<div class="bg-slate-900 border border-slate-800 rounded-xl p-4 md:col-span-2 flex flex-col h-[180px]">

<div class="flex items-center justify-between mb-2">

<h2 class="text-sm font-bold text-slate-100">
📋 Logs
</h2>

<button
onclick="document.getElementById('log-box').innerHTML=''"
class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">

Clear

</button>

</div>

<div id="log-box"
class="log-container bg-slate-950 border border-slate-800 p-3 rounded-lg font-mono text-[11px] text-slate-400 overflow-y-auto flex-1 space-y-1">

System Ready...

</div>

</div>

</div>

</div>

<script>

const logBox = document.getElementById('log-box');

const stateDiv = document.getElementById('system-state');

const bufferDiv = document.getElementById('buffer-count');

const latencyDiv = document.getElementById('latency');

const aiDiv = document.getElementById('ai-response');

const connStatus = document.getElementById('connection-status');

let audioCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 16000
});

let analyser = audioCtx.createAnalyser();

analyser.fftSize = 512;

let bufferLength = analyser.frequencyBinCount;

let dataArray = new Uint8Array(bufferLength);

const canvasWave = document.getElementById('waveform');

const ctxWave = canvasWave.getContext('2d');

const canvasSpec = document.getElementById('spectrum');

const ctxSpec = canvasSpec.getContext('2d');

function resizeCanvases() {

    canvasWave.width = canvasWave.clientWidth;
    canvasWave.height = canvasWave.clientHeight;

    canvasSpec.width = canvasSpec.clientWidth;
    canvasSpec.height = canvasSpec.clientHeight;
}

window.addEventListener('resize', resizeCanvases);

resizeCanvases();

function addLog(message, type = 'info') {

    const now = new Date();

    const timeStr = now.toTimeString().split(' ')[0];

    let color = 'text-slate-400';

    if (type === 'success')
        color = 'text-emerald-400 font-semibold';

    if (type === 'warn')
        color = 'text-amber-400';

    if (type === 'error')
        color = 'text-red-400 font-bold';

    logBox.innerHTML += '<div class="' + color + '">[' + timeStr + '] ' + message + '</div>';

    logBox.scrollTop = logBox.scrollHeight;
}

const protocol =
window.location.protocol === 'https:' ? 'wss://' : 'ws://';

const ws = new WebSocket(protocol + window.location.host);

ws.binaryType = 'arraybuffer';

let lastPacketTime = Date.now();

ws.onopen = () => {

    connStatus.className =
    "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit";

    connStatus.innerText = '🟢 Online';
};

ws.onclose = () => {

    connStatus.className =
    "mt-2 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 w-fit";

    connStatus.innerText = '🔴 Offline';
};

ws.onmessage = (event) => {

    if (typeof event.data === 'string') {

        try {

            const data = JSON.parse(event.data);

            if (data.type === 'MONITOR_UPDATE') {

                stateDiv.innerText = data.state;

                bufferDiv.innerText = data.bufferLength;

                if (data.log)
                    addLog(data.log, data.logType || 'info');

                if (data.aiResponse)
                    aiDiv.innerText = data.aiResponse;
            }

        } catch(e){}

        return;
    }

    if (event.data.byteLength > 0) {

        let now = Date.now();

        latencyDiv.innerText =
        (now - lastPacketTime) + " ms";

        lastPacketTime = now;

        let int16Array = new Int16Array(event.data);

        let float32Array = new Float32Array(int16Array.length);

        for (let i = 0; i < int16Array.length; i++) {

            float32Array[i] = int16Array[i] / 32768.0;
        }

        let audioBuffer =
        audioCtx.createBuffer(1, float32Array.length, 16000);

        audioBuffer.getChannelData(0).set(float32Array);

        let source = audioCtx.createBufferSource();

        source.buffer = audioBuffer;

        source.connect(analyser);

        source.start(audioCtx.currentTime + 0.05);
    }
};

function drawCharts() {

requestAnimationFrame(drawCharts);

analyser.getByteTimeDomainData(dataArray);

ctxWave.fillStyle = '#0b0f19';

ctxWave.fillRect(
0,
0,
canvasWave.width,
canvasWave.height
);

ctxWave.lineWidth = 2;

ctxWave.strokeStyle = '#22d3ee';

ctxWave.beginPath();

let sliceWidth =
canvasWave.width * 1.0 / bufferLength;

let x = 0;

for (let i = 0; i < bufferLength; i++) {

let v = dataArray[i] / 128.0;

let y = v * canvasWave.height / 2;

if (i === 0)
ctxWave.moveTo(x, y);

else
ctxWave.lineTo(x, y);

x += sliceWidth;
}

ctxWave.lineTo(
canvasWave.width,
canvasWave.height / 2
);

ctxWave.stroke();

analyser.getByteFrequencyData(dataArray);

ctxSpec.fillStyle = '#0b0f19';

ctxSpec.fillRect(
0,
0,
canvasSpec.width,
canvasSpec.height
);

let barWidth =
(canvasSpec.width / bufferLength) * 1.5;

let xSpec = 0;

for (let i = 0; i < bufferLength; i++) {

let barHeight = dataArray[i] / 1.5;

ctxSpec.fillStyle =
'rgb(' + (barHeight+100) + ',34,180)';

ctxSpec.fillRect(
xSpec,
canvasSpec.height - barHeight,
barWidth - 1,
barHeight
);

xSpec += barWidth;
}
}

drawCharts();

window.addEventListener('click', () => {

if(audioCtx.state === 'suspended')
audioCtx.resume();

});

</script>

</body>
</html>
`);
});

// =====================================================

const server = app.listen(PORT, () => {
    console.log("🚀 SERVER RUNNING");
});

const wss = new WebSocketServer({ server });

// =====================================================

wss.on('connection', (ws) => {

    ws.isHardware = false;

    ws.on('message', async (message, isBinary) => {

        // ================= AUDIO =================

        if (isBinary) {

            ws.isHardware = true;

            if (isProcessing) return;

            if (!audioBuffers.has(ws)) {

                audioBuffers.set(ws, []);

                console.log("🎤 RECORDING START");

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🎤 ĐANG NGHE...',
                    bufferLength: 0,
                    log: '🎙️ Voice detected...',
                    logType: 'success'
                });
            }

            let bufferList =
            audioBuffers.get(ws) || [];

            bufferList.push(Buffer.from(message));

            audioBuffers.set(ws, bufferList);

            // Realtime monitor

            wss.clients.forEach((client) => {

                if (
                    client !== ws &&
                    client.readyState === 1 &&
                    !client.isHardware
                ) {

                    client.send(message);
                }
            });

            if (bufferList.length % 5 === 0) {

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🎤 STREAMING AUDIO',
                    bufferLength: bufferList.length
                });
            }

            return;
        }

        // ================= TEXT =================

        try {

            const textMsg = message.toString();

            // END AUDIO

            if (textMsg === "END_AUDIO") {

                processCommand(ws);

                return;
            }

            // RESET

            if (textMsg === "RESET_STATE") {

                isProcessing = false;

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🟢 READY',
                    bufferLength: 0,
                    log: '🔓 Ready for next command',
                    logType: 'info'
                });
            }

        } catch(e){}
    });

    ws.on('close', () => {

        audioBuffers.delete(ws);

        console.log("❌ CLIENT DISCONNECTED");
    });
});

// =====================================================

async function processCommand(ws) {

    isProcessing = true;

    broadcastToMonitor({
        type: 'MONITOR_UPDATE',
        state: '⚡ AI PROCESSING...',
        bufferLength: 0,
        log: '🧠 Gemini analyzing...',
        logType: 'warn'
    });

    let pcmBuffers = audioBuffers.get(ws) || [];

    audioBuffers.delete(ws);

    if (pcmBuffers.length === 0) {

        isProcessing = false;

        if (ws.readyState === 1)
            ws.send("CMD_DONE");

        return;
    }

    try {

        const pcmBuffer = Buffer.concat(pcmBuffers);

        const base64Audio =
        pcmBuffer.toString('base64');

        const response =
        await ai.models.generateContent({

            model: 'gemini-3.1-flash-lite',

            contents: [

                {
                    inlineData: {
                        mimeType: 'audio/pcm;rate=16000',
                        data: base64Audio
                    }
                },

                {
                    text: `
Bạn là AI Smart Home tiếng Việt.

Nhiệm vụ:
- hiểu ý định điều khiển đèn

LIGHT ON:
- bật đèn
- mở đèn
- sáng lên
- tối quá
- cho sáng lên

LIGHT OFF:
- tắt đèn
- ngủ đi
- tối lại
- off đèn
- tắt hết

UNKNOWN:
- không rõ ý định

Trả JSON:

{
 "led": 1,
 "text": "Đã bật đèn"
}
`
                }
            ],

            config: {

                responseMimeType: "application/json",

                responseSchema: {

                    type: Type.OBJECT,

                    properties: {

                        led: {
                            type: Type.INTEGER
                        },

                        text: {
                            type: Type.STRING
                        }
                    },

                    required: ["led", "text"]
                }
            }
        });

        let cleanText =
        response.text ? response.text.trim() : null;

        const resultJson = JSON.parse(cleanText);

        // ================= CACHE =================

        const now = Date.now();

        if (
            resultJson.text === lastCommand &&
            now - lastCommandTime < 4000
        ) {

            console.log("⚠️ DUPLICATE IGNORED");

            ws.send("CMD_DONE");

            isProcessing = false;

            return;
        }

        lastCommand = resultJson.text;

        lastCommandTime = now;

        // ================= EXECUTE =================

        if (ws.readyState === 1) {

            if (resultJson.led === 1) {

                ws.send("LED2_ON");

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '💡 LED ON',
                    bufferLength: 0,
                    log: '🟢 AI bật đèn',
                    logType: 'success',
                    aiResponse: resultJson.text
                });
            }

            else if (resultJson.led === 0) {

                ws.send("LED2_OFF");

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '🌑 LED OFF',
                    bufferLength: 0,
                    log: '🔴 AI tắt đèn',
                    logType: 'success',
                    aiResponse: resultJson.text
                });
            }

            else {

                ws.send("CMD_DONE");

                broadcastToMonitor({
                    type: 'MONITOR_UPDATE',
                    state: '⚠️ UNKNOWN',
                    bufferLength: 0,
                    log: '⚠️ Không hiểu lệnh',
                    logType: 'warn',
                    aiResponse: resultJson.text
                });
            }
        }

        isProcessing = false;

    } catch (error) {

        console.log(error);

        if (ws.readyState === 1)
            ws.send("CMD_DONE");

        broadcastToMonitor({
            type: 'MONITOR_UPDATE',
            state: '❌ ERROR',
            bufferLength: 0,
            log: 'Gemini Error: ' + error.message,
            logType: 'error'
        });

        isProcessing = false;
    }
}

// =====================================================

function broadcastToMonitor(obj) {

    wss.clients.forEach((client) => {

        if (
            client.readyState === 1 &&
            !client.isHardware
        ) {

            client.send(JSON.stringify(obj));
        }
    });
}
```
