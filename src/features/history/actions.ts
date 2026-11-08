"use server";

import sharp from "sharp";
import { recordAudit } from "@/lib/audit";
import { loadConnection } from "@/lib/catalog/connections";
import { canPublish, createConnector } from "@/lib/catalog/registry";
import { CatalogError, type CatalogErrorCode } from "@/lib/catalog/types";
import { REVIEW_FROM, REVIEW_NOTE_MAX, REVIEW_TO, type ReviewAction } from "@/lib/copy/review-status";
import { notifyImagesReviewed, notifyImagesSubmitted, quietly, requestEmailLocale } from "@/lib/email/notify";
import {
  getGenerations,
  imageApprovalRequired,
  insertGeneration,
  listGenerations,
  listUserGenerations,
  removeGenerations,
  reviewGenerations,
  updateGenerations,
  type Generation,
  type GenerationMode,
  type PublishStatus,
} from "@/lib/generations";
import { deleteAsset, isAssetMime, readAsset, saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { forgetVideoJobs } from "@/lib/video/history";
import { getWorkspace } from "@/lib/workspace";
import { HISTORY_PAGE_SIZES, type HistoryFilters, type HistoryItem } from "./types";

const MODES: GenerationMode[] = ["create", "video", "lifestyle", "recolor", "aplus"];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ORG_TZ_OFFSET = "+04:00"; // Asia/Dubai, matches the next-intl default until per-org time zones

/** Studio images have no SKU, so they can't be uploaded to a store product. */
const publishable = (g: Generation) => g.sku !== "";

/** The publish gate: with approvals on, only approved images may reach the store. */
const needsApproval = (g: Generation, required: boolean) => required && g.reviewStatus !== "approved";

async function canEdit() {
  const workspace = await getWorkspace();
  return workspace.role === "viewer" ? null : workspace;
}

const toItem = (g: Generation): HistoryItem => ({
  id: g.id,
  mode: g.mode,
  sku: g.sku,
  title: g.title,
  imageUrl: `/api/assets/${g.assetId}`,
  width: g.width,
  height: g.height,
  settings: g.settings,
  provider: g.provider,
  model: g.model,
  status: g.status,
  publishedTo: g.publishedTo,
  publishedAt: g.publishedAt,
  publishError: g.publishError,
  reviewStatus: g.reviewStatus,
  reviewNote: g.reviewNote,
  reviewedBy: g.reviewedBy,
  reviewedAt: g.reviewedAt,
  createdBy: g.createdBy,
  createdAt: g.createdAt,
});

export async function saveGeneration(input: {
  mode: string;
  sku: string;
  title: string;
  imageUrl: string;
  width: number;
  height: number;
  settings: Record<string, string | null>;
  provider: string;
  model: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await canEdit();
  if (!workspace) return { ok: false, error: "forbidden" };

  const mode = MODES.find((m) => m === input.mode);
  const sku = String(input.sku ?? "").trim();
  const settings = Object.entries(input.settings ?? {}).slice(0, 20);
  const image = typeof input.imageUrl === "string" ? await decodeImage(input.imageUrl) : null;
  if (
    !mode ||
    !sku ||
    sku.length > 64 ||
    !image ||
    image.bytes.length > MAX_IMAGE_BYTES ||
    !isAssetMime(image.mimeType) ||
    settings.some(([k, v]) => k.length > 40 || (v !== null && (typeof v !== "string" || v.length > 2000)))
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const assetId = await saveAsset(workspace.orgId, image.bytes, image.mimeType, "generation");
  const generation = await insertGeneration({
    orgId: workspace.orgId,
    mode,
    sku,
    title: String(input.title ?? "").trim().slice(0, 120),
    assetId,
    mimeType: image.mimeType,
    width: Math.round(Number(input.width) || 0),
    height: Math.round(Number(input.height) || 0),
    settings: Object.fromEntries(settings),
    provider: String(input.provider ?? "").slice(0, 40),
    model: String(input.model ?? "").slice(0, 80),
    createdBy: workspace.user.name,
    createdById: workspace.user.id,
  });
  return { ok: true, id: generation.id };
}

/** Tools with a results feed (Gemini-style): every result is saved, and the tool shows the user's recent ones. */
const FEED_MODES: GenerationMode[] = ["lifestyle", "recolor", "aplus"];
const FEED_SIZE = 40;

/** The signed-in user's latest results for one tool (and one SKU, when opened from History), oldest first. */
export async function listToolFeed(mode: GenerationMode, sku?: string): Promise<HistoryItem[]> {
  const workspace = await getWorkspace({ read: true });
  if (!FEED_MODES.includes(mode)) return [];
  const forSku = typeof sku === "string" && sku.trim() ? sku.trim().slice(0, 64) : undefined;
  const newest = await listUserGenerations(workspace.orgId, mode, workspace.user.name, FEED_SIZE, forSku);
  return newest.reverse().map(toItem);
}

export async function queryHistory(filters: HistoryFilters): Promise<{
  items: HistoryItem[];
  total: number;
  hasAny: boolean;
  pendingCount: number;
  /** Images that could go to the store but still need approval. */
  awaitingApprovalCount: number;
  publishTarget: { name: string } | null;
  canEdit: boolean;
  canApprove: boolean;
  approvalRequired: boolean;
}> {
  const workspace = await getWorkspace({ read: true });
  const all = await listGenerations(workspace.orgId);
  const sku = filters.sku?.trim().toLowerCase();
  const from = filters.from ? Date.parse(`${filters.from}T00:00:00${ORG_TZ_OFFSET}`) : null;
  const to = filters.to ? Date.parse(`${filters.to}T23:59:59.999${ORG_TZ_OFFSET}`) : null;

  const matches = all
    .filter((g) => !sku || g.sku.toLowerCase().includes(sku))
    .filter((g) => !filters.mode || g.mode === filters.mode)
    .filter((g) => !filters.status || g.status === filters.status)
    .filter((g) => !filters.review || (g.mode !== "video" && g.reviewStatus === filters.review))
    .filter((g) => (from === null || Date.parse(g.createdAt) >= from) && (to === null || Date.parse(g.createdAt) <= to))
    .sort((a, b) => (filters.sort === "oldest" ? 1 : -1) * a.createdAt.localeCompare(b.createdAt));

  const pageSize = HISTORY_PAGE_SIZES.includes(filters.pageSize) ? filters.pageSize : HISTORY_PAGE_SIZES[1];
  const page = Math.max(1, Math.floor(filters.page) || 1);
  const loaded = await loadConnection(workspace.orgId);
  const approvalRequired = await imageApprovalRequired(workspace.orgId);
  const notUploaded = all.filter((g) => publishable(g) && g.status !== "uploaded");

  return {
    items: matches.slice((page - 1) * pageSize, page * pageSize).map(toItem),
    total: matches.length,
    hasAny: all.length > 0,
    pendingCount: notUploaded.filter((g) => !needsApproval(g, approvalRequired)).length,
    awaitingApprovalCount: notUploaded.filter((g) => needsApproval(g, approvalRequired)).length,
    publishTarget: loaded && canPublish(loaded.connection.type) ? { name: loaded.connection.name } : null,
    canEdit: workspace.role !== "viewer",
    canApprove: workspace.role === "admin",
    approvalRequired,
  };
}

const cleanIds = (ids: unknown) => (Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 200) : []);

export async function deleteGenerations(ids: string[]) {
  const workspace = await canEdit();
  if (!workspace) return { ok: false as const, error: "forbidden" as const };
  const removed = await removeGenerations(workspace.orgId, cleanIds(ids));
  await Promise.all(removed.map((g) => deleteAsset(workspace.orgId, g.assetId, g.mimeType)));
  await forgetVideoJobs(workspace.orgId, removed.filter((g) => g.mode === "video").map((g) => g.assetId));
  return { ok: true as const, count: removed.length };
}

const REVIEW_AUDIT = { submit: "image.submitted", approve: "image.approved", request_changes: "image.changes_requested" } as const;

/** Editors and admins submit images for review; only admins approve or request changes (with a note). */
export async function reviewImages(ids: string[], action: ReviewAction, note?: string): Promise<{ ok: true; changed: number } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (!Object.hasOwn(REVIEW_FROM, action)) return { ok: false, error: "invalid_input" };
  if (workspace.role === "viewer" || (action !== "submit" && workspace.role !== "admin")) return { ok: false, error: "forbidden" };
  const text = action === "request_changes" && typeof note === "string" ? note.trim().slice(0, REVIEW_NOTE_MAX) : "";
  if (action === "request_changes" && !text) return { ok: false, error: "invalid_input" };

  const changed = await reviewGenerations(workspace.orgId, cleanIds(ids), action, workspace.user.name, text || null);
  if (changed.length === 0) return { ok: true, changed: 0 };

  const name = (g: Generation) => g.sku || g.title;
  await recordAudit({
    orgId: workspace.orgId,
    action: REVIEW_AUDIT[action],
    actor: workspace.user.name,
    target: changed.length === 1 ? name(changed[0]) : String(changed.length),
    meta: changed.length === 1 ? { generationId: changed[0].id } : { count: String(changed.length) },
  });
  await quietly("image review", async () => {
    const common = { orgId: workspace.orgId, orgName: workspace.orgName, actorId: workspace.user.id, actor: workspace.user.name, locale: await requestEmailLocale() };
    if (action === "submit") return notifyImagesSubmitted({ ...common, count: changed.length, label: name(changed[0]) });
    // One email per person, with how many of their images this covers.
    const byAuthor = new Map<string, Generation[]>();
    for (const g of changed) if (g.createdById) byAuthor.set(g.createdById, [...(byAuthor.get(g.createdById) ?? []), g]);
    for (const [authorId, theirs] of byAuthor) {
      await notifyImagesReviewed({ ...common, authorId, outcome: REVIEW_TO[action] as "approved" | "changes_requested", count: theirs.length, label: name(theirs[0]), note: text || null });
    }
  });
  return { ok: true, changed: changed.length };
}

/** Marks images as uploaded by hand. The publish gate applies here too: it would otherwise be a way round it. */
export async function markGenerationsUploaded(ids: string[]) {
  const workspace = await canEdit();
  if (!workspace) return { ok: false as const, error: "forbidden" as const };
  const required = await imageApprovalRequired(workspace.orgId);
  const wanted = await getGenerations(workspace.orgId, cleanIds(ids));
  const allowed = wanted.filter((g) => !needsApproval(g, required)).map((g) => g.id);
  await updateGenerations(workspace.orgId, allowed, {
    status: "uploaded",
    publishedTo: null,
    publishedAt: new Date().toISOString(),
    publishError: null,
  });
  return { ok: true as const, count: allowed.length, skipped: wanted.length - allowed.length };
}

export type PublishResult = { id: string; ok: boolean; error?: CatalogErrorCode | "not_approved" };

/** Push images to the org's default catalog (History → Upload to Website). */
export async function publishGenerations(
  ids: string[] | "all-pending",
): Promise<{ ok: true; results: PublishResult[] } | { ok: false; error: "forbidden" | "no_target" }> {
  const workspace = await canEdit();
  if (!workspace) return { ok: false, error: "forbidden" };
  const loaded = await loadConnection(workspace.orgId);
  if (!loaded || !canPublish(loaded.connection.type)) return { ok: false, error: "no_target" };
  const connector = createConnector(loaded.connection.type, loaded.settings);

  const all = await listGenerations(workspace.orgId);
  const wanted = ids === "all-pending" ? null : new Set(cleanIds(ids));
  const targets = all.filter(publishable).filter((g) => (wanted ? wanted.has(g.id) : g.status !== "uploaded"));
  const required = await imageApprovalRequired(workspace.orgId);

  const results: PublishResult[] = [];
  for (const generation of targets) {
    if (needsApproval(generation, required)) {
      // "All pending" just leaves these out; asking for one by id says why it didn't go.
      if (wanted) results.push({ id: generation.id, ok: false, error: "not_approved" });
      continue;
    }
    try {
      const png = await sharp(await readAsset(workspace.orgId, generation.assetId, generation.mimeType)).png().toBuffer();
      await connector.publishImage!(generation.sku, {
        bytes: new Uint8Array(png),
        mimeType: "image/png",
        filename: `${generation.sku.replace(/[^A-Za-z0-9_-]/g, "_")}_${generation.mode}_${generation.id.slice(0, 8)}.png`,
        alt: generation.title || generation.sku,
      });
      await updateGenerations(workspace.orgId, [generation.id], {
        status: "uploaded",
        publishedTo: loaded.connection.name,
        publishedAt: new Date().toISOString(),
        publishError: null,
      });
      results.push({ id: generation.id, ok: true });
    } catch (error) {
      const code: CatalogErrorCode = error instanceof CatalogError ? error.code : "bad_response";
      await updateGenerations(workspace.orgId, [generation.id], { status: "failed" satisfies PublishStatus, publishError: code });
      results.push({ id: generation.id, ok: false, error: code });
    }
  }
  return { ok: true, results };
}
