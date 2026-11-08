import type { AiProviderId } from "./providers-info";
import type { Feature } from "./types";

// Which models can serve each tool (image tools and copy), shared by the registry and the API Keys settings.
// Model ids are matched against the list the provider returned when the key was validated, so an
// org only sees (and is only routed to) models its key can actually call.

export const IMAGE_FEATURES = ["create", "generate", "recolor", "aplus", "looks", "upscale"] as const satisfies readonly Feature[];
export type ImageFeature = (typeof IMAGE_FEATURES)[number];
export const isImageFeature = (value: unknown): value is ImageFeature => (IMAGE_FEATURES as readonly unknown[]).includes(value);

/** Providers with image editing through the AI SDK, in the order "Automatic" tries them. */
export const IMAGE_PROVIDERS = ["openai", "gemini"] as const satisfies readonly AiProviderId[];
export type ImageProviderId = (typeof IMAGE_PROVIDERS)[number];
export const isImageProvider = (value: unknown): value is ImageProviderId => (IMAGE_PROVIDERS as readonly unknown[]).includes(value);

/** Preferred image models, best first. Only models the AI SDK confirms accept input images. */
const IMAGE_MODELS: Record<ImageProviderId, { preferred: readonly string[]; pattern: RegExp }> = {
  openai: { preferred: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"], pattern: /^gpt-image-/ },
  gemini: { preferred: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gemini-2.5-flash-image"], pattern: /^gemini-.*-image/ },
};

/** Vision models for the Recolor preservation check, cheapest capable first. */
export const VISION_MODELS: Record<ImageProviderId, readonly string[]> = {
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
  gemini: ["gemini-3-flash", "gemini-2.5-flash"],
};

const rank = (preferred: readonly string[], id: string) => {
  const i = preferred.indexOf(id);
  return i === -1 ? preferred.length : i;
};

/**
 * Image models this key can use, best first. Without a model list (not reported by the provider)
 * the preferred list is assumed.
 */
export function imageModelsFor(provider: ImageProviderId, available: readonly string[] | null): string[] {
  const { preferred, pattern } = IMAGE_MODELS[provider];
  if (!available) return [...preferred];
  return available.filter((id) => pattern.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id)).sort((a, b) => rank(preferred, a) - rank(preferred, b) || a.localeCompare(b));
}

/** First of `preferred` the key can call, else the first preferred id. */
export function pickModel(preferred: readonly string[], available: readonly string[] | null) {
  return preferred.find((id) => !available || available.includes(id)) ?? preferred[0];
}

// ── Text (copy, chat) ──────────────────────────────────────────────────────────────────────────────

export const TEXT_FEATURES = ["copy", "chat"] as const satisfies readonly Feature[];
export type TextFeature = (typeof TEXT_FEATURES)[number];
export const isTextFeature = (value: unknown): value is TextFeature => (TEXT_FEATURES as readonly unknown[]).includes(value);

/** Providers that write text (all but video-only BytePlus and Kling); "Automatic" tries them in this order. */
export const TEXT_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const satisfies readonly AiProviderId[];
export type TextProviderId = (typeof TEXT_PROVIDERS)[number];
export const isTextProvider = (value: unknown): value is TextProviderId => (TEXT_PROVIDERS as readonly unknown[]).includes(value);

/**
 * Preferred writing models, balanced quality/cost first (product copy runs often). OpenRouter's key
 * endpoint lists no models, so its preferred ids are used as-is.
 */
const TEXT_MODELS: Record<TextProviderId, { preferred: readonly string[]; pattern: RegExp }> = {
  openai: { preferred: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"], pattern: /^(gpt-5(\.\d+)?(-mini|-nano)?|gpt-4\.1(-mini|-nano)?|gpt-4o(-mini)?)$/ },
  anthropic: { preferred: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-4-5", "claude-haiku-4-5"], pattern: /^claude-/ },
  gemini: { preferred: ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"], pattern: /^gemini-[\d.]+-(pro|flash)(-lite)?(-preview)?$/ },
  openrouter: { preferred: ["anthropic/claude-sonnet-4.5", "openai/gpt-5-mini", "google/gemini-2.5-flash"], pattern: /./ },
};

export function textModelsFor(provider: AiProviderId, available: readonly string[] | null): string[] {
  if (!isTextProvider(provider)) return [];
  const { preferred, pattern } = TEXT_MODELS[provider];
  if (!available) return [...preferred];
  return available.filter((id) => pattern.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id)).sort((a, b) => rank(preferred, a) - rank(preferred, b) || a.localeCompare(b));
}

// ── Video ────────────────────────────────────────────────────────────────────────────────────

export const VIDEO_FEATURES = ["video"] as const satisfies readonly Feature[];
export type VideoFeature = (typeof VIDEO_FEATURES)[number];

/** Providers with video generation, in the order "Automatic" tries them. */
export const VIDEO_PROVIDERS = ["gemini", "byteplus", "kling"] as const satisfies readonly AiProviderId[];
export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number];
export const isVideoProvider = (value: unknown): value is VideoProviderId => (VIDEO_PROVIDERS as readonly unknown[]).includes(value);
export const isVideoFeature = (value: unknown): value is VideoFeature => (VIDEO_FEATURES as readonly unknown[]).includes(value);

/**
 * Video models, best first. Google shut the Veo 3.1 previews down in the Gemini API (2026-10-22)
 * and points to Gemini Omni Flash (GA). BytePlus ModelArk serves Seedance (dated ids, newest
 * first); its key check lists no models, so the preferred id is used. Kling has no model list either. Capabilities
 * per model live in video-models.ts.
 */
const VIDEO_MODELS: Record<VideoProviderId, { preferred: readonly string[]; pattern: RegExp }> = {
  gemini: { preferred: ["gemini-omni-1.2-flash"], pattern: /^gemini-omni-[\d.]+-flash$/ },
  byteplus: { preferred: ["dreamina-seedance-2-5-260628"], pattern: /^dreamina-seedance-\d+-\d+(-fast)?-\d{6}$/ },
  kling: { preferred: ["kling-3.0"], pattern: /^kling-\d+\.\d+$/ },
};

/** Video models this key can use, best first; the preferred list when the key reports none. */
export function videoModelsFor(provider: VideoProviderId, available: readonly string[] | null): string[] {
  const { preferred, pattern } = VIDEO_MODELS[provider];
  const listed = available?.filter((id) => pattern.test(id)).sort((a, b) => rank(preferred, a) - rank(preferred, b) || b.localeCompare(a)) ?? [];
  return listed.length ? listed : [...preferred];
}

// ── Per-tool choice ──────────────────────────────────────────────────────────────────────────

/** Tools with a model picker in Settings → API Keys. */
export const MODEL_FEATURES = [...IMAGE_FEATURES, ...TEXT_FEATURES, ...VIDEO_FEATURES] as const;
export type ModelFeature = (typeof MODEL_FEATURES)[number];
export const isModelFeature = (value: unknown): value is ModelFeature => (MODEL_FEATURES as readonly unknown[]).includes(value);

/** Providers that can serve a tool, in "Automatic" order. */
export const providersFor = (feature: ModelFeature): readonly AiProviderId[] =>
  isImageFeature(feature) ? IMAGE_PROVIDERS : isVideoFeature(feature) ? VIDEO_PROVIDERS : TEXT_PROVIDERS;

/** Models of one provider that can serve a tool, best first. */
export function modelsFor(feature: ModelFeature, provider: AiProviderId, available: readonly string[] | null): string[] {
  if (isImageFeature(feature)) return isImageProvider(provider) ? imageModelsFor(provider, available) : [];
  if (isVideoFeature(feature)) return isVideoProvider(provider) ? videoModelsFor(provider, available) : [];
  return textModelsFor(provider, available);
}

export type ModelPreference = { provider: AiProviderId; model: string };
