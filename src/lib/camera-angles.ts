/**
 * Camera angles for Generate. "auto" leaves the angle to the model; every other angle is one shot
 * (one image, one credit). Directions are as seen from the product's front.
 */
export const CAMERA_ANGLES = [
  "auto",
  "front",
  "frontLeft45",
  "frontRight45",
  "left90",
  "right90",
  "rearLeft135",
  "rearRight135",
  "rear180",
  "top",
  "closeup",
  "human",
] as const;
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

export const isCameraAngle = (value: unknown): value is CameraAngle => CAMERA_ANGLES.includes(value as CameraAngle);

/** Where the camera stands around the product, in degrees on screen (0 = right, 90 = front/bottom). */
export const ANGLE_POSITIONS: Partial<Record<CameraAngle, number>> = {
  front: 90,
  frontLeft45: 135,
  frontRight45: 45,
  left90: 180,
  right90: 0,
  rearLeft135: 225,
  rearRight135: 315,
  rear180: 270,
};

export const SHOT_SETS = ["single", "gallery", "custom"] as const;
export type ShotSet = (typeof SHOT_SETS)[number];

/** A listing gallery: the hero, both three-quarter views, a detail and an in-use shot. */
export const SHOT_SET_ANGLES: Record<Exclude<ShotSet, "custom">, CameraAngle[]> = {
  single: ["auto"],
  gallery: ["front", "frontLeft45", "frontRight45", "closeup", "human"],
};

export const MAX_SHOTS = CAMERA_ANGLES.length - 1;

/** Toggles one angle: "auto" stands alone, and an empty pick falls back to it. */
export function toggleAngle(current: CameraAngle[], angle: CameraAngle): CameraAngle[] {
  if (angle === "auto") return ["auto"];
  const rest: CameraAngle[] = current.filter((a) => a !== "auto");
  const next = rest.includes(angle) ? rest.filter((a) => a !== angle) : [...rest, angle];
  return next.length > 0 ? CAMERA_ANGLES.filter((a) => next.includes(a)) : ["auto"];
}

const ANGLE_PROMPTS: Record<Exclude<CameraAngle, "auto">, string> = {
  front: "Camera angle: straight-on front view, the camera level with the product and facing its front.",
  frontLeft45: "Camera angle: three-quarter view from the front-left, the camera about 45° to the left of the product's front.",
  frontRight45: "Camera angle: three-quarter view from the front-right, the camera about 45° to the right of the product's front.",
  left90: "Camera angle: side profile from the product's left, the camera at 90° to its front.",
  right90: "Camera angle: side profile from the product's right, the camera at 90° to its front.",
  rearLeft135: "Camera angle: three-quarter rear view from the back-left, the camera about 135° from the product's front.",
  rearRight135: "Camera angle: three-quarter rear view from the back-right, the camera about 135° from the product's front.",
  rear180: "Camera angle: straight-on rear view showing the back of the product.",
  top: "Camera angle: top-down view, looking straight down at the product from above.",
  closeup: "Camera angle: close-up detail shot of the product's material, texture and craftsmanship; the product may fill and extend past the frame.",
  human:
    "Include one person naturally using or standing beside the product to show its real scale; the product stays the focal point and the person never hides or touches its key details. No recognisable real person.",
};

export const anglePrompt = (angle: CameraAngle | null | undefined) => (angle && angle !== "auto" ? ANGLE_PROMPTS[angle] : "");

/** "120 W × 80 H × 45 D cm" from the merchant's W/H/D inputs; "" when none were given. */
export function formatDimensions(dims: { w: string; h: string; d: string }): string {
  const parts = (["w", "h", "d"] as const).flatMap((k) => (dims[k].trim() ? [`${dims[k].trim()} ${k.toUpperCase()}`] : []));
  return parts.length ? `${parts.join(" × ")} cm` : "";
}
