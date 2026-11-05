import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { LookItem } from "@/features/looks/config";

// Saved shop-the-look scenes. `isBoard` marks looks promoted to Mood Boards; `mode` becomes
// "regenerated" once the scene is re-rendered (regenerate or product swap).

export type LookMode = "generated" | "regenerated";

export type Look = {
  id: string;
  orgId: string;
  title: string;
  prompt: string;
  style: string | null;
  aspectRatio: string;
  backgroundId: string | null;
  roomType: string | null;
  category: string;
  subcategory: string | null;
  items: LookItem[];
  resultAssetId: string;
  isBoard: boolean;
  mode: LookMode;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const { looks } = schema;

export async function listLooks(orgId: string): Promise<Look[]> {
  return db.forOrg(orgId).select(looks, undefined, { orderBy: [asc(looks.createdAt)] });
}

export async function getLook(orgId: string, id: string): Promise<Look | null> {
  return db.forOrg(orgId).first(looks, eq(looks.id, id));
}

export async function insertLook(input: Omit<Look, "id" | "createdAt" | "updatedAt" | "mode"> & { mode?: LookMode }): Promise<Look> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(looks, { ...values, id: randomUUID() });
  return row;
}

export async function updateLook(orgId: string, id: string, patch: Partial<Omit<Look, "id" | "orgId" | "createdAt">>) {
  await db.forOrg(orgId).update(looks, { ...patch, updatedAt: new Date().toISOString() }, eq(looks.id, id));
}

export async function removeLook(orgId: string, id: string) {
  await db.forOrg(orgId).delete(looks, eq(looks.id, id));
}
