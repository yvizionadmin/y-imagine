import { describe, expect, it } from "vitest";
import { audioModelsFor, providersFor } from "@/lib/ai/models";
import { demoAudioProvider, demoSpeechSeconds, DEMO_MUSIC_SECONDS } from "@/lib/ai/providers/demo-audio";
import { DEFAULT_CREDIT_RULES, jobCost, planAllows } from "@/lib/credits";
import { buildRenderArgs } from "@/lib/editor/render-plan";
import { EMPTY_TIMELINE, parseTimeline } from "@/lib/editor/timeline";

const A = "6f1c2a4e-3b5d-4c7e-9f10-2a3b4c5d6e7f";
const base = { fontsDir: "/f", output: "/tmp/x/out.mp4", subtitlesFile: null, timeline: { aspectRatio: "1:1", resolution: "720p", fit: "cover", clipVolume: 1 } as const };
const clips = [{ file: "/tmp/x/0.mp4", start: 0, end: 6, hasAudio: true }];

describe("editor sound", () => {
  it("mixes a voice-over once from its start, with or without music", () => {
    const both = buildRenderArgs({ ...base, clips, audio: { file: "/tmp/x/m.mp3", volume: 0.5, duration: 3 }, voice: { file: "/tmp/x/v.wav", volume: 1, start: 1.5 } });
    expect(both).toEqual(expect.arrayContaining(["-i", "/tmp/x/m.mp3", "-i", "/tmp/x/v.wav"]));
    const graph = both[both.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=1500:all=1,apad,atrim=0:6,volume=1[voice]");
    expect(graph).toContain("[ac][music][voice]amix=inputs=3:duration=first:normalize=0[am]");

    const voiceOnly = buildRenderArgs({ ...base, clips, audio: null, voice: { file: "/tmp/x/v.wav", volume: 0.8, start: 0 } });
    const g2 = voiceOnly[voiceOnly.indexOf("-filter_complex") + 1];
    expect(g2).toContain("[1:a]");
    expect(g2).toContain("[ac][voice]amix=inputs=2");

    // Starting after the end: left out.
    const late = buildRenderArgs({ ...base, clips, audio: null, voice: { file: "/tmp/x/v.wav", volume: 1, start: 9 } });
    expect(late).not.toContain("/tmp/x/v.wav");
    expect(late[late.indexOf("-map") + 3]).toBe("[ac]");
  });

  it("opens projects saved before voice-overs, and checks the voice track", () => {
    const old = { ...EMPTY_TIMELINE } as Record<string, unknown>;
    delete old.voice;
    expect(parseTimeline(old)?.voice).toBeNull();
    expect(parseTimeline({ ...EMPTY_TIMELINE, voice: { assetId: A, name: "v", volume: 1, start: 2 } })?.voice?.start).toBe(2);
    expect(parseTimeline({ ...EMPTY_TIMELINE, voice: { assetId: "x", name: "v", volume: 1, start: 0 } })).toBeNull();
    expect(parseTimeline({ ...EMPTY_TIMELINE, voice: { assetId: A, name: "v", volume: 2, start: 0 } })).toBeNull();
  });

  it("makes playable WAV files offline, paced like the script", async () => {
    const speech = await demoAudioProvider.speak({ text: "x".repeat(70), voice: "warm", direction: "" });
    const header = Buffer.from(speech.bytes.slice(0, 12)).toString("latin1");
    expect(header.startsWith("RIFF") && header.endsWith("WAVE")).toBe(true);
    expect(speech.mimeType).toBe("audio/wav");
    // 16-bit mono at 22,050 Hz: bytes after the header / 44,100 = seconds.
    expect((speech.bytes.length - 44) / 44_100).toBeCloseTo(demoSpeechSeconds("x".repeat(70)), 1);
    expect(demoSpeechSeconds("hi")).toBe(1);
    const music = await demoAudioProvider.compose({ prompt: "calm" });
    expect((music.bytes.length - 44) / 44_100).toBeCloseTo(DEMO_MUSIC_SECONDS, 1);
    await expect(demoAudioProvider.speak({ text: "please FAIL", voice: "deep", direction: "" })).rejects.toMatchObject({ code: "generation_failed" });
  });

  it("knows which providers and models make voice and music", () => {
    expect(providersFor("voice")).toEqual(["openai", "gemini"]);
    expect(providersFor("music")).toEqual(["gemini"]);
    expect(audioModelsFor("voice", "openai", ["gpt-5", "tts-1", "gpt-4o-mini-tts", "whisper-1"])).toEqual(["gpt-4o-mini-tts", "tts-1"]);
    expect(audioModelsFor("voice", "gemini", null)).toEqual(["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]);
    expect(audioModelsFor("music", "gemini", ["gemini-2.5-flash", "lyria-3-pro-preview", "lyria-3-clip-preview"])).toEqual(["lyria-3-clip-preview", "lyria-3-pro-preview"]);
    expect(audioModelsFor("music", "openai", null)).toEqual([]);
  });

  it("is a paid-plan tool, music priced above a voice line by default", () => {
    expect(planAllows(DEFAULT_CREDIT_RULES, "free", "voice")).toBe(false);
    expect(planAllows(DEFAULT_CREDIT_RULES, "free", "music")).toBe(false);
    expect(planAllows(DEFAULT_CREDIT_RULES, "pro", "voice")).toBe(true);
    const noMusic = { ...DEFAULT_CREDIT_RULES, planFeatures: { ...DEFAULT_CREDIT_RULES.planFeatures, pro: DEFAULT_CREDIT_RULES.planFeatures.pro.filter((f) => f !== "music") } };
    expect(planAllows(noMusic, "pro", "music")).toBe(false);
    expect(jobCost(DEFAULT_CREDIT_RULES, "voice")).toBe(1);
    expect(jobCost(DEFAULT_CREDIT_RULES, "music")).toBe(2);
  });
});
