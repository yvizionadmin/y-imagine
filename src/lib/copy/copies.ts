import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CopyChannel, CopyLanguage, CopyLength, CopyTone, ProductCopy } from "@/lib/ai/types";
import { REVIEW_FROM, REVIEW_TO, type ReviewAction, type ReviewStatus } from "./review-status";

// Saved product copy (copy_generations). Every successful Copy job is saved, so nothing written is
// lost; merchants edit the text afterwards and the edit replaces the stored version.

export type CopySettings = {
  category: string;
  tone: CopyTone;
  length: CopyLength;
  channel: CopyChannel;
  languages: CopyLanguage[];
  keywords: string[];
  details: string;
  /** Write in the org's brand kit voice. Absent on copy written before brand kits (treated as on). */
  brandVoice?: boolean;
};

export type SavedCopy = {
  id: string;
  orgId: string;
  sku: string;
  productName: string;
  settings: CopySettings;
  copy: Partial<Record<CopyLanguage, ProductCopy>>;
  provider: string;
  model: string;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const { copyGenerations } = schema;

export async function insertCopy(input: Omit<SavedCopy, "id" | "createdAt" | "updatedAt" | `review${string}`>): Promise<SavedCopy> {
  const [row] = await db.forOrg(input.orgId).insert(copyGenerations, { ...input, id: randomUUID() });
  return row;
}

/** Newest first, optionally only one approval status. */
export async function listCopies(orgId: string, limit = 20, status?: ReviewStatus): Promise<SavedCopy[]> {
  const where = status ? eq(copyGenerations.reviewStatus, status) : undefined;
  return db.forOrg(orgId).select(copyGenerations, where, { orderBy: [desc(copyGenerations.createdAt)], limit });
}

export async function getCopy(orgId: string, id: string): Promise<SavedCopy | null> {
  return db.forOrg(orgId).first(copyGenerations, eq(copyGenerations.id, id));
}

export async function getCopies(orgId: string, ids: string[]): Promise<SavedCopy[]> {
  return ids.length ? db.forOrg(orgId).select(copyGenerations, inArray(copyGenerations.id, ids)) : [];
}

/** Saves edited text. Approved copy goes back to draft: the approval was for the old text. */
export async function updateCopy(orgId: string, id: string, copy: SavedCopy["copy"]): Promise<SavedCopy | null> {
  const existing = await getCopy(orgId, id);
  if (!existing) return null;
  const reset = existing.reviewStatus === "approved" ? { reviewStatus: "draft" as const, reviewNote: null, reviewedBy: null, reviewedAt: null } : {};
  const [row] = await db.forOrg(orgId).update(copyGenerations, { copy, ...reset, updatedAt: new Date().toISOString() }, eq(copyGenerations.id, id));
  return row ?? null;
}

/**
 * Moves copy to the action's status, only from the statuses it may start from (others are left as
 * they are). Returns the rows that changed.
 */
export async function reviewCopies(orgId: string, ids: string[], action: ReviewAction, by: string, note: string | null = null): Promise<SavedCopy[]> {
  if (!ids.length) return [];
  const review = action === "submit" ? { reviewNote: null, reviewedBy: null, reviewedAt: null } : { reviewNote: note, reviewedBy: by, reviewedAt: new Date().toISOString() };
  return db
    .forOrg(orgId)
    .update(copyGenerations, { reviewStatus: REVIEW_TO[action], ...review }, and(inArray(copyGenerations.id, ids), inArray(copyGenerations.reviewStatus, [...REVIEW_FROM[action]])));
}

export async function removeCopy(orgId: string, id: string) {
  return (await db.forOrg(orgId).delete(copyGenerations, eq(copyGenerations.id, id))).length > 0;
}
