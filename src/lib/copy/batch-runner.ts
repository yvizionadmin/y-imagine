import "server-only";
import { ProviderError } from "@/lib/ai/errors";
import { loadConnection } from "@/lib/catalog/connections";
import { runLookup } from "@/lib/catalog/lookup";
import { categoryPresets } from "@/lib/catalog-presets";
import { reportError } from "@/lib/observability/report";
import { claimItem, finishItem, getBatch, settleBatch, type BatchItem } from "./batches";
import { writeCopy } from "./write";

// Runs one bulk Copy item, from the worker (BullMQ) or in-process when there is no Redis. Safe to
// run twice: only a `pending` item is claimed, so a duplicate delivery does nothing.

export type ItemOutcome = "done" | "failed" | "retry" | "skipped";

const isCategory = (key: string | null | undefined): key is string => !!key && categoryPresets.some((c) => c.key === key);

/** Fills a SKU-only row from the org's catalog. */
async function fromCatalog(orgId: string, item: BatchItem) {
  if (item.productName) return { ok: true as const, productName: item.productName, category: item.category };
  const loaded = await loadConnection(orgId);
  if (!loaded) return { ok: false as const, error: "no_connection" };
  const lookup = await runLookup(loaded.connection.type, loaded.settings, item.sku);
  if (!lookup.ok) return { ok: false as const, error: lookup.error === "not_found" ? "sku_not_found" : "catalog_error" };
  return { ok: true as const, productName: lookup.product.name.slice(0, 200), category: item.category ?? lookup.product.category };
}

export async function runBatchItem(orgId: string, itemId: string): Promise<ItemOutcome> {
  const item = await claimItem(orgId, itemId);
  if (!item) return "skipped";
  const batch = await getBatch(orgId, item.batchId);
  if (!batch || batch.status === "cancelled") {
    await finishItem(orgId, item.id, { status: "cancelled" });
    return "skipped";
  }

  let outcome: ItemOutcome = "failed";
  try {
    const product = await fromCatalog(orgId, item);
    if (!product.ok) {
      await finishItem(orgId, item.id, { status: "failed", error: product.error });
      return outcome;
    }
    const { category: fallback, ...style } = batch.settings;
    const saved = await writeCopy(
      { orgId, user: { id: batch.createdById, name: batch.createdBy } },
      {
        sku: item.sku,
        productName: product.productName,
        settings: { ...style, category: isCategory(product.category) ? product.category : fallback, keywords: item.keywords, details: item.details },
        image: null,
      },
    );
    await finishItem(orgId, item.id, { status: "done", copyId: saved.id, productName: product.productName });
    outcome = "done";
  } catch (error) {
    if (error instanceof ProviderError && error.code === "rate_limited") {
      // Over the per-user/org job rate: the item waits and runs again (it was not charged).
      await finishItem(orgId, item.id, { status: "pending" });
      outcome = "retry";
      return outcome;
    }
    if (!(error instanceof ProviderError)) reportError("bulk copy item failed", error, { orgId, batchId: item.batchId });
    await finishItem(orgId, item.id, { status: "failed", error: error instanceof ProviderError ? error.code : "generation_failed" });
  } finally {
    if (outcome !== "retry") await settleBatch(orgId, item.batchId);
  }
  return outcome;
}
