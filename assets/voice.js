// voice.js - Live Push-to-Talk Intercom Engine
let ws = null;
let currentRoomId = null;
let currentUser = null;
let onSpeakingCallback = null;

let audioCtx = null;
let micStream = null;
let scriptNode = null;
let micSource = null;
let isTransmitting = false;

let nextPlayTime = 0;
const speakerTimeouts = new Map();

export function initVoice(serverBase, roomId, user, onSpeakingChange) {
  leaveVoice();

  currentRoomId = roomId;
  currentUser = user;
  onSpeakingCallback = onSpeakingChange;

  if (!serverBase || !roomId || !user) return;

  const wsUrl = serverBase.replace(/^http/, 'ws') + '/voice';
  try {
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join-voice',
        roomId: currentRoomId,
        userId: currentUser.id,
        name: currentUser.name
      }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'speaking' && onSpeakingCallback) {
            onSpeakingCallback(msg.userId, msg.speaking, msg.name);
          }
        } catch {}
        return;
      }

      // Binary PCM Audio packet:
      // [2 bytes: userId length (uint16)] [N bytes: userId utf8] [remaining: int16 PCM audio samples at 16000Hz]
      if (event.data instanceof ArrayBuffer) {
        handleIncomingAudio(event.data);
      }
    };

    ws.onclose = () => {
      ws = null;
    };
  } catch (err) {
    console.warn('Voice WebSocket init error:', err);
  }
}

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ sampleRate: 16000 });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function handleIncomingAudio(arrayBuffer) {
  try {
    const dataView = new DataView(arrayBuffer);
    const idLen = dataView.getUint16(0, true);
    const idBytes = new Uint8Array(arrayBuffer, 2, idLen);
    const userId = new TextDecoder().decode(idBytes);

    const pcmBytes = new Int16Array(arrayBuffer, 2 + idLen);
    if (pcmBytes.length === 0) return;

    // Trigger visual indicator that this user is speaking
    if (onSpeakingCallback) {
      onSpeakingCallback(userId, true);
      if (speakerTimeouts.has(userId)) clearTimeout(speakerTimeouts.get(userId));
      speakerTimeouts.set(userId, setTimeout(() => {
        if (onSpeakingCallback) onSpeakingCallback(userId, false);
      }, 350));
    }

    const ctx = getAudioContext();
    const float32 = new Float32Array(pcmBytes.length);
    for (let i = 0; i < pcmBytes.length; i++) {
      float32[i] = pcmBytes[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 16000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now + 0.02; // 20ms jitter buffer
    }
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
  } catch (e) {
    console.error('Error playing voice packet:', e);
  }
}

export async function startTransmitting() {
  if (isTransmitting) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    const ctx = getAudioContext();
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }

    isTransmitting = true;

    // Notify others that we started speaking
    ws.send(JSON.stringify({ type: 'speaking', speaking: true }));
    if (onSpeakingCallback && currentUser) {
      onSpeakingCallback(currentUser.id, true, currentUser.name);
    }

    micSource = ctx.createMediaStreamSource(micStream);
    // 1024 samples at 16000Hz = 64ms per packet
    scriptNode = ctx.createScriptProcessor(1024, 1, 1);

    const encoder = new TextEncoder();
    const idBytes = encoder.encode(currentUser.id);
    const headerLen = 2 + idBytes.length;

    scriptNode.onaudioprocess = (e) => {
      if (!isTransmitting || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      
      const buffer = new ArrayBuffer(headerLen + input.length * 2);
      const view = new DataView(buffer);
      view.setUint16(0, idBytes.length, true);
      new Uint8Array(buffer, 2, idBytes.length).set(idBytes);

      const pcm16 = new Int16Array(buffer, headerLen, input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      ws.send(buffer);
    };

    micSource.connect(scriptNode);
    scriptNode.connect(ctx.destination); // Required for scriptProcessor to fire in Chrome/WebView
  } catch (err) {
    isTransmitting = false;
    console.error('Microphone error:', err);
    throw err;
  }
}

export function stopTransmitting() {
  if (!isTransmitting) return;
  isTransmitting = false;

  try {
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode.onaudioprocess = null;
      scriptNode = null;
    }
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'speaking', speaking: false }));
    }
    if (onSpeakingCallback && currentUser) {
      onSpeakingCallback(currentUser.id, false, currentUser.name);
    }
  } catch (err) {
    console.warn('Stop transmitting error:', err);
  }
}

export function leaveVoice() {
  stopTransmitting();
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  currentRoomId = null;
}
