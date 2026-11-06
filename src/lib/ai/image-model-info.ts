import type { ImageProviderId } from "./models";

// Display names and a one-line blurb key (Shell.aiImage.blurbs.*) for image model ids, used by the
// rail's AI Image menu. Ids not listed here (new ones a key reports) fall back to a tidied id.

export const IMAGE_MODEL_BLURBS = ["detail", "everyday", "draft", "closeToPrompt", "contextRich", "fast"] as const;
export type ImageModelBlurb = (typeof IMAGE_MODEL_BLURBS)[number];

const INFO: Record<string, { name: string; blurb: ImageModelBlurb }> = {
  "gpt-image-2": { name: "GPT Image 2", blurb: "detail" },
  "gpt-image-1.5": { name: "GPT Image 1.5", blurb: "everyday" },
  "gpt-image-1": { name: "GPT Image 1", blurb: "everyday" },
  "gpt-image-1-mini": { name: "GPT Image 1 Mini", blurb: "draft" },
  "gemini-3.1-flash-image-preview": { name: "Nano Banana 2", blurb: "closeToPrompt" },
  "gemini-3-pro-image-preview": { name: "Nano Banana Pro", blurb: "contextRich" },
  "gemini-2.5-flash-image": { name: "Nano Banana", blurb: "fast" },
};

/** "gemini-3-flash-image-preview" → "Gemini 3 Flash Image Preview". */
const tidy = (id: string) => id.split("-").map((part) => (/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part)).join(" ").replace(/^Gpt /, "GPT ");

export type ImageModelEntry = { provider: ImageProviderId; model: string; name: string; blurb: ImageModelBlurb | null; inUse: boolean };

export function describeImageModel(provider: ImageProviderId, model: string, inUse = false): ImageModelEntry {
  const info = INFO[model];
  return { provider, model, name: info?.name ?? tidy(model), blurb: info?.blurb ?? null, inUse };
}
