// Everything recorded or uploaded is converted in the browser to
// 16 kHz, mono, 16-bit PCM WAV (max 30 s) before it is sent for transcription.

export const TARGET_RATE = 16000;
export const MAX_SECONDS = 30;
export const RECORD_LIMIT_SECONDS = 28;

type AudioCtxCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtxCtor {
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("This browser cannot process audio. Please try a recent Chrome, Edge or Firefox.");
  return Ctor;
}

function encodeWav16(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

export interface WavResult {
  wav: Blob;
  seconds: number;
  truncated: boolean;
}

/** Decode any browser-supported audio and return 16 kHz mono 16-bit PCM WAV, at most 30 s. */
export async function toWav16kMono(input: Blob): Promise<WavResult> {
  const Ctor = getAudioContextCtor();
  const bytes = await input.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("That recording was empty. Please try again.");

  const ctx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error("We could not read that audio. Please try a WAV or MP3 clip, or record again.");
  } finally {
    void ctx.close().catch(() => undefined);
  }

  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const frames = Math.max(1, Math.floor(seconds * TARGET_RATE));
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Offline) throw new Error("This browser cannot convert audio. Please try a recent Chrome, Edge or Firefox.");

  // One output channel: the browser down-mixes stereo to mono and resamples to 16 kHz.
  const offline = new Offline(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  return {
    wav: encodeWav16(samples, TARGET_RATE),
    seconds,
    truncated: decoded.duration > MAX_SECONDS,
  };
}

export interface Recording {
  stop: () => void;
  /** Resolves with the raw recorded blob once recording has stopped. */
  done: Promise<Blob>;
}

/** Start microphone recording. Auto-stops after `limitSeconds`. */
export async function startRecording(limitSeconds: number = RECORD_LIMIT_SECONDS): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Recording is not supported in this browser. You can upload a clip instead.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("We could not use the microphone. Please allow microphone access, or upload a clip instead.");
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  let timer: number | undefined;

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      reject(new Error("Recording stopped unexpectedly. Please try again."));
    };
    recorder.onstop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });

  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  recorder.start();
  timer = window.setTimeout(stop, limitSeconds * 1000);
  return { stop, done };
}
