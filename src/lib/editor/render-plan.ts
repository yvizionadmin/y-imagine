import { clipLength, exportSize, visibleSubtitles, type EditTimeline } from "./timeline";

// Turns an edit into one ffmpeg command (pure, so it is unit-tested without running ffmpeg): each clip
// is cut and scaled to the export size, the clips are joined with their sound (silence when a clip has
// none), the music / voice-over track is mixed under them, and the subtitles are burned in from an ASS
// file with the bundled fonts.

export const OUTPUT_FPS = 30;
const SAMPLE = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** A clip ready to render: its local file, the cut, and whether the file has sound. */
export type PlannedClip = { file: string; start: number; end: number; hasAudio: boolean };

export type RenderPlanInput = {
  timeline: Pick<EditTimeline, "aspectRatio" | "resolution" | "fit" | "clipVolume">;
  clips: PlannedClip[];
  /** The track and its length in seconds (from the probe), so the graph can loop it. */
  audio: { file: string; volume: number; duration: number } | null;
  /** The ASS subtitle file, or null when there are none. */
  subtitlesFile: string | null;
  fontsDir: string;
  output: string;
};

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Escapes a path for a filter argument (inside single quotes in the filter graph). */
export function filterPath(file: string) {
  return file.replace(/\\/g, "/").replace(/'/g, "'\\\\\\''").replace(/:/g, "\\:");
}

export function buildRenderArgs({ timeline, clips, audio, subtitlesFile, fontsDir, output }: RenderPlanInput) {
  if (!clips.length) throw new Error("no clips");
  const { width, height } = exportSize(timeline.aspectRatio, timeline.resolution);
  const total = clips.reduce((sum, clip) => sum + clipLength(clip), 0);
  const args: string[] = [];
  const graph: string[] = [];

  const frame =
    timeline.fit === "cover"
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;

  clips.forEach((clip, i) => {
    const length = clipLength(clip);
    // Seeking on the input is frame-accurate when re-encoding, and reads only the part that is used.
    args.push("-ss", num(clip.start), "-t", num(length), "-i", clip.file);
    graph.push(`[${i}:v]${frame},setsar=1,fps=${OUTPUT_FPS},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
    graph.push(
      clip.hasAudio
        ? `[${i}:a]${SAMPLE},volume=${num(timeline.clipVolume)},asetpts=PTS-STARTPTS,apad,atrim=0:${num(length)}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${num(length)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
    );
  });
  graph.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${clips.length}:v=1:a=1[vc][ac]`);

  let video = "vc";
  if (subtitlesFile) {
    graph.push(`[vc]subtitles=filename='${filterPath(subtitlesFile)}':fontsdir='${filterPath(fontsDir)}'[vs]`);
    video = "vs";
  }

  let sound = "ac";
  if (audio) {
    const index = clips.length;
    // Read once and looped in the graph (aloop) so a short track lasts the whole video. Not
    // `-stream_loop`: with it ffmpeg 6 can hang closing the input after the video is written.
    args.push("-i", audio.file);
    const samples = Math.ceil(Math.max(audio.duration, 0.1) * 48000) + 1;
    graph.push(`[${index}:a]${SAMPLE},aloop=loop=-1:size=${samples},asetpts=N/SR/TB,atrim=0:${num(total)},volume=${num(audio.volume)}[music]`);
    graph.push(`[ac][music]amix=inputs=2:duration=first:normalize=0[am]`);
    sound = "am";
  }

  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    `[${video}]`,
    "-map",
    `[${sound}]`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(OUTPUT_FPS),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    num(total),
    "-y",
    output,
  );
  return args;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** h:mm:ss.cc, the ASS time format. */
export function assTime(seconds: number) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Subtitle text as plain ASS text: no override tags, line breaks kept. */
export function assText(text: string) {
  return text
    .replace(/[\\{}]/g, "")
    .replace(/\r?\n/g, "\\N")
    .trim();
}

/**
 * The ASS file for the timeline's subtitles, sized to the export: white bold text with a dark outline,
 * near the bottom. Lines with Arabic use Noto Sans Arabic (libass here shapes with presentation forms,
 * which that font has); the rest Noto Sans. Null when there are no subtitles to show.
 */
export function buildAss(timeline: Pick<EditTimeline, "aspectRatio" | "resolution" | "subtitles"> & { clips: { start: number; end: number }[] }) {
  const subtitles = visibleSubtitles(timeline);
  if (!subtitles.length) return null;
  const { width, height } = exportSize(timeline.aspectRatio, timeline.resolution);
  const size = Math.round(Math.min(width, height) * 0.065);
  const outline = Math.max(2, Math.round(size / 14));
  const marginV = Math.round(height * 0.08);
  const marginH = Math.round(width * 0.06);
  const style = (name: string, font: string) =>
    `Style: ${name},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${marginH},${marginH},${marginV},1`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Default", "Noto Sans"),
    style("Arabic", "Noto Sans Arabic"),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...subtitles
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},${ARABIC.test(s.text) ? "Arabic" : "Default"},,0,0,0,,${assText(s.text)}`),
    "",
  ].join("\n");
}
