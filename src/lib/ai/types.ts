import type { BrandKit } from "@/lib/brand/limits";
import type { CameraAngle } from "@/lib/camera-angles";
import type { VideoResolution } from "@/lib/credits";

export type ProviderId = "demo" | "openai" | "anthropic" | "gemini" | "openrouter" | "byteplus" | "kling" | "openai-compatible";

export type Feature = "create" | "video" | "generate" | "recolor" | "aplus" | "looks" | "upscale" | "copy" | "chat";

export type LifestyleRequest = {
  sku: string;
  /** The merchant's product photo (PNG); real providers edit it into the scene. */
  product: ImageInput;
  /** Optional composition reference. */
  reference: ImageInput | null;
  category: string;
  /** Product type inside the category (e.g. "sofas"), so the prompt names the exact product; null or absent for any. */
  subcategory?: string | null;
  /** Library scene key; null when the merchant described a scene or left it to the model. */
  scene: string | null;
  /** The merchant's own scene description, used in place of a library scene. */
  customScene: string | null;
  /** The merchant's own background photo, used as the actual scene (not just a style reference). */
  sceneUpload: ImageInput | null;
  style: string | null;
  /** Real-world size as the merchant typed it (e.g. "220 × 95 × 85 cm"), so the model keeps true scale; "" when unknown. */
  productSize: string;
  /** Camera angle for this shot; null or absent (or "auto") leaves it to the model. */
  angle?: CameraAngle | null;
  /** Keep props and decor to a minimum so nothing competes with the product. */
  minimalProps?: boolean;
  /** An earlier shot of the same set: reuse its room, props and lighting from the new angle. */
  matchShot?: ImageInput | null;
  aspectRatio: string;
  resolution: "HD" | "2K";
  instructions: string;
};

export type GeneratedImage = {
  url: string;
  width: number;
  height: number;
  provider: ProviderId;
  model: string;
};

export type ImageInput = { bytes: Uint8Array; mimeType: string; name: string };

export type SwatchFinish = "matte" | "textured";
export type SwatchAnalysis = { hex: string; finish: SwatchFinish };

/** What a recolor changes: the main material only (frame, legs and hardware stay) or the whole product. */
export const RECOLOR_SCOPES = ["main", "all"] as const;
export type RecolorScope = (typeof RECOLOR_SCOPES)[number];

export type RecolorRequest = {
  sku: string;
  /** Category preset key: tells the model what it is recolouring (upholstery, garment, device…). */
  category: string;
  /** Product type inside the category (e.g. "sofas"); null or absent for any. */
  subcategory?: string | null;
  product: ImageInput;
  swatch: ImageInput;
  /** Target colour from swatch analysis, e.g. "#D8C8B5". */
  hex: string;
  scope: RecolorScope;
  aspectRatio: string;
  resolution: "HD" | "2K";
  notes: string;
};

export type PreservationCheck = "shape" | "stitching" | "lighting" | "texture";
export type RecolorResult = { image: GeneratedImage; preserved: PreservationCheck[] };

export type AplusLayout = "bento" | "gallery";
export type AplusFeature = { title: string; description: string };

export type AplusRequest = {
  sku: string;
  product: ImageInput;
  /** A layout picked from the library, or an uploaded A+ image to mimic; null lets the model design it. */
  reference: { kind: "library"; layout: AplusLayout } | { kind: "upload"; image: ImageInput } | null;
  category: string;
  /** Product type inside the category (e.g. "sofas"); null or absent for any. */
  subcategory?: string | null;
  /** Server-readable path of the chosen scene image, if any. */
  scene: string | null;
  style: string | null;
  title: string;
  subtitle: string;
  features: AplusFeature[];
  aspectRatio: string;
  resolution: "HD" | "2K";
};

export type LookRequest = {
  background: ImageInput;
  /** Products in paint order (back to front); x/y/w/h are fractions of the output size. */
  items: { image: ImageInput; x: number; y: number; w: number; h: number }[];
  width: number;
  height: number;
  prompt: string;
  style: string | null;
  /** Catalog preset key of the products (and optional product type), so the scene suits them. */
  category: string;
  subcategory?: string | null;
};

/** Studio text-to-image (home prompt). References are optional images to follow (image-to-image). */
export const CREATE_ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9", "3:2"] as const;
export type CreateAspectRatio = (typeof CREATE_ASPECT_RATIOS)[number];
export type CreateImageRequest = {
  prompt: string;
  aspectRatio: CreateAspectRatio;
  resolution: "HD" | "2K";
  references: ImageInput[];
};

// ── Video ────────────────────────────────────────────────────────────────────────────────────

export const CAMERA_MOVES = ["static", "pushIn", "pullOut", "pan", "tilt", "orbit", "tracking", "handheld"] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];
export const MOTION_LEVELS = ["low", "medium", "high"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];
/** Cinema presets. "auto" adds nothing and leaves the choice to the model. */
export const LENS_PRESETS = ["auto", "wide", "standard", "portrait", "macro", "telephoto"] as const;
export type LensPreset = (typeof LENS_PRESETS)[number];
export const LIGHTING_PRESETS = ["auto", "natural", "studio", "goldenHour", "dramatic", "neon"] as const;
export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export type VideoRequest = {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  seconds: number;
  resolution: VideoResolution;
  /** Image-to-video: the first frame. */
  startFrame: ImageInput | null;
  /** Direction written into the prompt, except what a model sets natively (`nativeCamera`). */
  camera: CameraMove;
  motion: MotionLevel;
  lens: LensPreset;
  lighting: LightingPreset;
};

