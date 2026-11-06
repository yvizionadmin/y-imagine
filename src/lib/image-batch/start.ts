import "server-only";
import type { ProviderErrorCode } from "@/lib/ai/errors";
import { imageProviderProblem } from "@/lib/ai/registry";
import type { Feature } from "@/lib/ai/types";
import { loadConnection } from "@/lib/catalog/connections";
import type { BatchCounts } from "@/lib/copy/batches";
import { reportError } from "@/lib/observability/report";
import { jobCost, planAllows } from "@/lib/credits";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { Workspace } from "@/lib/workspace";
import { countImageBatchItems, insertImageBatch, type ImageBatch, type ImageBatchItem } from "./batches";
import { dispatchImageItems } from "./queue";
import type { ImageBatchRow, ImageBatchSettings, ImageBatchTool } from "./rows";

// Shared by the bulk Generate, Recolor and A+ actions: the checks every run passes before it is
// queued, and the shape the browser sees.

export type ImageBatchView = Omit<ImageBatch, "orgId" | "createdById"> & { counts: BatchCounts; canManage: boolean };
export type ImageBatchItemView = Pick<ImageBatchItem, "id" | "sku" | "productSize" | "status" | "error" | "generationId"> & { imageUrl: string | null };
export type ImageBatchFailure = {
  ok: false;
  error: ProviderErrorCode | "invalid_input" | "empty" | "not_found" | "forbidden" | "not_enough_credits" | "no_connection";
};

export const canManageImageBatch = (workspace: Workspace, batch: ImageBatch) => workspace.role === "admin" || batch.createdById === workspace.user.id;

export function toImageBatchView(workspace: Workspace, batch: ImageBatch, counts: BatchCounts): ImageBatchView {
  const { orgId, createdById, ...view } = batch;
  void [orgId, createdById];
  return { ...view, counts, canManage: canManageImageBatch(workspace, batch) };
}

const FEATURE: Record<ImageBatchTool, Feature> = { generate: "generate", recolor: "recolor", aplus: "aplus" };

/** Why this run can't start yet (viewer, empty, credits, tool off, no catalog, no provider), or null. */
export async function imageBatchProblem(workspace: Workspace, tool: ImageBatchTool, rowCount: number): Promise<ImageBatchFailure["error"] | null> {
  if (workspace.role === "viewer") return "forbidden";
  if (!rowCount) return "empty";
  const settings = await getPlatformSettings();
  if (settings.disabledFeatures.includes(FEATURE[tool])) return "feature_disabled";
  if (!planAllows(settings.creditRules, workspace.plan, FEATURE[tool])) return "not_in_plan";
  if (rowCount * jobCost(settings.creditRules, FEATURE[tool]) > workspace.creditsRemaining) return "not_enough_credits";
  if (!(await loadConnection(workspace.orgId))) return "no_connection";
  return imageProviderProblem(workspace.orgId, FEATURE[tool]);
}

/** Inserts the run and hands its items to the queue (call after imageBatchProblem). */
export async function beginImageBatch(workspace: Workspace, input: { tool: ImageBatchTool; name: string; settings: ImageBatchSettings; rows: ImageBatchRow[] }) {
  const rows = input.rows;
  const name = input.name || (rows.length > 1 ? `${rows[0].sku} +${rows.length - 1}` : rows[0].sku);
  const { batch, items } = await insertImageBatch({ orgId: workspace.orgId, ...input, name, createdBy: workspace.user.name, createdById: workspace.user.id });
  try {
    await dispatchImageItems(workspace.orgId, items.map((i) => i.id));
  } catch (error) {
    reportError("bulk image dispatch failed", error, { orgId: workspace.orgId, batchId: batch.id });
  }
  const counts = (await countImageBatchItems(workspace.orgId, [batch.id])).get(batch.id)!;
  return toImageBatchView(workspace, batch, counts);
}
