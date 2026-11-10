"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import type { AplusFeature, AplusRequest, GeneratedImage, ImageInput } from "@/lib/ai/types";
import { findCategory } from "@/lib/catalog-presets";
import { fetchRemoteImage } from "@/lib/fetch-image";
import { isAspectRatio, isResolution } from "@/lib/image-formats";
import { getWorkspace } from "@/lib/workspace";
import { FEATURE_RANGE, layoutPresets, TEXT_LIMITS } from "./config";
import { reportError } from "@/lib/observability/report";
import { resolveProductType } from "@/lib/catalog/org-catalog";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg"];

export type AplusResult = { ok: true; image: GeneratedImage } | { ok: false; error: ProviderErrorCode | "invalid_input" | "invalid_url" };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

async function fileInput(value: FormDataEntryValue | null): Promise<ImageInput | null> {
  if (!(value instanceof File) || value.size === 0 || value.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.includes(value.type)) {
    return null;
  }
  return { bytes: new Uint8Array(await value.arrayBuffer()), mimeType: value.type, name: value.name };
}

function parseFeatures(raw: string): AplusFeature[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < FEATURE_RANGE.min || parsed.length > FEATURE_RANGE.max) return null;
    const features = parsed.map((f) => ({
      title: typeof f?.title === "string" ? f.title.trim() : "",
      description: typeof f?.description === "string" ? f.description.trim() : "",
    }));
    const valid = features.every(
      (f) =>
        f.title &&
        f.title.length <= TEXT_LIMITS.featureTitle &&
        f.description &&
        f.description.length <= TEXT_LIMITS.featureDescription,
    );
    return valid ? features : null;
  } catch {
    return null;
  }
}

export async function generateAplusImage(formData: FormData): Promise<AplusResult> {
  const workspace = await getWorkspace();

  const sku = text(formData, "sku");
  const title = text(formData, "title");
  const subtitle = text(formData, "subtitle");
  const features = parseFeatures(text(formData, "features"));
  const category = findCategory(text(formData, "category"));
  const subcategory = text(formData, "subcategory") || null;
  const sceneKey = text(formData, "scene");
  const style = text(formData, "style") || null;
  const aspectRatio = text(formData, "aspectRatio");
  const resolution = text(formData, "resolution");
  // Resolve the scene from the preset list, never from a client-supplied path.
  const scene = category?.scenes.find((s) => s.key === sceneKey)?.image ?? null;

  const productType = category ? await resolveProductType(workspace.orgId, category.key, subcategory) : undefined;
  if (
    !sku ||
    sku.length > 64 ||
    !title ||
    title.length > TEXT_LIMITS.title ||
    subtitle.length > TEXT_LIMITS.subtitle ||
    !features ||
    !category ||
    productType === undefined ||
    (sceneKey && !scene) ||
    (style !== null && !category.styles.includes(style)) ||
    !isAspectRatio(aspectRatio) ||
    !isResolution(resolution)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  let product: ImageInput | null;
  if (text(formData, "productSource") === "url") {
    product = await fetchRemoteImage(text(formData, "productUrl"), MAX_IMAGE_BYTES, IMAGE_TYPES);
    if (!product) return { ok: false, error: "invalid_url" };
  } else {
    product = await fileInput(formData.get("product"));
    if (!product) return { ok: false, error: "invalid_input" };
  }

  let reference: AplusRequest["reference"] = null;
  const referenceKind = text(formData, "referenceKind");
  if (referenceKind === "library") {
    const layout = layoutPresets.find((l) => l === text(formData, "referenceLayout"));
    if (!layout) return { ok: false, error: "invalid_input" };
    reference = { kind: "library", layout };
  } else if (referenceKind === "upload") {
    const image = await fileInput(formData.get("reference"));
    if (!image) return { ok: false, error: "invalid_input" };
    reference = { kind: "upload", image };
  }

  const provider = await getImageProvider(workspace, "aplus");
  try {
    const image = await provider.generateAplus({
      sku,
      product,
      reference,
      category: category.key,
      subcategory: productType,
      scene,
      style,
      title,
      subtitle,
      features,
      aspectRatio,
      resolution,
    });
    return { ok: true, image };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("generateAplusImage failed", error, { orgId: workspace.orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}
