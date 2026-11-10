import { z } from "zod";
import { VOICE_STYLES, type CameraMove, type VoiceStyle } from "@/lib/ai/types";
import type { VideoCapabilities } from "@/lib/ai/video-models";
import { videoCost, type CreditRules, type VideoResolution } from "@/lib/credits";
import { EDIT_ASPECT_RATIOS, type EditAspectRatio } from "@/lib/editor/timeline";

// AI Director (B11): one idea becomes a script, a storyboard image per scene, a video per scene and
// one assembled MP4 (a video editor project). Shared by the server and the Director screen.

export const DIRECTOR_IDEA_MAX = 600;
export const DIRECTOR_MIN_SCENES = 2;
export const DIRECTOR_MAX_SCENES = 6;
/** Export resolutions the Director offers (the editor's). */
export const DIRECTOR_RESOLUTIONS = ["720p", "1080p"] as const satisfies readonly VideoResolution[];
export const SCENE_VISUAL_MAX = 400;
export const SCENE_NARRATION_MAX = 200;
export const DIRECTOR_TITLE_MAX = 80;
/** Directors one org keeps; the oldest finished ones can be deleted. */
export const MAX_DIRECTORS_PER_ORG = 50;

export type DirectorSettings = {
  aspectRatio: EditAspectRatio;
  /** Length of every scene, in whole seconds (one of the video model's durations). */
  seconds: number;
  resolution: (typeof DIRECTOR_RESOLUTIONS)[number];
  scenes: number;
  /** Narration language. */
  language: "en" | "ar";
  /** Read the narration as a voice-over (one voice job), and/or show it as subtitles. */
  voiceOver: boolean;
  voice: VoiceStyle;
  subtitles: boolean;
};

export const directorSettingsSchema = z.object({
  aspectRatio: z.enum(EDIT_ASPECT_RATIOS),
  seconds: z.number().int().min(2).max(30),
  resolution: z.enum(DIRECTOR_RESOLUTIONS),
  scenes: z.number().int().min(DIRECTOR_MIN_SCENES).max(DIRECTOR_MAX_SCENES),
  language: z.enum(["en", "ar"]),
  voiceOver: z.boolean(),
  voice: z.enum(VOICE_STYLES),
  subtitles: z.boolean(),
});

/**
 * Where a project is: `planning` (writing the script), `storyboard` (an image per scene),
 * `filming` (a video per scene), `assembling` (voice-over and the final render), then `done`, or
 * `failed` (retry picks up where it stopped).
 */
export const DIRECTOR_STEPS = ["planning", "storyboard", "filming", "assembling", "done"] as const;
export type DirectorStatus = (typeof DIRECTOR_STEPS)[number] | "failed";
export type DirectorStep = (typeof DIRECTOR_STEPS)[number];

export type DirectorScene = {
  id: string;
  visual: string;
  narration: string;
  camera: CameraMove;
  /** Storyboard image (asset kind video-frame). */
  imageAssetId: string | null;
  imageMime: string | null;
  /** The scene's Studio video job, and its finished clip. */
  videoJobId: string | null;
  videoAssetId: string | null;
  videoMime: string | null;
  /** Why this scene's image or video failed. */
  error: string | null;
};

/** What a Director screen shows. */
export type DirectorView = {
  id: string;
  idea: string;
  title: string;
  settings: DirectorSettings;
  status: DirectorStatus;
  /** The step it failed in, so the screen can say where (and retry from there). */
  failedStep: DirectorStep | null;
  error: string | null;
  scenes: (DirectorScene & { imageUrl: string | null; videoUrl: string | null; videoStatus: "waiting" | "pending" | "running" | "ok" | "failed" })[];
  editId: string | null;
  output: { url: string; seconds: number | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type DirectorSummary = { id: string; title: string; idea: string; status: DirectorStatus; updatedAt: string };

/** Ratios, scene lengths and resolutions the org's video model and the editor both support. */
export function directorOptions(caps: VideoCapabilities) {
  return {
    aspectRatios: EDIT_ASPECT_RATIOS.filter((r) => (caps.aspectRatios as readonly string[]).includes(r)),
    durations: caps.durations.filter((d) => d >= 2 && d <= 30),
    resolutions: DIRECTOR_RESOLUTIONS.filter((r) => (caps.resolutions as readonly string[]).includes(r)),
    startFrame: caps.startFrame,
  };
}

export const DEFAULT_DIRECTOR_SETTINGS: DirectorSettings = {
  aspectRatio: "9:16",
  seconds: 4,
  resolution: "720p",
  scenes: 3,
  language: "en",
  voiceOver: true,
  voice: "warm",
  subtitles: true,
};

/** Credits a whole project uses: the script, one image and one video per scene, and the voice-over. */
export function directorEstimate(rules: CreditRules, settings: Pick<DirectorSettings, "scenes" | "seconds" | "resolution" | "voiceOver">) {
  const script = rules.featureCosts.director;
  const images = settings.scenes * rules.featureCosts.create;
  const videos = settings.scenes * videoCost(rules, { seconds: settings.seconds, resolution: settings.resolution });
  const voice = settings.voiceOver ? rules.featureCosts.voice : 0;
  return { script, images, videos, voice, total: script + images + videos + voice };
}
