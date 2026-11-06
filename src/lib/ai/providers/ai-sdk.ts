import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APICallError, generateImage, generateText, NoImageGeneratedError, Output, RetryError, type ImageModel, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import sharp from "sharp";
import { z } from "zod";
import { anglePrompt } from "@/lib/camera-angles";
import { findScene } from "@/lib/catalog-presets";
import { aplusHeroSize, aplusTitleSide, composeAplus } from "@/lib/image/compose-aplus";
import { composeLook } from "@/lib/image/compose-look";
import { measureSwatch } from "@/lib/image/swatch";
import { ProviderError } from "../errors";
import type { ImageProviderId } from "../models";
import type { AiProviderId } from "../providers-info";
import type { GeneratedImage, ImageInput, ImageProvider, PreservationCheck } from "../types";

// Real image provider over the AI SDK, built per job from the org's decrypted key (BYOK). Every tool
// is an image *edit*: the merchant's product photo goes in as an input image, so the product itself
// is preserved and only the scene, colour or lighting changes. Outputs are cropped to the requested
// aspect ratio and capped at the requested resolution (never upscaled), then returned as WebP.

export type AiProviderConfig = {
  provider: ImageProviderId;
  apiKey: string;
  imageModel: string;
  /** Vision model for the Recolor preservation check; null skips the check. */
  visionModel: string | null;
  /** Called when the provider rejects the key, so its status can turn invalid in Settings. */
  onKeyRejected?: () => Promise<void>;
};

const MAX_EDGE = { HD: 1200, "2K": 2048 } as const;
const TIMEOUT_MS = 180_000;

/** gpt-image only renders three sizes; pick the one closest to the requested shape, crop after. */
function openAiSize(ratio: number) {
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
}

const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
function geminiRatio(ratio: number) {
  const value = (r: string) => {
    const [w, h] = r.split(":").map(Number);
    return w / h;
  };
  return GEMINI_RATIOS.reduce((best, r) => (Math.abs(Math.log(value(r) / ratio)) < Math.abs(Math.log(value(best) / ratio)) ? r : best));
}

/** Share of the generated image's height left after the centre crop to `ratio` (1 = nothing cut). */
export function keptHeight(provider: string, ratio: number) {
  const [w, h] = (provider === "openai" ? openAiSize(ratio).split("x") : geminiRatio(ratio).split(":")).map(Number);
  return Math.min(1, w / h / ratio);
}

const ratioOf = (aspectRatio: string) => {
  const [w, h] = aspectRatio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
};

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
/** "furniture", or "furniture (sofas)" when the merchant picked a product type. */
const productKind = (request: { category: string; subcategory?: string | null }) =>
  request.subcategory ? `${words(request.category)} (${words(request.subcategory)})` : words(request.category);

/** Drops missing images and numbers the rest, so the prompt can name each one by position. */
function imageRoles(entries: [ImageInput | null, string][]) {
  const present = entries.filter((e): e is [ImageInput, string] => e[0] !== null);
  return {
    list: present.map(([image]) => image),
    roles: present.map(([, role], i) => `Image ${i + 1} is ${role}.`).join(" "),
    indexOf: (image: ImageInput) => present.findIndex(([i]) => i === image) + 1,
  };
}

async function publicImage(publicPath: string): Promise<ImageInput> {
  const bytes = await readFile(path.join(process.cwd(), "public", publicPath));
  return { bytes, mimeType: publicPath.endsWith(".png") ? "image/png" : "image/jpeg", name: path.basename(publicPath) };
}