export type GeneratedVideo = {
  bytes: Uint8Array;
  mimeType: "video/mp4" | "video/webm";
  provider: ProviderId;
  model: string;
};

export interface VideoProvider {
  id: ProviderId;
  model: string;
  generateVideo(request: VideoRequest): Promise<GeneratedVideo>;
}

/** Upscale targets: the long edge of the result (2K = 2048 px, 4K = 4096 px). */
export const UPSCALE_SIZES = ["2K", "4K"] as const;
export type UpscaleSize = (typeof UPSCALE_SIZES)[number];
export const UPSCALE_EDGE: Record<UpscaleSize, number> = { "2K": 2048, "4K": 4096 };
export type UpscaleRequest = { image: ImageInput; size: UpscaleSize };

export interface ImageProvider {
  id: ProviderId;
  createImage(request: CreateImageRequest): Promise<GeneratedImage>;
  generateLifestyle(request: LifestyleRequest): Promise<GeneratedImage>;
  analyzeSwatch(swatch: ImageInput): Promise<SwatchAnalysis>;
  recolor(request: RecolorRequest): Promise<RecolorResult>;
  generateAplus(request: AplusRequest): Promise<GeneratedImage>;
  generateLook(request: LookRequest): Promise<GeneratedImage>;
  /** Re-renders an image at a higher resolution with realistic fine detail, nothing else changed. */
  upscale(request: UpscaleRequest): Promise<GeneratedImage>;
}

// ── Product copy ─────────────────────────────────────────────────────────────────────────────

export const COPY_LANGUAGES = ["en", "ar"] as const;
export type CopyLanguage = (typeof COPY_LANGUAGES)[number];
export const COPY_TONES = ["professional", "friendly", "luxury", "playful"] as const;
export type CopyTone = (typeof COPY_TONES)[number];
export const COPY_LENGTHS = ["short", "medium", "long"] as const;
export type CopyLength = (typeof COPY_LENGTHS)[number];
/** Where the copy will be published; sets length limits and conventions. */
export const COPY_CHANNELS = ["website", "amazon", "noon", "social"] as const;
export type CopyChannel = (typeof COPY_CHANNELS)[number];

export type CopyRequest = {
  sku: string;
  productName: string;
  /** Category preset key. */
  category: string;
  /** Features, materials, dimensions… as the merchant typed them. */
  details: string;
  keywords: string[];
  tone: CopyTone;
  length: CopyLength;
  channel: CopyChannel;
  languages: CopyLanguage[];
  /** Product photo, so the model can describe what it sees (optional). */
  image: ImageInput | null;
  /** The org's brand kit, when the merchant chose to write in the brand voice. */
  brand?: BrandKit | null;
};

export type ProductCopy = {
  title: string;
  bullets: string[];
  description: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
};

export type CopyResult = {
  copy: Partial<Record<CopyLanguage, ProductCopy>>;
  provider: ProviderId;
  model: string;
};

// ── Prompt rewrite ("Improve with AI") ───────────────────────────────────────────────────────

/** Image tools whose free-text instructions can be rewritten. */
export const PROMPT_TOOLS = ["generate", "recolor"] as const;
export type PromptTool = (typeof PROMPT_TOOLS)[number];

export type ImprovePromptRequest = {
  tool: PromptTool;
  /** The merchant's text; empty asks for a starting instruction from the context alone. */
  text: string;
  /** Category preset key. */
  category: string;
  /** Generate: the scene in words (library scene or the merchant's own); Recolor: what is recoloured. */
  context: string | null;
  /** Language to write in when `text` is empty (otherwise the text's own language is kept). */
  language: CopyLanguage;
};

// ── Chat (assistant) ─────────────────────────────────────────────────────────────────────────

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  /** Instructions for the assistant (who it is, how to answer). */
  system: string;
  /** The conversation so far, oldest first, ending with the user's new message. */
  messages: ChatTurn[];
  /** Fires when the user stops the reply or leaves; the provider stops writing. */
  signal?: AbortSignal;
};

/** A reply as it is written: text pieces in order. Errors surface as ProviderError while iterating. */
export type ChatStream = AsyncIterable<string>;

/** A text-writing provider for one org and tool, resolved by the registry. */
export interface TextProvider {
  id: ProviderId;
  /** The model it writes with, when known (saved with chat replies). */
  model?: string;
  /** Streams one assistant reply. One job (the tool's credit cost) per reply, charged by the registry. */
  streamChat(request: ChatRequest): ChatStream;
  generateCopy(request: CopyRequest): Promise<CopyResult>;
  /** Rewrites an image tool's instructions. A helper step, like swatch analysis: not a job, no credit. */
  improvePrompt(request: ImprovePromptRequest): Promise<{ text: string; model: string }>;
}
