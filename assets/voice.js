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
  if (typeof window !== 'undefined' && window.AndroidVoice) {
    try { window.AndroidVoice.setSpeakerphoneOn(true); } catch {}
  }
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
      unlockAudio();
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
      // Fixed 32-byte header:
      // [0..1] uint16: userId length
      // [2..23] utf-8 userId bytes
      // [24..27] uint32: sampleRate
      // [28..31] uint32: sampleCount
      // [32..] int16 PCM audio samples
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
    if (!arrayBuffer || arrayBuffer.byteLength <= 32) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const view = new DataView(arrayBuffer);
    const idLen = Math.min(view.getUint16(0, true), 22);
    const idBytes = new Uint8Array(arrayBuffer, 2, idLen);
    const userId = new TextDecoder().decode(idBytes);
    const sampleRate = view.getUint32(24, true) || 44100;

    // Visual indicator on table
    if (onSpeakingCallback && userId) {
      onSpeakingCallback(userId, true);
      if (speakerTimeouts.has(userId)) clearTimeout(speakerTimeouts.get(userId));
      speakerTimeouts.set(userId, setTimeout(() => {
        if (onSpeakingCallback) onSpeakingCallback(userId, false);
      }, 350));
    }

    // Slice arrayBuffer at offset 32 to guarantee zero-offset Int16Array alignment
    const pcm16 = new Int16Array(arrayBuffer.slice(32));
    if (pcm16.length === 0) return;

    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Boosted volume for clear voice
    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.8;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTime < now || nextPlayTime > now + 0.35) {
      nextPlayTime = now + 0.02; // 20ms jitter buffer
    }
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
  } catch (e) {
    console.error('Error handling incoming audio:', e);
  }
}

export async function startTransmitting() {
  if (isTransmitting) return;

  unlockAudio();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }

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
    // 2048 samples (~43-46ms per packet)
    scriptNode = ctx.createScriptProcessor(2048, 1, 1);

    const encoder = new TextEncoder();
    const idBytes = encoder.encode((currentUser?.id || '').slice(0, 22));

    scriptNode.onaudioprocess = (e) => {
      if (!isTransmitting || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      // Fixed 32-byte header + 2048 * 2 bytes PCM data (always 32-byte aligned)
      const buffer = new ArrayBuffer(32 + input.length * 2);
      const view = new DataView(buffer);
      view.setUint16(0, idBytes.length, true);
      new Uint8Array(buffer, 2, idBytes.length).set(idBytes);
      view.setUint32(24, ctx.sampleRate, true);
      view.setUint32(28, input.length, true);

      // Offset 32 is always a multiple of 2! Never throws RangeError
      const pcm16 = new Int16Array(buffer, 32, input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      ws.send(buffer);
    };

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
}
