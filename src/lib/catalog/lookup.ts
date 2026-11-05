import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { safeFetch } from "@/lib/safe-fetch";
import { loadConnection } from "./connections";
import { createConnector } from "./registry";
import { CatalogError, type CatalogErrorCode, type CatalogProduct, type ConnectorSettings, type ConnectorType } from "./types";

export type LookupError = CatalogErrorCode | "not_found";

/** Run a SKU lookup and map every failure to a stable code (raw platform errors never reach the UI). */
export async function runLookup(
  type: ConnectorType,
  settings: ConnectorSettings,
  sku: string,
): Promise<{ ok: true; product: CatalogProduct } | { ok: false; error: LookupError }> {
  try {
    const product = await createConnector(type, settings).findBySku(sku);
    return product ? { ok: true, product } : { ok: false, error: "not_found" };
  } catch (error) {
    if (error instanceof CatalogError) return { ok: false, error: error.code };
    return { ok: false, error: error instanceof TypeError ? "misconfigured" : "bad_response" };
  }
}

export async function runSearch(type: ConnectorType, settings: ConnectorSettings, query: string, limit = 12) {
  try {
    const connector = createConnector(type, settings);
    if (connector.search) return { ok: true as const, products: await connector.search(query, limit) };
    const product = await connector.findBySku(query);
    return { ok: true as const, products: product ? [product] : [] };
  } catch (error) {
    return { ok: false as const, error: error instanceof CatalogError ? error.code : ("bad_response" as const) };
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEMO_IMAGE = /^\/demo\/[a-z0-9-]+\.png$/;

export async function importProductPng(orgId: string, sku: string, imageUrl: string) {
  const loaded = await loadConnection(orgId);
  if (!loaded) return { ok: false as const, error: "no_connection" as const };
  const lookup = await runLookup(loaded.connection.type, loaded.settings, sku);
  if (!lookup.ok) return lookup;
  if (!lookup.product.images.includes(imageUrl)) return { ok: false as const, error: "not_found" as const };

  let bytes: Uint8Array;
  if (loaded.connection.type === "demo" && DEMO_IMAGE.test(imageUrl)) {
    bytes = await readFile(path.join(process.cwd(), "public", imageUrl));
  } else {
    const response = await safeFetch(imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      types: ["image/png", "image/jpeg", "image/webp"],
    });
    if (!response.ok) return { ok: false as const, error: "unreachable" as const };
    bytes = response.result.bytes;
  }

  const png = await sharp(bytes)
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { ok: true as const, png, product: lookup.product };
}

/**
 * Download one of a catalog product's images and normalise it to PNG (every tool accepts PNG).
 * The URL must belong to the product returned by a fresh lookup, so this can't be used to fetch
 * arbitrary URLs.
 */
export async function importProductImage(orgId: string, sku: string, imageUrl: string) {
  const result = await importProductPng(orgId, sku, imageUrl);
  if (!result.ok) return result;
  const name = `${result.product.sku.replace(/[^A-Za-z0-9_-]/g, "_")}.png`;
  return { ok: true as const, dataUrl: `data:image/png;base64,${result.png.toString("base64")}`, name };
}
