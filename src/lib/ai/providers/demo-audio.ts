import "server-only";
import { ProviderError } from "../errors";
import type { AudioProvider, VoiceStyle } from "../types";

// Offline stand-in for voice and music models: real, playable WAV files made in code, so the editor's
// generate → add → render flow works without keys. The "voice" is soft tones paced like speech (about
// 14 characters a second); the "music" is a 12-second chord loop. "FAIL" in the text fails the job.

const RATE = 22_050;
const LATENCY_MS = 600;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 16-bit mono PCM samples (-1..1) as a WAV file. */
export function wavFile(samples: Float32Array, rate = RATE): Uint8Array {
  const data = samples.length * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data, 40);
  samples.forEach((s, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32_000), 44 + i * 2));
  return new Uint8Array(buffer);
}

const PITCH: Record<VoiceStyle, number> = { warm: 196, bright: 262, calm: 175, deep: 110 };

/** Seconds of "speech" for a script: about 14 characters a second, at least 1 s, at most 60 s. */
export const demoSpeechSeconds = (text: string) => Math.min(60, Math.max(1, Math.round((text.trim().length / 14) * 10) / 10));
export const DEMO_MUSIC_SECONDS = 12;

function speech(text: string, voice: VoiceStyle) {
  const seconds = demoSpeechSeconds(text);
  const samples = new Float32Array(Math.round(seconds * RATE));
  const base = PITCH[voice];
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const syllable = Math.floor(t / 0.18);
    const inSyllable = (t % 0.18) / 0.18;
    const envelope = Math.sin(Math.PI * inSyllable) * (syllable % 7 === 6 ? 0 : 1); // a pause now and then
    const f = base * (1 + 0.08 * Math.sin(syllable * 1.7));
    samples[i] = 0.35 * envelope * Math.sin(2 * Math.PI * f * t);
  }
  return samples;
}

const CHORDS = [
  [220, 277.18, 329.63],
  [196, 246.94, 293.66],
  [174.61, 220, 261.63],
  [196, 246.94, 329.63],
];

function music() {
  const samples = new Float32Array(DEMO_MUSIC_SECONDS * RATE);
  const bar = DEMO_MUSIC_SECONDS / CHORDS.length;
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const chord = CHORDS[Math.floor(t / bar) % CHORDS.length];
    const beat = (t % 0.5) / 0.5;
    const pulse = 0.6 + 0.4 * Math.exp(-6 * beat);
    samples[i] = (pulse * chord.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0)) / (chord.length * 3);
  }
  return samples;
}

export const demoAudioProvider: AudioProvider = {
  id: "demo",
  model: "demo-audio-v1",
  async speak(request) {
    await wait(LATENCY_MS);
    if (request.text.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    return { bytes: wavFile(speech(request.text, request.voice)), mimeType: "audio/wav", provider: "demo", model: "demo-voice-v1" };
  },
  async compose(request) {
    await wait(LATENCY_MS);
    if (request.prompt.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    return { bytes: wavFile(music()), mimeType: "audio/wav", provider: "demo", model: "demo-music-v1" };
  },
};
