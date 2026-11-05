"use server";

import { loadConnection } from "@/lib/catalog/connections";
import { importProductImage, runLookup, type LookupError } from "@/lib/catalog/lookup";
import type { CatalogProduct, ConnectorType } from "@/lib/catalog/types";
import { getWorkspace } from "@/lib/workspace";

export type CatalogLookupResult =
  | { ok: true; product: CatalogProduct; source: { name: string; type: ConnectorType } }
  | { ok: false; error: "no_connection" | "invalid_input" | LookupError };

/** Look up a SKU in the org's default catalog connection. */
export async function lookupCatalogProduct(sku: string): Promise<CatalogLookupResult> {
  const workspace = await getWorkspace();
  const clean = typeof sku === "string" ? sku.trim().slice(0, 64) : "";
  if (!clean) return { ok: false, error: "invalid_input" };
  const loaded = await loadConnection(workspace.orgId);
  if (!loaded) return { ok: false, error: "no_connection" };
  const result = await runLookup(loaded.connection.type, loaded.settings, clean);
  return result.ok ? { ...result, source: { name: loaded.connection.name, type: loaded.connection.type } } : result;
}

export async function importCatalogImage(sku: string, imageUrl: string) {
  const workspace = await getWorkspace();
  if (typeof sku !== "string" || typeof imageUrl !== "string" || !sku.trim()) {
    return { ok: false as const, error: "invalid_input" as const };
  }
  return importProductImage(workspace.orgId, sku.trim().slice(0, 64), imageUrl);
}
