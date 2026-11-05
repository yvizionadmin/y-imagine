import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CopyChannel, CopyLanguage, CopyLength, CopyTone } from "@/lib/ai/types";

// Bulk Copy (copy_batches + copy_batch_items). A batch is created with one `pending` item per
// product; each item is a queued job that writes and saves one product's copy (one credit), so a
// batch survives restarts and can be cancelled part-way. Progress is counted from the items.

export type BatchStatus = "running" | "done" | "cancelled";
export type BatchItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export type BatchDefaults = { category: string; tone: CopyTone; length: CopyLength; channel: CopyChannel; languages: CopyLanguage[]; brandVoice?: boolean };

export type BatchRow = { sku: string; productName: string; category: string | null; details: string; keywords: string[] };

export type Batch = typeof schema.copyBatches.$inferSelect;
export type BatchItem = typeof schema.copyBatchItems.$inferSelect;
export type BatchCounts = Record<BatchItemStatus, number>;

const { copyBatches, copyBatchItems } = schema;

/** An item still `running` after this long belongs to a crashed process. */
const STALE_ITEM_MS = 15 * 60 * 1000;

export async function insertBatch(input: { orgId: string; name: string; settings: BatchDefaults; rows: BatchRow[]; createdBy: string; createdById: string }) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(input.orgId, tx);
    const [batch] = await scope.insert(copyBatches, {
      id: randomUUID(),
      name: input.name,
      settings: input.settings,
      status: "running",
      total: input.rows.length,
      createdBy: input.createdBy,
      createdById: input.createdById,
    });
    const items = await scope.insert(
      copyBatchItems,
      input.rows.map((row, position) => ({ ...row, id: randomUUID(), batchId: batch.id, position, status: "pending" as const })),
    );
    return { batch, items };
  });
}

export async function getBatch(orgId: string, id: string): Promise<Batch | null> {
  return db.forOrg(orgId).first(copyBatches, eq(copyBatches.id, id));
}

/** Newest first. */
export async function listBatches(orgId: string, limit = 20): Promise<Batch[]> {
  return db.forOrg(orgId).select(copyBatches, undefined, { orderBy: [desc(copyBatches.createdAt)], limit });
}

export async function listBatchItems(orgId: string, batchId: string): Promise<BatchItem[]> {
  return db.forOrg(orgId).select(copyBatchItems, eq(copyBatchItems.batchId, batchId), { orderBy: [asc(copyBatchItems.position)] });
}

export async function getBatchItem(orgId: string, id: string): Promise<BatchItem | null> {
  return db.forOrg(orgId).first(copyBatchItems, eq(copyBatchItems.id, id));
}

export async function countBatchItems(orgId: string, batchIds: string[]): Promise<Map<string, BatchCounts>> {
  const out = new Map<string, BatchCounts>(batchIds.map((id) => [id, { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 }]));
  if (!batchIds.length) return out;
  const rows = await db
    .select({ batchId: copyBatchItems.batchId, status: copyBatchItems.status, n: count() })
    .from(copyBatchItems)
    .where(and(eq(copyBatchItems.orgId, orgId), inArray(copyBatchItems.batchId, batchIds)))
    .groupBy(copyBatchItems.batchId, copyBatchItems.status);
  for (const row of rows) out.get(row.batchId)![row.status] = row.n;
  return out;
}

/** Moves a pending item to running; null when another runner already took it (or it was cancelled). */
export async function claimItem(orgId: string, id: string): Promise<BatchItem | null> {
  const [row] = await db
    .forOrg(orgId)
    .update(copyBatchItems, { status: "running", updatedAt: new Date().toISOString() }, and(eq(copyBatchItems.id, id), eq(copyBatchItems.status, "pending")));
  return row ?? null;
}

export async function finishItem(orgId: string, id: string, patch: { status: Exclude<BatchItemStatus, "running">; error?: string | null; copyId?: string | null; productName?: string }) {
  await db.forOrg(orgId).update(copyBatchItems, { error: null, ...patch, updatedAt: new Date().toISOString() }, eq(copyBatchItems.id, id));
}

/** Marks the batch done once no item is waiting or running. */
export async function settleBatch(orgId: string, batchId: string) {
  const open = await db
    .forOrg(orgId)
    .first(copyBatchItems, and(eq(copyBatchItems.batchId, batchId), inArray(copyBatchItems.status, ["pending", "running"])));
  if (open) return false;
  await db.forOrg(orgId).update(copyBatches, { status: "done", finishedAt: new Date().toISOString() }, and(eq(copyBatches.id, batchId), eq(copyBatches.status, "running")));
  return true;
}

/** Stops a batch: items not yet started are cancelled (and cost nothing); running ones finish. */
export async function cancelBatch(orgId: string, batchId: string) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(orgId, tx);
    const [batch] = await scope.update(copyBatches, { status: "cancelled", finishedAt: new Date().toISOString() }, and(eq(copyBatches.id, batchId), eq(copyBatches.status, "running")));
    if (!batch) return false;
    await scope.update(copyBatchItems, { status: "cancelled", updatedAt: new Date().toISOString() }, and(eq(copyBatchItems.batchId, batchId), eq(copyBatchItems.status, "pending")));
    return true;
  });
}

/** Retry: failed items go back to pending (the batch reopens). Returns their ids to enqueue. */
export async function reopenFailed(orgId: string, batchId: string) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(orgId, tx);
    const items = await scope.update(copyBatchItems, { status: "pending", error: null, updatedAt: new Date().toISOString() }, and(eq(copyBatchItems.batchId, batchId), eq(copyBatchItems.status, "failed")));
    if (items.length) await scope.update(copyBatches, { status: "running", finishedAt: null }, eq(copyBatches.id, batchId));
    return items.map((i) => i.id);
  });
}

export async function removeBatch(orgId: string, batchId: string) {
  return (await db.forOrg(orgId).delete(copyBatches, eq(copyBatches.id, batchId))).length > 0;
}

/**
 * Items left `running` by a crashed process are marked failed (`timed_out`) and their batches settled.
 * Platform scope (all orgs), run by the worker's stale-job schedule. Returns how many were closed.
 */
export async function releaseStaleItems() {
  const rows = await db
    .update(copyBatchItems)
    .set({ status: "failed", error: "timed_out", updatedAt: new Date().toISOString() })
    .where(and(eq(copyBatchItems.status, "running"), lt(copyBatchItems.updatedAt, new Date(Date.now() - STALE_ITEM_MS).toISOString())))
    .returning({ orgId: copyBatchItems.orgId, batchId: copyBatchItems.batchId });
  for (const key of new Set(rows.map((r) => `${r.orgId}:${r.batchId}`))) {
    const [orgId, batchId] = key.split(":");
    await settleBatch(orgId, batchId);
  }
  return rows.length;
}
