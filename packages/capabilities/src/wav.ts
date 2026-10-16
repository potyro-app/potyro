// A recording as a small WAV, for the cloud engine (speech.ts, docs/29 §3).
//
// A MediaRecorder records Opus in an Ogg or WebM box, which not every AI provider reads. 16 kHz mono
// 16-bit PCM is what speech models are trained on and what every provider takes: 32 KB a second, so
// a minute — the cloud engine's limit — is under 2 MB. Decoding and resampling use the browser's own
// audio stack (OfflineAudioContext); the encoder below is pure, so a test can hold it.

/** The rate the cloud engine sends. */
export const WAV_RATE = 16_000;

/** 16-bit PCM WAV of mono samples in [-1, 1]. Pure. */
export function encodeWav(samples: Float32Array, rate: number = WAV_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes a second
  v.setUint16(32, 2, true); // bytes a frame
  v.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

interface OfflineCtor {
  new (channels: number, length: number, rate: number): OfflineAudioContext;
}

/** A recording (any format the browser can play) as 16 kHz mono WAV. Rejects when it cannot be decoded. */
export async function recordingToWav(recording: Blob, Offline: OfflineCtor | undefined = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext): Promise<Blob> {
  if (!Offline) throw new Error("this browser cannot read audio");
  const decoded = await new Offline(1, 1, 44_100).decodeAudioData(await recording.arrayBuffer());
  const length = Math.max(1, Math.ceil(decoded.duration * WAV_RATE));
  const ctx = new Offline(1, length, WAV_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const wav = encodeWav(rendered.getChannelData(0), WAV_RATE);
  return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
}
