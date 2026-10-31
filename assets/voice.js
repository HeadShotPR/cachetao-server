// voice.js - Live Push-to-Talk Intercom Engine
let ws = null;
let currentRoomId = null;
let currentUser = null;
let onSpeakingCallback = null;

let audioCtx = null;
let micStream = null;
let scriptNode = null;
let micSource = null;
let silentGain = null;
let isTransmitting = false;

let nextPlayTime = 0;
const speakerTimeouts = new Map();

export function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {}
}

// Auto-unlock audio on any user interaction with the screen
if (typeof window !== 'undefined') {
  ['click', 'touchstart', 'pointerdown', 'touchend'].forEach(evt => {
    window.addEventListener(evt, unlockAudio, { passive: true });
  });
}

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

function handleIncomingAudio(arrayBuffer) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const dataView = new DataView(arrayBuffer);
    const idLen = dataView.getUint16(0, true);
    const idBytes = new Uint8Array(arrayBuffer, 2, idLen);
    const userId = new TextDecoder().decode(idBytes);

    const sampleRate = dataView.getUint32(2 + idLen, true) || 44100;
    const pcmOffset = 2 + idLen + 4;
    const pcmBytes = new Int16Array(arrayBuffer, pcmOffset);
    if (pcmBytes.length === 0) return;

    // Visual indicator on table
    if (onSpeakingCallback) {
      onSpeakingCallback(userId, true);
      if (speakerTimeouts.has(userId)) clearTimeout(speakerTimeouts.get(userId));
      speakerTimeouts.set(userId, setTimeout(() => {
        if (onSpeakingCallback) onSpeakingCallback(userId, false);
      }, 400));
    }

    const float32 = new Float32Array(pcmBytes.length);
    for (let i = 0; i < pcmBytes.length; i++) {
      float32[i] = pcmBytes[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Gain node for clean amplification
    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.6; // Boost speech clarity
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTime < now || nextPlayTime > now + 0.35) {
      nextPlayTime = now + 0.025; // 25ms jitter buffer
    }
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
  } catch (e) {
    console.error('Error playing voice packet:', e);
  }
}

export async function startTransmitting() {
  if (isTransmitting) return;

  unlockAudio();
  const ctx = getAudioContext();

  try {
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

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'speaking', speaking: true }));
    }
    if (onSpeakingCallback && currentUser) {
      onSpeakingCallback(currentUser.id, true, currentUser.name);
    }

    micSource = ctx.createMediaStreamSource(micStream);
    // 2048 samples (~46ms at 44.1kHz / ~42ms at 48kHz)
    scriptNode = ctx.createScriptProcessor(2048, 1, 1);

    const encoder = new TextEncoder();
    const idBytes = encoder.encode(currentUser.id);
    const headerLen = 2 + idBytes.length + 4; // uint16 + idBytes + uint32 sampleRate

    scriptNode.onaudioprocess = (e) => {
      if (!isTransmitting || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      const buffer = new ArrayBuffer(headerLen + input.length * 2);
      const view = new DataView(buffer);
      view.setUint16(0, idBytes.length, true);
      new Uint8Array(buffer, 2, idBytes.length).set(idBytes);
      view.setUint32(2 + idBytes.length, ctx.sampleRate, true);

      const pcm16 = new Int16Array(buffer, headerLen, input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      ws.send(buffer);
    };

    // Mute mic output to own speakers to prevent feedback squeal
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    micSource.connect(scriptNode);
    scriptNode.connect(silentGain);
    silentGain.connect(ctx.destination);
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
    if (silentGain) {
      silentGain.disconnect();
      silentGain = null;
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
