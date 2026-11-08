import type { VideoResolution } from "@/lib/credits";
import type { VideoAspectRatio } from "./types";

// What each video model can do natively (Model Capability Registry). The Studio builds its video
// options from this, so a setting a model doesn't support is never offered. Camera move and motion
// are not native parameters of these models: they are added to the prompt, and the UI says so.

export type { VideoAspectRatio };

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

/**
 * Seedance 2.5 on BytePlus ModelArk: 4–30 s, 480p–1080p, six ratios, sound on. The API takes any
 * whole second in range; the Studio offers the common lengths.
 */
const SEEDANCE_2_5: VideoCapabilities = {
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
  durations: [4, 5, 8, 10, 12, 15, 20, 30],
  resolutions: ["480p", "720p", "1080p"],
  startFrame: true,
  audio: true,
};

/** Kling 3.0: 3–15 s, three ratios, sound on. 4K exists but isn't offered, as with Omni Flash. */
const KLING_3: VideoCapabilities = {
  aspectRatios: ["16:9", "9:16", "1:1"],
  durations: [3, 5, 8, 10, 12, 15],
  resolutions: ["720p", "1080p"],
  startFrame: true,
  audio: true,
};

const CAPABILITIES: Record<string, VideoCapabilities> = {
  "gemini-omni-1.2-flash": OMNI_FLASH,
  "dreamina-seedance-2-5-260628": SEEDANCE_2_5,
  "kling-3.0": KLING_3,
  // The offline demo provider accepts the same settings as Omni Flash.
  "demo-video-v1": OMNI_FLASH,
};

export const DEFAULT_VIDEO_MODEL = "gemini-omni-1.2-flash";

/**
 * A model's capabilities. A newer version of a known family gets the current one's until it is
 * listed (Seedance ids → Seedance 2.5, Kling ids → Kling 3.0, otherwise Omni Flash).
 */
export function videoCapabilities(model: string): VideoCapabilities {
  if (CAPABILITIES[model]) return CAPABILITIES[model];
  if (model.startsWith("dreamina-seedance-")) return SEEDANCE_2_5;
  return model.startsWith("kling-") ? KLING_3 : OMNI_FLASH;
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

/** A readable name for a video model id, e.g. "dreamina-seedance-2-5-260628" → "Seedance 2.5". */
export function videoModelName(model: string): string {
  const seedance = /^dreamina-seedance-(\d+)-(\d+)(-fast)?-\d{6}$/.exec(model);
  if (seedance) return `Seedance ${seedance[1]}.${seedance[2]}${seedance[3] ? " Fast" : ""}`;
  const omni = /^gemini-omni-([\d.]+)-flash$/.exec(model);
  if (omni) return `Gemini Omni ${omni[1]} Flash`;
  const kling = /^kling-([\d.]+)$/.exec(model);
  if (kling) return `Kling ${kling[1]}`;
  if (model === "demo-video-v1") return "Demo";
  return model;
}

/** Width:height of a video ratio, e.g. "21:9" → [21, 9]. */
export function ratioParts(ratio: string): [number, number] {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? [w, h] : [16, 9];
}