/** Provider errors → stable codes (image and text providers). Raw provider messages never leave the server. */
export async function mapError(error: unknown, config: { provider: AiProviderId; onKeyRejected?: () => Promise<void> }): Promise<ProviderError> {
  if (error instanceof ProviderError) return error;
  // Retryable failures (429, 5xx) arrive wrapped once the SDK's retries are used up.
  if (RetryError.isInstance(error)) return mapError(error.lastError, config);
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    const body = error.responseBody ?? "";
    if (status === 401 || status === 403 || (config.provider === "gemini" && status === 400 && /API_KEY_INVALID|API key not valid/i.test(body))) {
      await config.onKeyRejected?.().catch(() => undefined);
      return new ProviderError("invalid_key");
    }
    if (status === 402 || /insufficient_quota|billing|credit balance|RESOURCE_EXHAUSTED.*quota/i.test(body)) return new ProviderError("no_credits");
    if (status === 429) return new ProviderError("rate_limited");
    if (status === 404) return new ProviderError("unsupported");
  }
  if (NoImageGeneratedError.isInstance(error)) return new ProviderError("generation_failed");
  return new ProviderError("generation_failed");
}

export function createAiImageProvider(config: AiProviderConfig): ImageProvider {
  const { image: imageModel, vision } = models(config);

  async function render(input: { images: ImageInput[]; prompt: string; ratio: number; resolution: keyof typeof MAX_EDGE; size?: { width: number; height: number } }) {
    try {
      const { image } = await generateImage({
        model: imageModel,
        prompt: input.images.length ? { images: input.images.map((i) => i.bytes), text: input.prompt } : input.prompt,
        ...(config.provider === "openai" ? { size: openAiSize(input.ratio) as `${number}x${number}` } : { aspectRatio: geminiRatio(input.ratio) as `${number}:${number}` }),
        providerOptions:
          config.provider === "openai"
            ? { openai: { quality: input.resolution === "2K" ? "high" : "medium" } }
            : config.imageModel.startsWith("gemini-3")
              ? { google: { imageConfig: { imageSize: input.resolution === "2K" ? "2K" : "1K" } } }
              : undefined,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        maxRetries: 1,
      });
      return finish(image.uint8Array, input.ratio, input.resolution, input.size);
    } catch (error) {
      throw await mapError(error, config);
    }
  }

  /** Crops to the exact aspect ratio, caps the long edge, encodes WebP. */
  async function finish(bytes: Uint8Array, ratio: number, resolution: keyof typeof MAX_EDGE, size?: { width: number; height: number }): Promise<GeneratedImage> {
    const meta = await sharp(bytes).metadata();
    const srcW = meta.width ?? 1024;
    const srcH = meta.height ?? 1024;
    let width = srcW;
    let height = Math.round(srcW / ratio);
    if (height > srcH) [width, height] = [Math.round(srcH * ratio), srcH];
    const scale = Math.min(1, MAX_EDGE[resolution] / Math.max(width, height));
    const target = size ?? { width: Math.round(width * scale), height: Math.round(height * scale) };
    const data = await sharp(bytes).resize(target.width, target.height, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
    return { url: `data:image/webp;base64,${data.toString("base64")}`, ...target, provider: config.provider, model: config.imageModel };
  }

  /** Asks a vision model which product details survived the recolor. Empty when it can't tell. */
  async function checkPreservation(before: ImageInput, after: string): Promise<PreservationCheck[]> {
    if (!vision) return [];
    try {
      const { output } = await generateText({
        model: vision,
        output: Output.object({
          schema: z.object({ shape: z.boolean(), stitching: z.boolean(), lighting: z.boolean(), texture: z.boolean() }),
        }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Image 1 is a product photo, image 2 is the same product recoloured. Ignoring the colour change, answer true for each " +
                  "property that is preserved in image 2: shape (silhouette and proportions), stitching (seams, stitching and small " +
                  "construction details), lighting (light direction, highlights and shadows), texture (material surface texture).",
              },
              { type: "file", data: before.bytes, mediaType: before.mimeType },
              { type: "file", data: Buffer.from(after.split(",")[1], "base64"), mediaType: "image/webp" },
            ],
          },
        ],
        abortSignal: AbortSignal.timeout(60_000),
        maxRetries: 1,
      });
      return (["shape", "stitching", "lighting", "texture"] as const).filter((k) => output[k]);
    } catch {
      return [];
    }
  }

  return {
    id: config.provider,

    async createImage(request) {
      // The user's own prompt, as written; references (if any) guide subject and style.
      const refs = request.references.length
        ? `Use the ${request.references.length > 1 ? "reference images" : "reference image"} for subject and style. `
        : "";
      return render({
        images: request.references,
        prompt: `${refs}${request.prompt}`,
        ratio: ratioOf(request.aspectRatio),
        resolution: request.resolution,
      });
    },

    async generateLifestyle(request) {
      // A later shot of a set reuses the first shot's room, so the scene sources aren't sent again.
      const matchShot = request.matchShot ?? null;
      const scene = request.scene && !matchShot ? findScene(request.scene) : undefined;
      const sceneImage = scene ? await publicImage(scene.image) : null;
      const sceneUpload = matchShot ? null : request.sceneUpload;
      const images = imageRoles([
        [request.product, "the product photo"],
        [request.reference, "a composition reference (match its framing and mood, not its objects)"],
        [sceneUpload, "the background photo"],
        [sceneImage, "the scene reference"],
        [matchShot, "an earlier photo from the same shoot"],
      ]);
      const prompt = [
        images.roles,
        `Create a photorealistic e-commerce lifestyle photo of the ${productKind(request)} product from image 1.`,
        request.subcategory ? `Style the scene the way ${words(request.subcategory)} are usually shown.` : "",
        "Keep the product exactly as it is: same shape, proportions, colours, materials, logos and details. Do not add, remove or redesign any part of it.",
        matchShot
          ? `Photograph it in the exact same room as image ${images.indexOf(matchShot)}: same layout, furniture, props, materials, colours and lighting, with the product in the same place, ${anglePrompt(request.angle) ? "seen from the camera angle below" : "seen from a new camera angle"}.`
          : sceneUpload
          ? `Place it into the background photo, image ${images.indexOf(sceneUpload)}: keep that room, its layout, furniture, colours and light exactly as they are, and put the product where it would naturally stand.`
          : request.customScene
          ? `Place it in this setting: ${request.customScene}.`
          : request.scene
            ? `Place it in a ${words(request.scene)} setting${sceneImage ? ` like the scene in image ${images.indexOf(sceneImage)}` : ""}.`
            : "Choose a fitting, realistic setting for this product.",
        request.productSize
          ? `The product's real size is ${request.productSize}. Show it at true-to-life scale next to the furniture, doors and surfaces around it.`
          : "Show it at a realistic, true-to-life scale for this kind of product.",
        request.style ? `Style: ${words(request.style)}.` : "",
        anglePrompt(request.angle),
        request.minimalProps ? "Keep the scene minimal: only a few props and decor pieces, none in front of or competing with the product." : "",
        `It stands or hangs naturally (resting on the floor or a surface, with contact shadows). Natural, consistent lighting with realistic shadows and reflections; the product is the clear focal point${request.angle === "closeup" ? "" : " and fully in frame"}. No text, watermarks or logos added.`,
        request.instructions ? `Additional instructions: ${request.instructions}` : "",
      ];
      return render({
        images: images.list,
        prompt: prompt.filter(Boolean).join(" "),
        ratio: ratioOf(request.aspectRatio),
        resolution: request.resolution,
      });
    },

    analyzeSwatch: measureSwatch,

    async recolor(request) {
      const prompt = [
        "Image 1 is the product photo. Image 2 is a colour/material swatch.",
        `Recolour the ${productKind(request)} product in image 1 using the colour and material of the swatch in image 2 (target colour ${request.hex}).`,
        request.scope === "main"
          ? "Change only the main material (the upholstery, fabric, body panels or main surface). Keep legs, frame, feet, handles, buttons, zips, hardware, glass and any secondary materials in their original colours."
          : "Change every visible part of the product to the new colour/material.",
        "Keep the exact same shape, proportions, stitching, seams, hardware, background, camera angle, lighting and shadows.",
        "Keep the material's natural texture and shading so the result looks like a real photo of the product in the new colour. Match the target colour as measured in daylight, not tinted by the scene lighting.",
        request.notes ? `Additional instructions: ${request.notes}` : "",
      ];
      const image = await render({
        images: [request.product, request.swatch],
        prompt: prompt.filter(Boolean).join(" "),
        ratio: ratioOf(request.aspectRatio),
        resolution: request.resolution,
      });
      return { image, preserved: await checkPreservation(request.product, image.url) };
    },

    async generateAplus(request) {
      const scene = request.scene ? await publicImage(request.scene).catch(() => null) : null;
      const hero = aplusHeroSize(request);
      // The hero is a wide strip (about 3:1) and the models' widest output is 1.5–2.3:1, so the
      // centre crop drops the top and bottom; without this the product's legs or base get cut off.
      const kept = keptHeight(config.provider, hero.width / hero.height);
      const prompt = [
        scene ? "Image 1 is the product photo. Image 2 is the scene reference." : "Image 1 is the product photo.",
        `Create the hero photo for an Amazon A+ product page: the ${productKind(request)} product from image 1, photographed in a premium, uncluttered setting${scene ? " like the scene in image 2" : ""}.`,
        "Keep the product exactly as it is: same shape, proportions, colours, materials, legs, logos and details. Do not add, remove or redesign any part of it, and keep it fully in frame.",
        kept < 0.85
          ? `The photo will be cropped to a wide banner that keeps only the middle ${Math.round(kept * 100)}% of its height. Show the whole product, including its legs or base, inside that middle band, with plain wall above it and floor below it.`
          : "",
        request.style ? `Style: ${words(request.style)}.` : "",
        // Must match where composeAplus draws the title box (top-right for Arabic titles).
        `Keep the top-${aplusTitleSide(request)} area calm and uncluttered, with the product away from it (a title box will be placed there). Do not render any text, captions, labels or logos.`,
      ];
      const image = await render({
        images: [request.product, ...(scene ? [scene] : [])],
        prompt: prompt.filter(Boolean).join(" "),
        ratio: hero.width / hero.height,
        resolution: request.resolution,
        size: hero,
      });
      const heroBytes = Buffer.from(image.url.split(",")[1], "base64");
      return { ...(await composeAplus(request, heroBytes)), provider: config.provider, model: config.imageModel };
    },

    async generateLook(request) {
      // The merchant's arrangement is composited first, so placement and product choice are exact;
      // the model only blends it into one believable photo.
      const draft = await composeLook(request);
      const prompt = [
        `This is a draft scene made by pasting ${productKind(request)} product cut-outs onto a background photo. Turn it into one photorealistic lifestyle photo.`,
        "Keep every product exactly where it is, at the same size, with the same shape, colours and details. Do not add, remove, move or replace products.",
        "Fix lighting so it matches the scene, add realistic contact shadows and reflections, and blend edges naturally.",
        request.style ? `Style: ${words(request.style)}.` : "",
        request.prompt ? `Mood: ${request.prompt}` : "",
      ];
      return render({
        images: [{ bytes: draft, mimeType: "image/png", name: "look-draft.png" }],
        prompt: prompt.filter(Boolean).join(" "),
        ratio: request.width / request.height,
        resolution: "2K",
        size: { width: request.width, height: request.height },
      });
    },
  };
}

function models(config: AiProviderConfig): { image: ImageModel; vision: LanguageModel | null } {
  if (config.provider === "openai") {
    const openai = createOpenAI({ apiKey: config.apiKey });
    return { image: openai.image(config.imageModel), vision: config.visionModel ? openai(config.visionModel) : null };
  }
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  return { image: google.image(config.imageModel), vision: config.visionModel ? google(config.visionModel) : null };
}
