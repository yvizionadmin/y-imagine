"use server";

import type { ProviderErrorCode } from "@/lib/ai/errors";
import { textProviderProblem } from "@/lib/ai/registry";
import { COPY_CHANNELS, COPY_LANGUAGES, COPY_LENGTHS, COPY_TONES, type CopyLanguage, type ProductCopy } from "@/lib/ai/types";
import { categoryPresets } from "@/lib/catalog-presets";
import { parseBatchInput } from "@/lib/copy/batch-csv";
import { dispatchItems } from "@/lib/copy/batch-queue";
import { cancelBatch, countBatchItems, getBatch, insertBatch, listBatches, listBatchItems, removeBatch, reopenFailed, type Batch, type BatchCounts, type BatchDefaults, type BatchItem } from "@/lib/copy/batches";
import { recordAudit } from "@/lib/audit";
import { getCopies, reviewCopies } from "@/lib/copy/copies";
import { notifyCopyReviewed, notifyCopySubmitted, quietly } from "@/lib/email/notify";
import { requestEmailLocale } from "@/lib/email/request-locale";
import type { ReviewStatus } from "@/lib/copy/review-status";
import { reportError } from "@/lib/observability/report";
import { jobCost, planAllows } from "@/lib/credits";
import { getPlatformSettings } from "@/lib/platform/settings";
import { getWorkspace, type Workspace } from "@/lib/workspace";

export type BatchView = Omit<Batch, "orgId" | "createdById"> & { counts: BatchCounts; canManage: boolean };
export type BatchItemView = Pick<BatchItem, "id" | "sku" | "productName" | "status" | "error" | "copyId"> & { review: ReviewStatus | null };
export type BatchFailure = { ok: false; error: ProviderErrorCode | "invalid_input" | "empty" | "not_found" | "forbidden" | "not_enough_credits" };

const CATEGORY_KEYS = categoryPresets.map((c) => c.key);
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null => (typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null);

const canManage = (workspace: Workspace, batch: Batch) => workspace.role === "admin" || batch.createdById === workspace.user.id;
function toView(workspace: Workspace, batch: Batch, counts: BatchCounts): BatchView {
  const { orgId, createdById, ...view } = batch;
  void [orgId, createdById];
  return { ...view, counts, canManage: canManage(workspace, batch) };
}

/**
 * Starts a bulk Copy run from pasted/uploaded CSV text. Every product costs one credit when it is
 * written, so the batch must fit in the credits left this month. Items run on the queue.
 */
export async function startCopyBatch(input: { text: string; name?: string; settings: Partial<BatchDefaults> }): Promise<{ ok: true; batch: BatchView } | BatchFailure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const s = input?.settings ?? {};
  const settings = {
    category: oneOf(CATEGORY_KEYS, s.category),
    tone: oneOf(COPY_TONES, s.tone),
    length: oneOf(COPY_LENGTHS, s.length),
    channel: oneOf(COPY_CHANNELS, s.channel),
    languages: COPY_LANGUAGES.filter((l) => Array.isArray(s.languages) && s.languages.includes(l)),
    brandVoice: s.brandVoice !== false,
  };
  if (typeof input?.text !== "string" || input.text.length > 1_000_000) return { ok: false, error: "invalid_input" };
  if (!settings.category || !settings.tone || !settings.length || !settings.channel || !settings.languages.length) return { ok: false, error: "invalid_input" };
  const { rows } = parseBatchInput(input.text, CATEGORY_KEYS);
  if (!rows.length) return { ok: false, error: "empty" };
  const platform = await getPlatformSettings();
  if (platform.disabledFeatures.includes("copy")) return { ok: false, error: "feature_disabled" };
  if (!planAllows(platform.creditRules, workspace.plan, "copy")) return { ok: false, error: "not_in_plan" };
  if (rows.length * jobCost(platform.creditRules, "copy") > workspace.creditsRemaining) return { ok: false, error: "not_enough_credits" };
  const problem = await textProviderProblem(workspace.orgId, "copy");
  if (problem) return { ok: false, error: problem };

  const name = (typeof input.name === "string" && input.name.trim().slice(0, 120)) || (rows.length > 1 ? `${rows[0].sku} +${rows.length - 1}` : rows[0].sku);
  const { batch, items } = await insertBatch({
    orgId: workspace.orgId,
    name,
    settings: settings as BatchDefaults,
    rows,
    createdBy: workspace.user.name,
    createdById: workspace.user.id,
  });
  try {
    await dispatchItems(workspace.orgId, items.map((i) => i.id));
  } catch (error) {
    reportError("bulk copy dispatch failed", error, { orgId: workspace.orgId, batchId: batch.id });
  }
  const counts = (await countBatchItems(workspace.orgId, [batch.id])).get(batch.id)!;
  return { ok: true, batch: toView(workspace, batch, counts) };
}

export async function listCopyBatches(): Promise<BatchView[]> {
  const workspace = await getWorkspace({ read: true });
  const batches = await listBatches(workspace.orgId, 20);
  const counts = await countBatchItems(workspace.orgId, batches.map((b) => b.id));
  return batches.map((b) => toView(workspace, b, counts.get(b.id)!));
}

