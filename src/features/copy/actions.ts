"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { COPY_CHANNELS, COPY_LANGUAGES, COPY_LENGTHS, COPY_TONES, type CopyLanguage, type ProductCopy } from "@/lib/ai/types";
import { categoryPresets } from "@/lib/catalog-presets";
import { recordAudit } from "@/lib/audit";
import { getCopy, listCopies, removeCopy, reviewCopies, updateCopy, type SavedCopy } from "@/lib/copy/copies";
import { REVIEW_FROM, REVIEW_NOTE_MAX, REVIEW_STATUSES, type ReviewAction, type ReviewStatus } from "@/lib/copy/review-status";
import { writeCopy } from "@/lib/copy/write";
import { reportError } from "@/lib/observability/report";
import { isAssetMime } from "@/lib/storage/assets";
import { getWorkspace } from "@/lib/workspace";

export type CopyView = Omit<SavedCopy, "orgId">;
export type ReviewRights = { submit: boolean; approve: boolean };
export type CopyFailure = { ok: false; error: ProviderErrorCode | "invalid_input" | "not_found" | "forbidden" };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DETAILS_MAX = 3000;

const toView = ({ orgId, ...copy }: SavedCopy): CopyView => (void orgId, copy);
const text = (form: FormData, key: string, max: number) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};
const oneOf = <T extends string>(options: readonly T[], value: string): T | null => ((options as readonly string[]).includes(value) ? (value as T) : null);

export async function generateProductCopy(form: FormData): Promise<{ ok: true; copy: CopyView } | CopyFailure> {
  const workspace = await getWorkspace();
  const sku = text(form, "sku", 64);
  const productName = text(form, "productName", 200);
  const category = categoryPresets.find((c) => c.key === text(form, "category", 40))?.key;
  const tone = oneOf(COPY_TONES, text(form, "tone", 20));
  const length = oneOf(COPY_LENGTHS, text(form, "length", 20));
  const channel = oneOf(COPY_CHANNELS, text(form, "channel", 20));
  const languages = COPY_LANGUAGES.filter((l) => form.getAll("languages").includes(l));
  const keywords = [...new Set(text(form, "keywords", 400).split(",").map((k) => k.trim()).filter(Boolean))].slice(0, 15);
  const details = text(form, "details", DETAILS_MAX);
  const image = form.get("image");
  const hasImage = image instanceof File && image.size > 0;
  if (!sku || !productName || !category || !tone || !length || !channel || !languages.length) return { ok: false, error: "invalid_input" };
  if (hasImage && (image.size > MAX_IMAGE_BYTES || !isAssetMime(image.type))) return { ok: false, error: "invalid_input" };

  try {
    const saved = await writeCopy(workspace, {
      sku,
      productName,
      settings: { category, tone, length, channel, languages, keywords, details, brandVoice: form.get("brandVoice") !== "off" },
      image: hasImage ? { bytes: new Uint8Array(await image.arrayBuffer()), mimeType: image.type, name: image.name } : null,
    });
    return { ok: true, copy: toView(saved) };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("generateProductCopy failed", error, { orgId: workspace.orgId });
    return { ok: false, error: "generation_failed" };
  }
}

/** Newest 20, or only one approval status (e.g. the "In review" queue). */
export async function listRecentCopies(status?: ReviewStatus): Promise<CopyView[]> {
  const workspace = await getWorkspace();
  const only = status && REVIEW_STATUSES.includes(status) ? status : undefined;
  return (await listCopies(workspace.orgId, 20, only)).map(toView);
}

const REVIEW_AUDIT = { submit: "copy.submitted", approve: "copy.approved", request_changes: "copy.changes_requested" } as const;

/** Editors and admins submit for review; only admins approve or request changes (with a note). */
export async function reviewCopy(id: string, action: ReviewAction, note?: string): Promise<{ ok: true; copy: CopyView } | CopyFailure> {
  const workspace = await getWorkspace();
  if (!(action in REVIEW_FROM)) return { ok: false, error: "invalid_input" };
  if (workspace.role === "viewer" || (action !== "submit" && workspace.role !== "admin")) return { ok: false, error: "forbidden" };
  const text = action === "request_changes" && typeof note === "string" ? note.trim().slice(0, REVIEW_NOTE_MAX) : "";
  if (action === "request_changes" && !text) return { ok: false, error: "invalid_input" };
  const existing = typeof id === "string" ? await getCopy(workspace.orgId, id) : null;
  if (!existing) return { ok: false, error: "not_found" };
  const [changed] = await reviewCopies(workspace.orgId, [id], action, workspace.user.name, text || null);
  if (!changed) return { ok: false, error: "invalid_input" }; // not allowed from its current status
  await recordAudit({ orgId: workspace.orgId, action: REVIEW_AUDIT[action], actor: workspace.user.name, target: changed.sku, meta: { copyId: changed.id } });
  return { ok: true, copy: toView(changed) };
}

/** One saved copy, to open it in the editor (?copy=<id>, e.g. from a bulk run). */
export async function getSavedCopy(id: string): Promise<CopyView | null> {
  const workspace = await getWorkspace();
  const copy = typeof id === "string" ? await getCopy(workspace.orgId, id) : null;
  return copy ? toView(copy) : null;
}

const FIELD_MAX = { title: 300, description: 6000, metaTitle: 120, metaDescription: 320 } as const;

function cleanCopy(value: unknown): ProductCopy | null {
  const c = value as Partial<ProductCopy> | null;
  if (!c || typeof c !== "object") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, each)).slice(0, max) : null);
  const out = {
    title: str(c.title, FIELD_MAX.title),
    bullets: list(c.bullets, 10, 500),
    description: str(c.description, FIELD_MAX.description),
    metaTitle: str(c.metaTitle, FIELD_MAX.metaTitle),
    metaDescription: str(c.metaDescription, FIELD_MAX.metaDescription),
    tags: list(c.tags, 20, 60),
  };
  return Object.values(out).every((v) => v !== null) ? (out as ProductCopy) : null;
}

/** Saves the merchant's edits over the generated text. */
export async function saveCopyEdits(id: string, copy: Partial<Record<CopyLanguage, unknown>>): Promise<{ ok: true; copy: CopyView } | CopyFailure> {
  const workspace = await getWorkspace();
  const existing = typeof id === "string" ? await getCopy(workspace.orgId, id) : null;
  if (!existing) return { ok: false, error: "not_found" };
  const next: SavedCopy["copy"] = {};
  for (const language of existing.settings.languages) {
    const cleaned = cleanCopy(copy?.[language]);
    if (!cleaned) return { ok: false, error: "invalid_input" };
    next[language] = cleaned;
  }
  const saved = await updateCopy(workspace.orgId, id, next);
  return saved ? { ok: true, copy: toView(saved) } : { ok: false, error: "not_found" };
}

/** Admins, or whoever generated it. */
export async function deleteCopy(id: string): Promise<{ ok: true } | CopyFailure> {
  const workspace = await getWorkspace();
  const existing = typeof id === "string" ? await getCopy(workspace.orgId, id) : null;
  if (!existing) return { ok: false, error: "not_found" };
  if (workspace.role !== "admin" && existing.createdBy !== workspace.user.name) return { ok: false, error: "forbidden" };
  await removeCopy(workspace.orgId, id);
  return { ok: true };
}

/** What the current user may do in review, for the Copy UI. */
export async function getCopyReviewRights(): Promise<ReviewRights> {
  const workspace = await getWorkspace();
  return { submit: workspace.role !== "viewer", approve: workspace.role === "admin" };
}
