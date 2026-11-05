export const aspectRatios = [
  { key: "1:1", w: 16, h: 16 },
  { key: "4:3", w: 18, h: 14 },
  { key: "3:4", w: 14, h: 18 },
  { key: "16:9", w: 22, h: 12 },
  { key: "9:16", w: 12, h: 22 },
] as const;

export type AspectRatio = (typeof aspectRatios)[number]["key"];
export type Resolution = "HD" | "2K";

export const isAspectRatio = (value: string): value is AspectRatio =>
  aspectRatios.some((r) => r.key === value);
export const isResolution = (value: string): value is Resolution => value === "HD" || value === "2K";

/** Product photos for Generate / Recolor: a transparent PNG cuts out best, but a JPG or WebP on a plain background works too. */
export const PRODUCT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