export async function getCopyBatch(id: string): Promise<{ batch: BatchView; items: BatchItemView[] } | null> {
  const workspace = await getWorkspace({ read: true });
  const batch = typeof id === "string" ? await getBatch(workspace.orgId, id) : null;
  if (!batch) return null;
  const [items, counts] = await Promise.all([listBatchItems(workspace.orgId, id), countBatchItems(workspace.orgId, [id])]);
  const reviews = new Map((await getCopies(workspace.orgId, items.flatMap((i) => (i.copyId ? [i.copyId] : [])))).map((c) => [c.id, c.reviewStatus]));
  return {
    batch: toView(workspace, batch, counts.get(id)!),
    items: items.map(({ id, sku, productName, status, error, copyId }) => ({ id, sku, productName, status, error, copyId, review: (copyId && reviews.get(copyId)) || null })),
  };
}

async function managed(id: string) {
  const workspace = await getWorkspace();
  const batch = typeof id === "string" ? await getBatch(workspace.orgId, id) : null;
  if (!batch) return { ok: false as const, error: "not_found" as const };
  if (!canManage(workspace, batch)) return { ok: false as const, error: "forbidden" as const };
  return { ok: true as const, workspace, batch };
}

/** Admins, or whoever started it. Products already written are kept. */
export async function cancelCopyBatch(id: string): Promise<{ ok: true } | BatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  await cancelBatch(found.workspace.orgId, id);
  return { ok: true };
}

export async function retryFailedItems(id: string): Promise<{ ok: true; retried: number } | BatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  if (found.batch.status === "cancelled") return { ok: false, error: "invalid_input" };
  const ids = await reopenFailed(found.workspace.orgId, id);
  await dispatchItems(found.workspace.orgId, ids);
  return { ok: true, retried: ids.length };
}

/** Removes the batch record; the copy it wrote stays in the Copy tool. */
export async function deleteCopyBatch(id: string): Promise<{ ok: true } | BatchFailure> {
  const found = await managed(id);
  if (!found.ok) return found;
  await cancelBatch(found.workspace.orgId, id);
  await removeBatch(found.workspace.orgId, id);
  return { ok: true };
}

async function batchCopyIds(orgId: string, id: string) {
  return (await listBatchItems(orgId, id)).flatMap((i) => (i.copyId ? [i.copyId] : []));
}

/**
 * Bulk review of what a run has written: "submit" (editors, admins) sends drafts and copy with
 * requested changes for review; "approve" (admins) approves everything not yet approved.
 */
export async function reviewCopyBatch(id: string, action: "submit" | "approve"): Promise<{ ok: true; changed: number } | BatchFailure> {
  const workspace = await getWorkspace();
  if (action !== "submit" && action !== "approve") return { ok: false, error: "invalid_input" };
  if (workspace.role === "viewer" || (action === "approve" && workspace.role !== "admin")) return { ok: false, error: "forbidden" };
  const batch = typeof id === "string" ? await getBatch(workspace.orgId, id) : null;
  if (!batch) return { ok: false, error: "not_found" };
  const changed = await reviewCopies(workspace.orgId, await batchCopyIds(workspace.orgId, id), action, workspace.user.name);
  if (changed.length) {
    await recordAudit({
      orgId: workspace.orgId,
      action: action === "approve" ? "copy.approved" : "copy.submitted",
      actor: workspace.user.name,
      target: batch.name,
      meta: { batchId: batch.id, count: String(changed.length) },
    });
    await quietly("copy batch review", async () => {
      const common = { orgId: workspace.orgId, orgName: workspace.orgName, actorId: workspace.user.id, actor: workspace.user.name, label: batch.name, locale: await requestEmailLocale() };
      if (action === "submit") return notifyCopySubmitted({ ...common, count: changed.length });
      // Approved: one email per author, with how many of their products were approved.
      const byAuthor = new Map<string, number>();
      for (const c of changed) if (c.createdById) byAuthor.set(c.createdById, (byAuthor.get(c.createdById) ?? 0) + 1);
      for (const [authorId, count] of byAuthor) {
        await notifyCopyReviewed({ ...common, authorId, outcome: "approved", count, note: null, copyId: null });
      }
    });
  }
  return { ok: true, changed: changed.length };
}

/** Every product the batch has written so far (or only the approved ones), for the CSV download. */
export async function exportCopyBatch(
  id: string,
  options: { approvedOnly?: boolean } = {},
): Promise<{ sku: string; productName: string; copy: Partial<Record<CopyLanguage, ProductCopy>>; review: ReviewStatus }[]> {
  const workspace = await getWorkspace();
  if (typeof id !== "string" || !(await getBatch(workspace.orgId, id))) return [];
  const ids = await batchCopyIds(workspace.orgId, id);
  const copies = new Map((await getCopies(workspace.orgId, ids)).map((c) => [c.id, c]));
  return ids.flatMap((copyId) => {
    const c = copies.get(copyId);
    if (!c || (options?.approvedOnly && c.reviewStatus !== "approved")) return [];
    return [{ sku: c.sku, productName: c.productName, copy: c.copy, review: c.reviewStatus }];
  });
}
