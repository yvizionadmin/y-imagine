import type { CameraMove, MotionLevel, VideoRequest } from "./types";

// Camera and motion are creative direction written into the prompt; the video models have no
// native parameters for them. The Studio labels these controls "added to the prompt".

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

export function videoPrompt(request: Pick<VideoRequest, "prompt" | "camera" | "motion" | "startFrame">) {
  return [
    request.startFrame ? "Animate the provided image as the first frame, keeping its subject and look." : "",
    request.prompt,
    `Camera: ${CAMERA[request.camera]}`,
    `Motion: ${MOTION[request.motion]}`,
    "No on-screen text, captions or watermarks unless asked for.",
  ]
    .filter(Boolean)
    .join(" ");
}
