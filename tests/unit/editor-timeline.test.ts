import { describe, expect, it } from "vitest";
import { parseProbe } from "@/lib/editor/ffmpeg";
import { assText, assTime, buildAss, buildRenderArgs, filterPath } from "@/lib/editor/render-plan";
import {
  canonicalAudioType,
  clipOffsets,
  EMPTY_TIMELINE,
  exportSize,
  MAX_CLIPS,
  parseTimeline,
  timelineDuration,
  visibleSubtitles,
  type EditTimeline,
} from "@/lib/editor/timeline";

const A = "6f1c2a4e-3b5d-4c7e-9f10-2a3b4c5d6e7f";
const B = "7a2d3b5f-4c6e-4d8f-8a21-3b4c5d6e7f80";
const clip = (assetId: string, start: number, end: number, id = `${assetId}-${start}`) => ({ id, assetId, name: "", start, end });
const timeline = (patch: Partial<EditTimeline> = {}): EditTimeline => ({ ...EMPTY_TIMELINE, clips: [clip(A, 1, 3.5), clip(B, 0.5, 3)], ...patch });

describe("editor timeline", () => {
  it("accepts a valid edit and drops unknown fields", () => {
    const parsed = parseTimeline({ ...timeline(), extra: "x", subtitles: [{ id: "s", start: 0, end: 2, text: " Hello " }] });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("extra");
    expect(parsed?.subtitles[0].text).toBe("Hello");
  });

  it("refuses edits outside the limits", () => {
    expect(parseTimeline({ ...timeline(), aspectRatio: "4:5" })).toBeNull();
    expect(parseTimeline({ ...timeline(), clips: [clip(A, 2, 2.2)] })).toBeNull();
    expect(parseTimeline({ ...timeline(), clips: Array.from({ length: MAX_CLIPS + 1 }, (_, i) => clip(A, 0, 1, String(i))) })).toBeNull();
    // Longer than 3 minutes in total.
    expect(parseTimeline({ ...timeline(), clips: [clip(A, 0, 100), clip(B, 0, 100)] })).toBeNull();
    expect(parseTimeline({ ...timeline(), subtitles: [{ id: "s", start: 2, end: 1, text: "x" }] })).toBeNull();
    expect(parseTimeline({ ...timeline(), subtitles: [{ id: "s", start: 0, end: 1, text: "  " }] })).toBeNull();
    expect(parseTimeline({ ...timeline(), clips: [clip("../../etc/passwd", 0, 2)] })).toBeNull();
    expect(parseTimeline({ ...timeline(), clipVolume: 2 })).toBeNull();
    expect(parseTimeline("nope")).toBeNull();
  });

  it("measures the video and places clips and subtitles on it", () => {
    const t = timeline({ subtitles: [{ id: "a", start: 0, end: 2, text: "a" }, { id: "b", start: 4, end: 9, text: "b" }, { id: "c", start: 6, end: 7, text: "c" }] });
    expect(timelineDuration(t)).toBe(5);
    expect(clipOffsets(t.clips)).toEqual([0, 2.5]);
    expect(visibleSubtitles(t).map((s) => [s.id, s.end])).toEqual([
      ["a", 2],
      ["b", 5],
    ]);
  });

  it("sizes each export", () => {
    expect(exportSize("9:16", "720p")).toEqual({ width: 720, height: 1280 });
    expect(exportSize("16:9", "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(exportSize("1:1", "720p")).toEqual({ width: 720, height: 720 });
  });

  it("names audio types the way they are stored", () => {
    expect(canonicalAudioType("audio/x-m4a")).toBe("audio/mp4");
    expect(canonicalAudioType("audio/x-wav")).toBe("audio/wav");
    expect(canonicalAudioType("audio/mp3")).toBe("audio/mpeg");
    expect(canonicalAudioType("audio/mpeg")).toBe("audio/mpeg");
  });
});

describe("render plan", () => {
  const base = { fontsDir: "/app/assets/fonts", output: "/tmp/x/export.mp4", subtitlesFile: null, audio: null };

  it("cuts, frames and joins the clips with their sound, or silence", () => {
    const args = buildRenderArgs({
      ...base,
      timeline: { aspectRatio: "9:16", resolution: "720p", fit: "cover", clipVolume: 0.5 },
      clips: [
        { file: "/tmp/x/0.webm", start: 1, end: 3.5, hasAudio: false },
        { file: "/tmp/x/1.mp4", start: 0.5, end: 3, hasAudio: true },
      ],
    });
    expect(args.slice(0, 12)).toEqual(["-ss", "1", "-t", "2.5", "-i", "/tmp/x/0.webm", "-ss", "0.5", "-t", "2.5", "-i", "/tmp/x/1.mp4"].slice(0, 12));
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=0:2.5");
    expect(graph).toContain("[1:a]aresample=48000");
    expect(graph).toContain("volume=0.5");
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]");
    expect(args).toEqual(expect.arrayContaining(["-map", "[vc]", "[ac]", "libx264", "+faststart"]));
    expect(args.slice(-4)).toEqual(["-t", "5", "-y", "/tmp/x/export.mp4"]);
  });

  it("pads to fit, burns subtitles and mixes a track looped in the graph", () => {
    const args = buildRenderArgs({
      ...base,
      timeline: { aspectRatio: "16:9", resolution: "1080p", fit: "contain", clipVolume: 1 },
      clips: [{ file: "/tmp/x/0.mp4", start: 0, end: 4, hasAudio: true }],
      audio: { file: "/tmp/x/1.mp3", volume: 0.4, duration: 2 },
      subtitlesFile: "/tmp/x/subtitles.ass",
    });
    // Read once: -stream_loop can hang ffmpeg 6 after the video is written.
    expect(args).not.toContain("-stream_loop");
    expect(args).toEqual(expect.arrayContaining(["-i", "/tmp/x/1.mp3"]));
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("pad=1920:1080");
    expect(graph).toContain("[vc]subtitles=filename='/tmp/x/subtitles.ass':fontsdir='/app/assets/fonts'[vs]");
    expect(graph).toContain("[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,aloop=loop=-1:size=96001,asetpts=N/SR/TB,atrim=0:4,volume=0.4[music]");
    expect(graph).toContain("[ac][music]amix=inputs=2:duration=first:normalize=0[am]");
    expect(args).toEqual(expect.arrayContaining(["[vs]", "[am]"]));
  });

  it("refuses an edit with no clips", () => {
    expect(() => buildRenderArgs({ ...base, timeline: { aspectRatio: "1:1", resolution: "720p", fit: "cover", clipVolume: 1 }, clips: [] })).toThrow();
  });

  it("escapes paths inside the filter graph", () => {
    expect(filterPath("C:\\tmp\\a'b.ass")).toBe("C\\:/tmp/a'\\\\\\''b.ass");
  });

  it("writes ASS subtitles sized to the export, with Arabic lines in the Arabic font", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(65.456)).toBe("0:01:05.46");
    expect(assText("{\\b1}Bold\nline \\N")).toBe("b1Bold\\Nline N");

    const ass = buildAss(timeline({ subtitles: [{ id: "2", start: 3, end: 9, text: "أريكة مريحة" }, { id: "1", start: 0, end: 2, text: "Comfy sofa" }] }))!;
    expect(ass).toContain("PlayResX: 720\nPlayResY: 1280");
    expect(ass).toContain("Style: Arabic,Noto Sans Arabic,");
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toEqual(["Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Comfy sofa", "Dialogue: 0,0:00:03.00,0:00:05.00,Arabic,,0,0,0,,أريكة مريحة"]);
    expect(buildAss(timeline())).toBeNull();
  });
});

describe("ffmpeg probe", () => {
  it("reads duration and streams from ffmpeg's output", () => {
    const out = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Duration: 00:01:04.52, start: 0.000000, bitrate: 769 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 720x1280, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo`;
    expect(parseProbe(out)).toEqual({ duration: 64.52, hasVideo: true, hasAudio: true });
    expect(parseProbe("  Duration: 00:00:03.00, start\n  Stream #0:0: Audio: mp3, 44100 Hz")).toEqual({ duration: 3, hasVideo: false, hasAudio: true });
    expect(parseProbe("x.txt: Invalid data found when processing input")).toBeNull();
  });
});
