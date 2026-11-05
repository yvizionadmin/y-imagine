// Shared by the Resize screen and the /api/resize route handler.

export const RESIZE_PLATFORMS = {
  amazon: [
    { key: "amazonMain", width: 1000, height: 1000 },
    { key: "amazonZoom", width: 2000, height: 2000 },
  ],
  shopify: [
    { key: "shopifyProduct", width: 2048, height: 2048 },
    { key: "shopifyCollection", width: 1024, height: 1024 },
  ],
  instagram: [
    { key: "instagramSquare", width: 1080, height: 1080 },
    { key: "instagramPortrait", width: 1080, height: 1350 },
    { key: "instagramStory", width: 1080, height: 1920 },
  ],
  custom: [],
} as const satisfies Record<string, readonly { key: string; width: number; height: number }[]>;

export type ResizePlatform = keyof typeof RESIZE_PLATFORMS;
export type ResizeSizeKey = (typeof RESIZE_PLATFORMS)[Exclude<ResizePlatform, "custom">][number]["key"] | "custom";
export type ResizeSize = { key: ResizeSizeKey; width: number; height: number };

export const RESIZE_FORMATS = ["webp", "jpeg", "png", "original"] as const;
export type ResizeFormat = (typeof RESIZE_FORMATS)[number];

/** crop = cover (center crop), pad = contain on white, stretch = exact size, aspect ratio ignored. */
export const RESIZE_FITS = ["crop", "pad", "stretch"] as const;
export type ResizeFit = (typeof RESIZE_FITS)[number];

export const RESIZE_INPUT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const RESIZE_MAX_BYTES = 25 * 1024 * 1024;
export const RESIZE_MAX_FILES = 50;
export const RESIZE_MIN_SIDE = 16;
export const RESIZE_MAX_SIDE = 8000;
export const RESIZE_QUALITY = { min: 40, max: 100, default: 85 } as const;

export const isResizeFormat = (value: string): value is ResizeFormat => (RESIZE_FORMATS as readonly string[]).includes(value);
export const isResizeFit = (value: string): value is ResizeFit => (RESIZE_FITS as readonly string[]).includes(value);
export const isResizeSide = (value: number) => Number.isInteger(value) && value >= RESIZE_MIN_SIDE && value <= RESIZE_MAX_SIDE;
