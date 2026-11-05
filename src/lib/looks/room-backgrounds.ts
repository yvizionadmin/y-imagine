import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assetUrl, deleteAsset, saveAsset } from "@/lib/storage/assets";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Room template backdrops per org (Shop the Look → Room Backgrounds). New orgs are seeded with
// a starter set so the builder works before an admin uploads their own.

export type RoomBackground = {
  id: string;
  orgId: string;
  name: string;
  roomType: string;
  style: string;
  assetId: string;
  mimeType: string;
  active: boolean;
  createdAt: string;
};

export type RoomBackgroundView = Omit<RoomBackground, "orgId" | "mimeType"> & { imageUrl: string };

const { roomBackgrounds, organizations } = schema;
const SEED = [
  { file: "living-room.png", name: "Nordic Living Room", roomType: "livingRoom", style: "scandinavian" },
  { file: "minimalist-studio.png", name: "Minimalist Concrete Studio", roomType: "livingRoom", style: "minimalist" },
  { file: "luxury-loft.png", name: "Luxury Loft Lounge", roomType: "livingRoom", style: "luxury" },
];

export const toBackgroundView = (b: RoomBackground): RoomBackgroundView => ({
  id: b.id,
  name: b.name,
  roomType: b.roomType,
  style: b.style,
  assetId: b.assetId,
  active: b.active,
  createdAt: b.createdAt,
  imageUrl: assetUrl(b.assetId),
});

export async function listRoomBackgrounds(orgId: string): Promise<RoomBackground[]> {
  const org = db.forOrg(orgId);
  const all = await org.select(roomBackgrounds, undefined, { orderBy: [asc(roomBackgrounds.createdAt)] });
  if (all.length > 0) return all;
  // Claim the one-time seed; a concurrent request (or an admin who deleted them all) gets none.
  const claimed = await db
    .update(organizations)
    .set({ roomBackgroundsSeeded: true })
    .where(and(eq(organizations.id, orgId), eq(organizations.roomBackgroundsSeeded, false)))
    .returning({ id: organizations.id });
  if (claimed.length === 0) return all;
  const seeded = [];
  for (const seed of SEED) {
    const bytes = await readFile(path.join(process.cwd(), "public", "scenes", seed.file));
    const assetId = await saveAsset(orgId, bytes, "image/png", "room-background");
    seeded.push({ id: randomUUID(), name: seed.name, roomType: seed.roomType, style: seed.style, assetId, mimeType: "image/png", active: true });
  }
  return org.insert(roomBackgrounds, seeded);
}

export async function insertRoomBackground(input: Omit<RoomBackground, "id" | "createdAt">): Promise<RoomBackground> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(roomBackgrounds, { ...values, id: randomUUID() });
  return row;
}

export async function updateRoomBackground(orgId: string, id: string, patch: Partial<Pick<RoomBackground, "name" | "roomType" | "style" | "active">>) {
  await db.forOrg(orgId).update(roomBackgrounds, patch, eq(roomBackgrounds.id, id));
}

export async function removeRoomBackground(orgId: string, id: string) {
  const [removed] = await db.forOrg(orgId).delete(roomBackgrounds, eq(roomBackgrounds.id, id));
  if (removed) await deleteAsset(orgId, removed.assetId, removed.mimeType);
}
