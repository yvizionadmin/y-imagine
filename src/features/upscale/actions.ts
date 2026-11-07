"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import { UPSCALE_SIZES, type GeneratedImage, type UpscaleSize } from "@/lib/ai/types";
import { insertGeneration, type GenerationMode } from "@/lib/generations";
import { getAsset, isAssetMime, saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { getWorkspace } from "@/lib/workspace";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ASSET_PATH = /^\/api\/assets\/([\w-]+)$/;
const SOURCE_MODES: GenerationMode[] = ["create", "lifestyle", "recolor", "aplus"];

export type UpscaleResult = { ok: true; image: GeneratedImage; id: string } | { ok: false; error: ProviderErrorCode | "invalid_input" };

/**
 * Reads the image to upscale: a stored asset of this org (`/api/assets/<id>`, a History result), a provider
 * result (data URL) or a bundled demo image. A full URL is reduced to its path; nothing remote is fetched.
 */
async function sourceImage(orgId: string, imageUrl: string) {
  let value = imageUrl;
  if (/^https?:\/\//.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  const asset = ASSET_PATH.exec(value);
  if (asset) {
    const found = await getAsset(orgId, asset[1]);
    return found && isAssetMime(found.mimeType) ? { bytes: new Uint8Array(found.bytes), mimeType: found.mimeType } : null;
  }
  return decodeImage(value);
}

/** Upscales a generated image to 2K or 4K (one job, priced in Admin → Credits) and saves it to History. */
export async function upscaleImage(input: { imageUrl: string; size: string; sku?: string; title?: string; mode?: string }): Promise<UpscaleResult> {
  const workspace = await getWorkspace();
  const size = UPSCALE_SIZES.find((s) => s === input.size) as UpscaleSize | undefined;
  const source = typeof input.imageUrl === "string" ? await sourceImage(workspace.orgId, input.imageUrl) : null;
  if (!size || !source || source.bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "invalid_input" };

  const provider = await getImageProvider(workspace, "upscale");
  let image: GeneratedImage;
  try {
    image = await provider.upscale({ image: { bytes: source.bytes, mimeType: source.mimeType, name: "source" }, size });
  } catch (error) {
    return { ok: false, error: error instanceof ProviderError ? error.code : "generation_failed" };
  }

  // Saved like every other result, so it is in History (and the feed of the tool it came from).
  const result = await decodeImage(image.url);
  if (!result) return { ok: false, error: "generation_failed" };
  const mode = SOURCE_MODES.find((m) => m === input.mode) ?? "create";
  const assetId = await saveAsset(workspace.orgId, result.bytes, result.mimeType, "generation");
  const title = String(input.title ?? "").trim().slice(0, 100);
  const saved = await insertGeneration({
    orgId: workspace.orgId,
    mode,
    sku: String(input.sku ?? "").trim().slice(0, 64),
    title: title ? `${title} · ${size}` : size,
    assetId,
    mimeType: result.mimeType,
    width: image.width,
    height: image.height,
    settings: { upscaled: size },
    provider: image.provider,
    model: image.model,
    createdBy: workspace.user.name,
  });
  return { ok: true, image: { ...image, url: `/api/assets/${assetId}` }, id: saved.id };
}
