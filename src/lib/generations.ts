import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { REVIEW_FROM, REVIEW_TO, type ReviewAction, type ReviewStatus } from "@/lib/copy/review-status";
import { db, schema } from "@/lib/db";

// Repository for saved generations (History), the `generations` table. Image bytes live in asset storage, referenced by assetId.

export type GenerationMode = "create" | "video" | "lifestyle" | "recolor" | "aplus";
export type PublishStatus = "pending" | "uploaded" | "failed";

export type Generation = {
  id: string;
  orgId: string;
  mode: GenerationMode;
  sku: string;
  title: string;
  assetId: string;
  mimeType: string;
  width: number;
  height: number;
  settings: Record<string, string | null>;
  provider: string;
  model: string;
  status: PublishStatus;
  publishedTo: string | null;
  publishedAt: string | null;
  publishError: string | null;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string;
  createdById: string | null;
  createdAt: string;
};

const { generations, organizations } = schema;

export async function listGenerations(orgId: string): Promise<Generation[]> {
  return db.forOrg(orgId).select(generations, undefined, { orderBy: [asc(generations.createdAt)] });
}

/** One person's newest generations of one mode, optionally for one SKU (a tool's results feed). */
export async function listUserGenerations(orgId: string, mode: GenerationMode, createdBy: string, limit: number, sku?: string): Promise<Generation[]> {
  const where = and(eq(generations.mode, mode), eq(generations.createdBy, createdBy), sku === undefined ? undefined : eq(generations.sku, sku));
  return db.forOrg(orgId).select(generations, where, { orderBy: [desc(generations.createdAt)], limit });
}

/** Newest generations of one mode (the Studio's recent results). */
export async function listRecentGenerations(orgId: string, mode: GenerationMode, limit: number): Promise<Generation[]> {
  return db.forOrg(orgId).select(generations, and(eq(generations.mode, mode)), { orderBy: [desc(generations.createdAt)], limit });
}

export async function insertGeneration(input: Omit<Generation, "id" | "status" | "publishedTo" | "publishedAt" | "publishError" | "reviewStatus" | "reviewNote" | "reviewedBy" | "reviewedAt" | "createdAt">): Promise<Generation> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(generations, { ...values, id: randomUUID(), status: "pending" });
  return row;
}

export async function updateGenerations(orgId: string, ids: string[], patch: Partial<Pick<Generation, "status" | "publishedTo" | "publishedAt" | "publishError">>) {
  if (ids.length === 0) return;
  await db.forOrg(orgId).update(generations, patch, inArray(generations.id, ids));
}

/** Moves images only from the statuses an action may start from, so repeats do nothing. Videos have no review. */
export async function reviewGenerations(orgId: string, ids: string[], action: ReviewAction, by: string, note: string | null = null): Promise<Generation[]> {
  if (!ids.length) return [];
  const review = action === "submit" ? { reviewNote: null, reviewedBy: null, reviewedAt: null } : { reviewNote: note, reviewedBy: by, reviewedAt: new Date().toISOString() };
  return db
    .forOrg(orgId)
    .update(generations, { reviewStatus: REVIEW_TO[action], ...review }, and(inArray(generations.id, ids), ne(generations.mode, "video"), inArray(generations.reviewStatus, [...REVIEW_FROM[action]])));
}

/** Whether the org only lets approved images be uploaded to its store. */
export async function imageApprovalRequired(orgId: string): Promise<boolean> {
  const [org] = await db.select({ required: organizations.requireImageApproval }).from(organizations).where(eq(organizations.id, orgId));
  return org?.required ?? false;
}

export async function setImageApprovalRequired(orgId: string, required: boolean) {
  await db.update(organizations).set({ requireImageApproval: required }).where(eq(organizations.id, orgId));
}

export async function removeGenerations(orgId: string, ids: string[]): Promise<Generation[]> {
  if (ids.length === 0) return [];
  return db.forOrg(orgId).delete(generations, inArray(generations.id, ids));
}

export async function getGenerations(orgId: string, ids: string[]): Promise<Generation[]> {
  return ids.length ? db.forOrg(orgId).select(generations, inArray(generations.id, ids)) : [];
}
