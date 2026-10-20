import { demoClicks, DEMO_SECONDS, type ClickEvent } from "./motion";

function noise(i: number): number {
  let n = (i * 1103515245 + 12345) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  return ((n & 0xffff) / 0xffff) * 2 - 1;
}

/** Noise burst plus a short resonant ping. Under 40ms. AUTO sits higher. */
export function synthClick(sampleRate: number, auto: boolean): Float32Array {
  const seconds = 0.036;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(length);
  const ping = auto ? 4120 : 2740;
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const nEnv = Math.exp(-time / 0.0042);
    const pEnv = Math.exp(-time / 0.0095);
    const grit = noise(i + (auto ? 17 : 3)) * nEnv;
    const tone = Math.sin(Math.PI * 2 * ping * time) * pEnv;
    const partial = Math.sin(Math.PI * 2 * ping * 2.37 * time) * pEnv * 0.18;
    out[i] = grit * 0.62 + tone * 0.4 + partial;
  }
  return out;
}

export function mixClicks(sampleRate: number, clicks: ClickEvent[], seconds = DEMO_SECONDS): Float32Array {
  const mix = new Float32Array(Math.ceil(sampleRate * seconds));
  for (const click of clicks) {
    const start = Math.floor(click.t * sampleRate);
    const burst = synthClick(sampleRate, click.auto);
    for (let i = 0; i < burst.length; i++) {
      const j = start + i;
      if (j >= 0 && j < mix.length) mix[j] += burst[i] * 0.42;
    }
  }
  return mix;
}

export function encodeWav(samples: Float32Array, sampleRate: number): string {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let peak = 1e-4;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = Math.min(1, 0.9 / peak);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    view.setInt16(44 + i * 2, (s * 32767) | 0, true);
  }
  const bin = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bin.length; i += chunk) {
    binary += String.fromCharCode(...bin.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function demoWavBase64(sampleRate = 48000): string {
  return encodeWav(mixClicks(sampleRate, demoClicks()), sampleRate);
}

let ctx: AudioContext | null = null;

export function unlockAudio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playClick(auto: boolean): void {
  const audio = unlockAudio();
  const burst = synthClick(audio.sampleRate, auto);
  const buffer = audio.createBuffer(1, burst.length, audio.sampleRate);
  buffer.copyToChannel(burst, 0);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.7;
  const gain = audio.createGain();
  gain.gain.value = 0.32;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start();
}
