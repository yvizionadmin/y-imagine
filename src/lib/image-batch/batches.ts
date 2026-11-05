import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { BatchCounts, BatchItemStatus } from "@/lib/copy/batches";
import type { ImageBatchRow, ImageBatchSettings, ImageBatchTool } from "./rows";

// Bulk image runs (image_batches + image_batch_items). Same lifecycle as bulk Copy: an item is
// claimed `pending` → `running` before it runs, so duplicate deliveries do nothing; the run is
// done once nothing is pending or running.

export type ImageBatch = typeof schema.imageBatches.$inferSelect;
export type ImageBatchItem = typeof schema.imageBatchItems.$inferSelect;

const { imageBatches, imageBatchItems } = schema;

/** An item still `running` after this long belongs to a crashed process. */
const STALE_ITEM_MS = 15 * 60 * 1000;

export async function insertImageBatch(input: {
  orgId: string;
  tool: ImageBatchTool;
  name: string;
  settings: ImageBatchSettings;
  rows: ImageBatchRow[];
  createdBy: string;
  createdById: string;
}) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(input.orgId, tx);
    const [batch] = await scope.insert(imageBatches, {
      id: randomUUID(),
      tool: input.tool,
      name: input.name,
      settings: input.settings,
      status: "running",
      total: input.rows.length,
      createdBy: input.createdBy,
      createdById: input.createdById,
    });
    const items = await scope.insert(
      imageBatchItems,
      input.rows.map((row, position) => ({ ...row, id: randomUUID(), batchId: batch.id, position, status: "pending" as const })),
    );
    return { batch, items };
  });
}

export async function getImageBatch(orgId: string, id: string): Promise<ImageBatch | null> {
  return db.forOrg(orgId).first(imageBatches, eq(imageBatches.id, id));
}

/** Newest first. */
export async function listImageBatches(orgId: string, tool: ImageBatchTool, limit = 20): Promise<ImageBatch[]> {
  return db.forOrg(orgId).select(imageBatches, eq(imageBatches.tool, tool), { orderBy: [desc(imageBatches.createdAt)], limit });
}

export async function listImageBatchItems(orgId: string, batchId: string): Promise<ImageBatchItem[]> {
  return db.forOrg(orgId).select(imageBatchItems, eq(imageBatchItems.batchId, batchId), { orderBy: [asc(imageBatchItems.position)] });
}

export async function countImageBatchItems(orgId: string, batchIds: string[]): Promise<Map<string, BatchCounts>> {
  const out = new Map<string, BatchCounts>(batchIds.map((id) => [id, { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 }]));
  if (!batchIds.length) return out;
  const rows = await db
    .select({ batchId: imageBatchItems.batchId, status: imageBatchItems.status, n: count() })
    .from(imageBatchItems)
    .where(and(eq(imageBatchItems.orgId, orgId), inArray(imageBatchItems.batchId, batchIds)))
    .groupBy(imageBatchItems.batchId, imageBatchItems.status);
  for (const row of rows) out.get(row.batchId)![row.status] = row.n;
  return out;
}

/** Moves a pending item to running; null when another runner already took it (or it was cancelled). */
export async function claimImageItem(orgId: string, id: string): Promise<ImageBatchItem | null> {
  const [row] = await db
    .forOrg(orgId)
    .update(imageBatchItems, { status: "running", updatedAt: new Date().toISOString() }, and(eq(imageBatchItems.id, id), eq(imageBatchItems.status, "pending")));
  return row ?? null;
}

export async function finishImageItem(orgId: string, id: string, patch: { status: Exclude<BatchItemStatus, "running">; error?: string | null; generationId?: string | null }) {
  await db.forOrg(orgId).update(imageBatchItems, { error: null, ...patch, updatedAt: new Date().toISOString() }, eq(imageBatchItems.id, id));
}

/** Marks the run done once no item is waiting or running. */
export async function settleImageBatch(orgId: string, batchId: string) {
  const open = await db.forOrg(orgId).first(imageBatchItems, and(eq(imageBatchItems.batchId, batchId), inArray(imageBatchItems.status, ["pending", "running"])));
  if (open) return false;
  await db.forOrg(orgId).update(imageBatches, { status: "done", finishedAt: new Date().toISOString() }, and(eq(imageBatches.id, batchId), eq(imageBatches.status, "running")));
  return true;
}

/** Stops a run: items not yet started are cancelled (and cost nothing); running ones finish. */
export async function cancelImageBatch(orgId: string, batchId: string) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(orgId, tx);
    const [batch] = await scope.update(imageBatches, { status: "cancelled", finishedAt: new Date().toISOString() }, and(eq(imageBatches.id, batchId), eq(imageBatches.status, "running")));
    if (!batch) return false;
    await scope.update(imageBatchItems, { status: "cancelled", updatedAt: new Date().toISOString() }, and(eq(imageBatchItems.batchId, batchId), eq(imageBatchItems.status, "pending")));
    return true;
  });
}

/** Retry: failed items go back to pending (the run reopens). Returns their ids to enqueue. */
export async function reopenFailedImages(orgId: string, batchId: string) {
  return db.transaction(async (tx) => {
    const scope = db.forOrg(orgId, tx);
    const items = await scope.update(imageBatchItems, { status: "pending", error: null, updatedAt: new Date().toISOString() }, and(eq(imageBatchItems.batchId, batchId), eq(imageBatchItems.status, "failed")));
    if (items.length) await scope.update(imageBatches, { status: "running", finishedAt: null }, eq(imageBatches.id, batchId));
    return items.map((i) => i.id);
  });
}

export async function removeImageBatch(orgId: string, batchId: string) {
  return (await db.forOrg(orgId).delete(imageBatches, eq(imageBatches.id, batchId))).length > 0;
}

/** Items left `running` by a crashed process are failed (`timed_out`) and their runs settled. Platform scope. */
export async function releaseStaleImageItems() {
  const rows = await db
    .update(imageBatchItems)
    .set({ status: "failed", error: "timed_out", updatedAt: new Date().toISOString() })
    .where(and(eq(imageBatchItems.status, "running"), lt(imageBatchItems.updatedAt, new Date(Date.now() - STALE_ITEM_MS).toISOString())))
    .returning({ orgId: imageBatchItems.orgId, batchId: imageBatchItems.batchId });
  for (const key of new Set(rows.map((r) => `${r.orgId}:${r.batchId}`))) {
    const [orgId, batchId] = key.split(":");
    await settleImageBatch(orgId, batchId);
  }
  return rows.length;
}
