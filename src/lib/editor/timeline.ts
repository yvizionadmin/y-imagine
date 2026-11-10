import { z } from "zod";

// The video editor's project document (B10): clips cut from the org's videos, subtitles on the output
// timeline, one music / voice-over track, and the export size. Shared by the editor UI and the server
// (which re-checks it on every save and render), so the limits live here.

export const EDIT_ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;
export type EditAspectRatio = (typeof EDIT_ASPECT_RATIOS)[number];
export const EDIT_RESOLUTIONS = ["720p", "1080p"] as const;
export type EditResolution = (typeof EDIT_RESOLUTIONS)[number];
/** cover: fill the frame and crop the edges; contain: show the whole clip on black bars. */
export const EDIT_FITS = ["cover", "contain"] as const;
export type EditFit = (typeof EDIT_FITS)[number];

export const MAX_CLIPS = 12;
export const MAX_SUBTITLES = 60;
export const SUBTITLE_TEXT_MAX = 120;
/** Longest export, in seconds. */
export const MAX_EDIT_SECONDS = 180;
/** Shortest clip piece, in seconds. */
export const MIN_CLIP_SECONDS = 0.5;
export const EDIT_NAME_MAX = 80;
/** Uploads to the editor (bytes). */
export const EDITOR_CLIP_MAX_BYTES = 50 * 1024 * 1024;
export const EDITOR_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const EDITOR_CLIP_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const EDITOR_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav"] as const;

/** Browsers name some audio types differently; these are stored under the canonical type. */
export function canonicalAudioType(type: string) {
  if (type === "audio/x-m4a" || type === "audio/m4a" || type === "audio/aac") return "audio/mp4";
  if (type === "audio/x-wav" || type === "audio/wave" || type === "audio/vnd.wave") return "audio/wav";
  if (type === "audio/mp3") return "audio/mpeg";
  return type;
}

/** Output frame size: the short edge is the resolution. */
export function exportSize(aspectRatio: EditAspectRatio, resolution: EditResolution) {
  const short = resolution === "1080p" ? 1080 : 720;
  const long = Math.round((short * 16) / 9);
  if (aspectRatio === "9:16") return { width: short, height: long };
  if (aspectRatio === "16:9") return { width: long, height: short };
  return { width: short, height: short };
}

const seconds = z.number().finite().min(0).max(3600);
const id = z.string().min(1).max(64);

const clipSchema = z
  .object({ id, assetId: z.uuid(), name: z.string().max(120).default(""), start: seconds, end: seconds })
  .refine((c) => c.end - c.start >= MIN_CLIP_SECONDS - 1e-6, { message: "clip_too_short" });

const subtitleSchema = z
  .object({ id, start: seconds, end: seconds, text: z.string().trim().min(1).max(SUBTITLE_TEXT_MAX) })
  .refine((s) => s.end > s.start, { message: "subtitle_order" });

export const timelineSchema = z
  .object({
    aspectRatio: z.enum(EDIT_ASPECT_RATIOS),
    resolution: z.enum(EDIT_RESOLUTIONS),
    fit: z.enum(EDIT_FITS),
    clips: z.array(clipSchema).max(MAX_CLIPS),
    subtitles: z.array(subtitleSchema).max(MAX_SUBTITLES),
    /** Music or a voice-over, from the start of the video; looped when shorter, cut when longer. */
    audio: z.object({ assetId: z.uuid(), name: z.string().max(120).default(""), volume: z.number().min(0).max(1) }).nullable(),
    /** Volume of the clips' own sound (0 mutes it). */
    clipVolume: z.number().min(0).max(1),
  })
  .refine((t) => timelineDuration(t) <= MAX_EDIT_SECONDS + 1e-6, { message: "too_long" });

export type EditTimeline = z.infer<typeof timelineSchema>;
export type EditClip = EditTimeline["clips"][number];
export type EditSubtitle = EditTimeline["subtitles"][number];

export const EMPTY_TIMELINE: EditTimeline = { aspectRatio: "9:16", resolution: "720p", fit: "cover", clips: [], subtitles: [], audio: null, clipVolume: 1 };

/** The timeline when valid (unknown fields dropped), else null. */
export function parseTimeline(input: unknown): EditTimeline | null {
  const result = timelineSchema.safeParse(input);
  return result.success ? result.data : null;
}

export const clipLength = (clip: { start: number; end: number }) => Math.max(0, clip.end - clip.start);

/** Length of the finished video in seconds: the clips back to back. */
export function timelineDuration(timeline: { clips: { start: number; end: number }[] }) {
  return timeline.clips.reduce((total, clip) => total + clipLength(clip), 0);
}

/** Where each clip starts on the output timeline. */
export function clipOffsets(clips: Pick<EditClip, "start" | "end">[]) {
  const offsets: number[] = [];
  let at = 0;
  for (const clip of clips) {
    offsets.push(at);
    at += clipLength(clip);
  }
  return offsets;
}

/** Subtitles inside the video, cut at its end; ones starting after it are left out. */
export function visibleSubtitles(timeline: { clips: { start: number; end: number }[]; subtitles: EditSubtitle[] }) {
  const total = timelineDuration(timeline);
  return timeline.subtitles.filter((s) => s.start < total).map((s) => ({ ...s, end: Math.min(s.end, total) }));
}
