"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import type { GeneratedImage } from "@/lib/ai/types";
import { getWorkspace } from "@/lib/workspace";
import { categoryPresets, CUSTOM_SCENE_MAX, findScene, findSubcategory, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { isCameraAngle } from "@/lib/camera-angles";
import { aspectRatios, PRODUCT_IMAGE_TYPES } from "@/lib/image-formats";
import { isAssetMime } from "@/lib/storage/assets";
import { reportError } from "@/lib/observability/report";

const MAX_PRODUCT_BYTES = 10 * 1024 * 1024;
const SCENE_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type GenerateResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: ProviderErrorCode | "invalid_input" };

const imageInput = async (file: File) => ({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, name: file.name });

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function generateLifestyleImage(formData: FormData): Promise<GenerateResult> {
  const workspace = await getWorkspace();

  const sku = text(formData, "sku");
  const product = formData.get("product");
  const reference = formData.get("reference");
  const category = categoryPresets.find((c) => c.key === text(formData, "category"));
  const subcategory = text(formData, "subcategory") || null;
  const scene = text(formData, "scene") || null;
  const customScene = text(formData, "customScene") || null;
  const sceneFile = formData.get("sceneImage");
  const sceneUpload = sceneFile instanceof File && sceneFile.size > 0 ? sceneFile : null;
  const style = text(formData, "style") || null;
  const productSize = text(formData, "productSize");
  const aspectRatio = text(formData, "aspectRatio");
  const resolution = text(formData, "resolution");
  const angleKey = text(formData, "angle") || "auto";
  const angle = isCameraAngle(angleKey) ? angleKey : null;
  // The first shot of a "keep scenes the same" set, sent back so this shot reuses its room.
  const matchFile = formData.get("matchShot");
  const matchShot = matchFile instanceof File && matchFile.size > 0 ? matchFile : null;

  const valid =
    sku.length > 0 &&
    sku.length <= 64 &&
    product instanceof File &&
    PRODUCT_IMAGE_TYPES.includes(product.type) &&
    product.size <= MAX_PRODUCT_BYTES &&
    category !== undefined &&
    (subcategory === null || findSubcategory(category.key, subcategory) !== null) &&
    // Any library scene is allowed, not just the category's recommendations; one scene source at most.
    (scene === null || findScene(scene) !== undefined) &&
    (customScene === null || (scene === null && customScene.length <= CUSTOM_SCENE_MAX)) &&
    (sceneUpload === null || (scene === null && customScene === null && SCENE_UPLOAD_TYPES.includes(sceneUpload.type) && sceneUpload.size <= MAX_PRODUCT_BYTES)) &&
    (style === null || category.styles.includes(style)) &&
    productSize.length <= PRODUCT_SIZE_MAX &&
    aspectRatios.some((r) => r.key === aspectRatio) &&
    (resolution === "HD" || resolution === "2K") &&
    angle !== null &&
    (matchShot === null || (SCENE_UPLOAD_TYPES.includes(matchShot.type) && matchShot.size <= MAX_PRODUCT_BYTES));
  if (!valid) return { ok: false, error: "invalid_input" };

  const provider = await getImageProvider(workspace, "generate");
  try {
    const image = await provider.generateLifestyle({
      sku,
      product: await imageInput(product),
      reference: reference instanceof File && reference.size > 0 && reference.size <= MAX_PRODUCT_BYTES && isAssetMime(reference.type) ? await imageInput(reference) : null,
      category: category.key,
      subcategory,
      scene,
      customScene,
      sceneUpload: sceneUpload ? await imageInput(sceneUpload) : null,
      style,
      productSize,
      angle,
      minimalProps: text(formData, "minimalProps") === "1",
      matchShot: matchShot ? await imageInput(matchShot) : null,
      aspectRatio,
      resolution,
      instructions: text(formData, "instructions").slice(0, 2000),
    });
    return { ok: true, image };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("generateLifestyleImage failed", error, { orgId: workspace.orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}
