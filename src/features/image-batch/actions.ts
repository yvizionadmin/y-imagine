"use server";

import { getGenerations } from "@/lib/generations";
import { cancelImageBatch, countImageBatchItems, getImageBatch, listImageBatches, listImageBatchItems, removeImageBatch, reopenFailedImages } from "@/lib/image-batch/batches";
import { dispatchImageItems } from "@/lib/image-batch/queue";
import { IMAGE_BATCH_TOOLS, type ImageBatchTool, type RecolorBatchSettings } from "@/lib/image-batch/rows";
import { canManageImageBatch, toImageBatchView, type ImageBatchFailure, type ImageBatchItemView, type ImageBatchView } from "@/lib/image-batch/start";
import { deleteAsset } from "@/lib/storage/assets";
import { getWorkspace } from "@/lib/workspace";

// Bulk image runs, whichever tool started them (Generate, Recolor, A+): list, open, stop, retry, delete.

/** Newest 20 runs of one tool. */
export async function listImageBatchRuns(tool: ImageBatchTool): Promise<ImageBatchView[]> {
  const workspace = await getWorkspace({ read: true });
  if (!IMAGE_BATCH_TOOLS.includes(tool)) return [];
  const batches = await listImageBatches(workspace.orgId, tool, 20);
  const counts = await countImageBatchItems(workspace.orgId, batches.map((b) => b.id));
  return batches.map((b) => toImageBatchView(workspace, b, counts.get(b.id)!));
}

export async function getImageBatchRun(id: string): Promise<{ batch: ImageBatchView; items: ImageBatchItemView[] } | null> {
  const workspace = await getWorkspace({ read: true });
  const batch = typeof id === "string" ? await getImageBatch(workspace.orgId, id) : null;
  if (!batch) return null;
  const [items, counts] = await Promise.all([listImageBatchItems(workspace.orgId, id), countImageBatchItems(workspace.orgId, [id])]);
  const assets = new Map((await getGenerations(workspace.orgId, items.flatMap((i) => (i.generationId ? [i.generationId] : [])))).map((g) => [g.id, g.assetId]));
  return {
    batch: toImageBatchView(workspace, batch, counts.get(id)!),
    items: items.map(({ id, sku, productSize, status, error, generationId }) => {
      const assetId = generationId ? assets.get(generationId) : undefined;
      return { id, sku, productSize, status, error, generationId, imageUrl: assetId ? `/api/assets/${assetId}` : null };
    }),
  };
}

async function managed(id: string) {
  const workspace = await getWorkspace();
  const batch = typeof id === "string" ? await getImageBatch(workspace.orgId, id) : null;
  if (!batch) return { ok: false as const, error: "not_found" as const };
  if (!canManageImageBatch(workspace, batch)) return { ok: false as const, error: "forbidden" as const };
  return { ok: true as const, workspace, batch };
}

/** Admins, or whoever started it. Images already made stay in History. */
export async function cancelImageBatchRun(id: string): Promise<{ ok: true } | ImageBatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  await cancelImageBatch(found.workspace.orgId, id);
  return { ok: true };
}

export async function retryFailedImages(id: string): Promise<{ ok: true; retried: number } | ImageBatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  if (found.batch.status === "cancelled") return { ok: false, error: "invalid_input" };
  const ids = await reopenFailedImages(found.workspace.orgId, id);
  await dispatchImageItems(found.workspace.orgId, ids);
  return { ok: true, retried: ids.length };
}

/** Removes the run record (and a Recolor run's stored swatch); its images stay in History. */
export async function deleteImageBatchRun(id: string): Promise<{ ok: true } | ImageBatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  const { workspace, batch } = found;
  await cancelImageBatch(workspace.orgId, id);
  await removeImageBatch(workspace.orgId, id);
  if (batch.tool === "recolor") {
    const s = batch.settings as RecolorBatchSettings;
    await deleteAsset(workspace.orgId, s.swatchAssetId, s.swatchMime);
  }
  return { ok: true };
}
