import "server-only";
import { ProviderError } from "@/lib/ai/errors";
import { getImageProvider, type JobActor } from "@/lib/ai/registry";
import type { GeneratedImage } from "@/lib/ai/types";
import { findCategory } from "@/lib/catalog-presets";
import { loadConnection } from "@/lib/catalog/connections";
import { importProductPng, runLookup } from "@/lib/catalog/lookup";
import { insertGeneration, type GenerationMode } from "@/lib/generations";
import { reportError } from "@/lib/observability/report";
import { readAsset, saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { claimImageItem, finishImageItem, getImageBatch, settleImageBatch, type ImageBatch, type ImageBatchItem } from "./batches";
import { TEXT_LIMITS } from "@/features/aplus/config";
import type { AplusBatchSettings, GenerateBatchSettings, RecolorBatchSettings } from "./rows";

// Runs one bulk image item, from the worker (BullMQ) or in-process when there is no Redis. Safe to
// run twice: only a `pending` item is claimed. The product photo is the SKU's first catalog image;
// each tool turns it into one image (one credit) saved to History like a single result.

export type ImageItemOutcome = "done" | "failed" | "retry" | "skipped";

type Product = { png: Uint8Array; name: string };
type Made = { image: GeneratedImage; mode: GenerationMode; title: string; settings: Record<string, string | null> };

/** The SKU's first catalog image as PNG (and its catalog name), or why there is none (an item error code). */
async function productPhoto(orgId: string, sku: string) {
  const loaded = await loadConnection(orgId);
  if (!loaded) return { ok: false as const, error: "no_connection" };
  const lookup = await runLookup(loaded.connection.type, loaded.settings, sku);
  if (!lookup.ok) return { ok: false as const, error: lookup.error === "not_found" ? "sku_not_found" : "catalog_error" };
  const url = lookup.product.images[0];
  if (!url) return { ok: false as const, error: "no_image" };
  const imported = await importProductPng(orgId, sku, url);
  if (!imported.ok) return { ok: false as const, error: imported.error === "not_found" ? "sku_not_found" : "image_unreachable" };
  return { ok: true as const, product: { png: new Uint8Array(imported.png), name: lookup.product.name } };
}

const productInput = (item: ImageBatchItem, product: Product) => ({ bytes: product.png, mimeType: "image/png", name: `${item.sku}.png` });

async function runGenerate(actor: JobActor, s: GenerateBatchSettings, item: ImageBatchItem, product: Product): Promise<Made> {
  const provider = await getImageProvider(actor, "generate");
  const image = await provider.generateLifestyle({
    sku: item.sku,
    product: productInput(item, product),
    reference: null,
    category: s.category,
    subcategory: s.subcategory ?? null,
    scene: s.scene,
    customScene: s.customScene,
    sceneUpload: null,
    style: s.style,
    productSize: item.productSize,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    instructions: s.instructions,
  });
  return {
    image,
    mode: "lifestyle",
    title: s.title,
    settings: {
      category: s.category,
      subcategory: s.subcategory ?? null,
      scene: s.scene,
      customScene: s.customScene,
      sceneUpload: null,
      style: s.style,
      productSize: item.productSize || null,
      aspectRatio: s.aspectRatio,
      resolution: s.resolution,
      instructions: s.instructions || null,
    },
  };
}

async function runRecolor(actor: JobActor, s: RecolorBatchSettings, item: ImageBatchItem, product: Product): Promise<Made> {
  const swatch = await readAsset(actor.orgId, s.swatchAssetId, s.swatchMime);
  const provider = await getImageProvider(actor, "recolor");
  const { image } = await provider.recolor({
    sku: item.sku,
    category: s.category,
    subcategory: s.subcategory,
    product: productInput(item, product),
    swatch: { bytes: new Uint8Array(swatch), mimeType: s.swatchMime, name: s.swatchName },
    hex: s.hex,
    scope: s.scope,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    notes: s.notes,
  });
  return {
    image,
    mode: "recolor",
    title: s.title,
    settings: {
      category: s.category,
      subcategory: s.subcategory,
      swatch: s.swatchName,
      hex: s.hex,
      scope: s.scope,
      aspectRatio: s.aspectRatio,
      resolution: s.resolution,
      notes: s.notes || null,
    },
  };
}

async function runAplus(actor: JobActor, s: AplusBatchSettings, item: ImageBatchItem, product: Product): Promise<Made> {
  if (!item.data) throw new ProviderError("generation_failed");
  // A row without a title uses the catalog name (A+ titles are short).
  const title = item.data.title || product.name.slice(0, TEXT_LIMITS.title).trim();
  const provider = await getImageProvider(actor, "aplus");
  const image = await provider.generateAplus({
    sku: item.sku,
    product: productInput(item, product),
    reference: s.layout ? { kind: "library", layout: s.layout } : null,
    category: s.category,
    subcategory: s.subcategory,
    // Resolved from the preset list, never from stored paths.
    scene: (s.scene && findCategory(s.category)?.scenes.find((sc) => sc.key === s.scene)?.image) || null,
    style: s.style,
    title,
    subtitle: item.data.subtitle,
    features: item.data.features,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
  });
  return {
    image,
    mode: "aplus",
    title,
    settings: {
      category: s.category,
      subcategory: s.subcategory,
      scene: s.scene,
      style: s.style,
      layout: s.layout,
      title,
      subtitle: item.data.subtitle || null,
      features: JSON.stringify(item.data.features),
      aspectRatio: s.aspectRatio,
      resolution: s.resolution,
    },
  };
}

/** Runs the batch's tool for one product and saves the image to History. */
async function makeImage(batch: ImageBatch, item: ImageBatchItem, product: Product) {
  const actor = { orgId: batch.orgId, user: { id: batch.createdById, name: batch.createdBy } };
  const made =
    batch.tool === "recolor"
      ? await runRecolor(actor, batch.settings as RecolorBatchSettings, item, product)
      : batch.tool === "aplus"
        ? await runAplus(actor, batch.settings as AplusBatchSettings, item, product)
        : await runGenerate(actor, batch.settings as GenerateBatchSettings, item, product);
  const decoded = await decodeImage(made.image.url);
  if (!decoded) throw new ProviderError("generation_failed");
  const assetId = await saveAsset(batch.orgId, decoded.bytes, decoded.mimeType, "generation");
  const generation = await insertGeneration({
    orgId: batch.orgId,
    mode: made.mode,
    sku: item.sku,
    title: made.title,
    assetId,
    mimeType: decoded.mimeType,
    width: made.image.width,
    height: made.image.height,
    settings: { ...made.settings, batchId: batch.id },
    provider: made.image.provider,
    model: made.image.model,
    createdBy: batch.createdBy,
  });
  return generation.id;
}

export async function runImageItem(orgId: string, itemId: string): Promise<ImageItemOutcome> {
  const item = await claimImageItem(orgId, itemId);
  if (!item) return "skipped";
  const batch = await getImageBatch(orgId, item.batchId);
  if (!batch || batch.status === "cancelled") {
    await finishImageItem(orgId, item.id, { status: "cancelled" });
    return "skipped";
  }

  let outcome: ImageItemOutcome = "failed";
  try {
    const photo = await productPhoto(orgId, item.sku);
    if (!photo.ok) {
      await finishImageItem(orgId, item.id, { status: "failed", error: photo.error });
      return outcome;
    }
    const generationId = await makeImage(batch, item, photo.product);
    await finishImageItem(orgId, item.id, { status: "done", generationId });
    outcome = "done";
  } catch (error) {
    if (error instanceof ProviderError && error.code === "rate_limited") {
      // Over the per-user/org job rate: the item waits and runs again (it was not charged).
      await finishImageItem(orgId, item.id, { status: "pending" });
      outcome = "retry";
      return outcome;
    }
    if (!(error instanceof ProviderError)) reportError("bulk image item failed", error, { orgId, batchId: item.batchId, tool: batch.tool });
    await finishImageItem(orgId, item.id, { status: "failed", error: error instanceof ProviderError ? error.code : "generation_failed" });
  } finally {
    if (outcome !== "retry") await settleImageBatch(orgId, item.batchId);
  }
  return outcome;
}
