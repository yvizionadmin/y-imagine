import type { CameraMove, LensPreset, LightingPreset, MotionLevel, VideoRequest } from "./types";

// Camera, motion, lens and lighting are creative direction written into the prompt, as the video
// models have no native parameters for them. The exception is a camera move in a model's
// `nativeCamera`: its adapter sets that itself. The Studio labels which is which.

const CAMERA: Record<CameraMove, string> = {
  static: "Locked-off static camera.",
  pushIn: "Slow, smooth push-in toward the subject.",
  pullOut: "Slow, smooth pull-out revealing more of the scene.",
  pan: "Smooth horizontal pan across the scene.",
  tilt: "Smooth vertical tilt.",
  orbit: "Slow orbit around the subject.",
  tracking: "Tracking shot following the subject's movement.",
  handheld: "Subtle handheld camera with natural shake.",
};

const MOTION: Record<MotionLevel, string> = {
  low: "Gentle, minimal motion.",
  medium: "Natural, moderate motion.",
  high: "Energetic, dynamic motion.",
};

const LENS: Record<Exclude<LensPreset, "auto">, string> = {
  wide: "Wide-angle lens with deep focus, showing the surroundings.",
  standard: "Standard 50mm lens with a natural perspective.",
  portrait: "85mm portrait lens with a softly blurred background.",
  macro: "Macro lens, close on fine detail and texture.",
  telephoto: "Telephoto lens with a compressed perspective and shallow depth of field.",
};

const LIGHTING: Record<Exclude<LightingPreset, "auto">, string> = {
  natural: "Soft natural daylight.",
  studio: "Clean, even studio lighting with soft shadows.",
  goldenHour: "Warm golden-hour sunlight.",
  dramatic: "Dramatic low-key lighting with deep shadows and strong contrast.",
  neon: "Colourful neon lighting with vivid reflections.",
};

export function videoPrompt(request: Pick<VideoRequest, "prompt" | "camera" | "motion" | "lens" | "lighting" | "startFrame">, options: { nativeCamera?: boolean } = {}) {
  return [
    request.startFrame ? "Animate the provided image as the first frame, keeping its subject and look." : "",
    request.prompt,
    options.nativeCamera ? "" : `Camera: ${CAMERA[request.camera]}`,
    `Motion: ${MOTION[request.motion]}`,
    request.lens === "auto" ? "" : `Lens: ${LENS[request.lens]}`,
    request.lighting === "auto" ? "" : `Lighting: ${LIGHTING[request.lighting]}`,
    "No on-screen text, captions or watermarks unless asked for.",
  ]
    .filter(Boolean)
    .join(" ");
}
