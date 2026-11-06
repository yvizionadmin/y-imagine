import type { VideoResolution } from "@/lib/credits";

// What each video model can do natively (Model Capability Registry). The Studio builds its video
// options from this, so a setting a model doesn't support is never offered. Camera move and motion
// are not native parameters of these models: they are added to the prompt, and the UI says so.

export type VideoAspectRatio = "16:9" | "9:16";

export type VideoCapabilities = {
  aspectRatios: readonly VideoAspectRatio[];
  /** Whole seconds the model accepts. */
  durations: readonly number[];
  resolutions: readonly VideoResolution[];
  /** Accepts an image as the first frame (image-to-video). */
  startFrame: boolean;
  /** Generates a soundtrack with the video. */
  audio: boolean;
};

/** Gemini Omni Flash: 16:9 / 9:16, 3–15 s, 360p–1080p (4K not offered), audio by default. */
const OMNI_FLASH: VideoCapabilities = {
  aspectRatios: ["16:9", "9:16"],
  durations: [4, 6, 8, 10, 15],
  resolutions: ["360p", "720p", "1080p"],
  startFrame: true,
  audio: true,
};

const CAPABILITIES: Record<string, VideoCapabilities> = {
  "gemini-omni-1.2-flash": OMNI_FLASH,
  // The offline demo provider accepts the same settings.
  "demo-video-v1": OMNI_FLASH,
};

export const DEFAULT_VIDEO_MODEL = "gemini-omni-1.2-flash";

/** A model's capabilities; a newer Omni Flash version gets the current one's until it is listed. */
export function videoCapabilities(model: string): VideoCapabilities {
  return CAPABILITIES[model] ?? OMNI_FLASH;
}

/** Whether a request fits what the model supports. */
export function fitsCapabilities(caps: VideoCapabilities, request: { aspectRatio: string; seconds: number; resolution: string; hasStartFrame: boolean }) {
  return (
    (caps.aspectRatios as readonly string[]).includes(request.aspectRatio) &&
    caps.durations.includes(request.seconds) &&
    (caps.resolutions as readonly string[]).includes(request.resolution) &&
    (!request.hasStartFrame || caps.startFrame)
  );
}
