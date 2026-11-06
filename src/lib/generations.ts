import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Repository for saved generations (History), the `generations` table. Image bytes live in asset storage, referenced by assetId.

export type GenerationMode = "create" | "lifestyle" | "recolor" | "aplus";
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
  createdBy: string;
  createdAt: string;
};

const { generations } = schema;

export async function listGenerations(orgId: string): Promise<Generation[]> {
  return db.forOrg(orgId).select(generations, undefined, { orderBy: [asc(generations.createdAt)] });
}

/** Newest generations of one mode (the Studio's recent results). */
export async function listRecentGenerations(orgId: string, mode: GenerationMode, limit: number): Promise<Generation[]> {
  return db.forOrg(orgId).select(generations, and(eq(generations.mode, mode)), { orderBy: [desc(generations.createdAt)], limit });
}

export async function insertGeneration(input: Omit<Generation, "id" | "status" | "publishedTo" | "publishedAt" | "publishError" | "createdAt">): Promise<Generation> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(generations, { ...values, id: randomUUID(), status: "pending" });
  return row;
}

export async function updateGenerations(orgId: string, ids: string[], patch: Partial<Pick<Generation, "status" | "publishedTo" | "publishedAt" | "publishError">>) {
  if (ids.length === 0) return;
  await db.forOrg(orgId).update(generations, patch, inArray(generations.id, ids));
}

export async function removeGenerations(orgId: string, ids: string[]): Promise<Generation[]> {
  if (ids.length === 0) return [];
  return db.forOrg(orgId).delete(generations, inArray(generations.id, ids));
}

export async function getGenerations(orgId: string, ids: string[]): Promise<Generation[]> {
  return ids.length ? db.forOrg(orgId).select(generations, inArray(generations.id, ids)) : [];
}
