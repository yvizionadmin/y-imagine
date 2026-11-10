"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import { findCategory } from "@/lib/catalog-presets";
import { RECOLOR_SCOPES, type ImageInput, type RecolorResult, type RecolorScope, type SwatchAnalysis } from "@/lib/ai/types";
import { isAspectRatio, isResolution, PRODUCT_IMAGE_TYPES } from "@/lib/image-formats";
import { getWorkspace } from "@/lib/workspace";
import { reportError } from "@/lib/observability/report";
import { resolveProductType } from "@/lib/catalog/org-catalog";

const MAX_PRODUCT_BYTES = 10 * 1024 * 1024;
const MAX_SWATCH_BYTES = 5 * 1024 * 1024;
const HEX = /^#[0-9A-F]{6}$/i;

type Failure = { ok: false; error: ProviderErrorCode | "invalid_input" };

async function toImageInput(value: FormDataEntryValue | null, maxBytes: number, types: string[]) {
  if (!(value instanceof File) || value.size === 0 || value.size > maxBytes || !types.includes(value.type)) {
    return null;
  }
  return { bytes: new Uint8Array(await value.arrayBuffer()), mimeType: value.type, name: value.name } satisfies ImageInput;
}

const SWATCH_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function analyzeSwatch(formData: FormData): Promise<{ ok: true; analysis: SwatchAnalysis } | Failure> {
  const workspace = await getWorkspace();
  const swatch = await toImageInput(formData.get("swatch"), MAX_SWATCH_BYTES, SWATCH_TYPES);
  if (!swatch) return { ok: false, error: "invalid_input" };

  const provider = await getImageProvider(workspace, "recolor");
  try {
    return { ok: true, analysis: await provider.analyzeSwatch(swatch) };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("analyzeSwatch failed", error, { orgId: workspace.orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}

export async function recolorProduct(formData: FormData): Promise<({ ok: true } & RecolorResult) | Failure> {
  const workspace = await getWorkspace();

  const sku = String(formData.get("sku") ?? "").trim();
  const category = findCategory(String(formData.get("category") ?? ""));
  const subcategory = String(formData.get("subcategory") ?? "") || null;
  const hex = String(formData.get("hex") ?? "");
  // Older clients don't send a scope; they recoloured the main material.
  const scope = String(formData.get("scope") || "main") as RecolorScope;
  const aspectRatio = String(formData.get("aspectRatio") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  const [product, swatch] = await Promise.all([
    toImageInput(formData.get("product"), MAX_PRODUCT_BYTES, PRODUCT_IMAGE_TYPES),
    toImageInput(formData.get("swatch"), MAX_SWATCH_BYTES, SWATCH_TYPES),
  ]);

  const productType = category ? await resolveProductType(workspace.orgId, category.key, subcategory) : undefined;
  if (
    !sku ||
    sku.length > 64 ||
    !category ||
    productType === undefined ||
    !product ||
    !swatch ||
    !HEX.test(hex) ||
    !RECOLOR_SCOPES.includes(scope) ||
    !isAspectRatio(aspectRatio) ||
    !isResolution(resolution)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const provider = await getImageProvider(workspace, "recolor");
  try {
    const result = await provider.recolor({
      sku,
      category: category.key,
      subcategory: productType,
      product,
      swatch,
      hex,
      scope,
      aspectRatio,
      resolution,
      notes: String(formData.get("notes") ?? "").slice(0, 2000),
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("recolorProduct failed", error, { orgId: workspace.orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}
