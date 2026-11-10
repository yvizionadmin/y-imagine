import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { categoryBackgrounds, sceneBackgroundId, uploadedAssetId } from "@/features/looks/config";
import type { ImageInput } from "@/lib/ai/types";
import { assetUrl, deleteAsset, getAsset, saveAsset } from "@/lib/storage/assets";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Room template backdrops per org (Shop the Look → Room Backgrounds). New orgs are seeded with
// a starter set so the builder works before an admin uploads their own. Each background belongs to
// one product category; a category without any falls back to its preset scenes.

export type RoomBackground = {
  id: string;
  orgId: string;
  name: string;
  roomType: string;
  category: string;
  style: string;
  assetId: string;
  mimeType: string;
  active: boolean;
  /** From the starter set (copies of built-in scenes), not uploaded by the team. */
  starter: boolean;
  createdAt: string;
};

export type RoomBackgroundView = Omit<RoomBackground, "orgId" | "mimeType" | "starter"> & { imageUrl: string };

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
  category: b.category,
  style: b.style,
  assetId: b.assetId,
  active: b.active,
  createdAt: b.createdAt,
  imageUrl: assetUrl(b.assetId),
});

export async function listRoomBackgrounds(orgId: string, { seed = true }: { seed?: boolean } = {}): Promise<RoomBackground[]> {
  const org = db.forOrg(orgId);
  const all = await org.select(roomBackgrounds, undefined, { orderBy: [asc(roomBackgrounds.createdAt)] });
  if (all.length > 0 || !seed) return all;
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
    seeded.push({ id: randomUUID(), name: seed.name, roomType: seed.roomType, category: "furniture", style: seed.style, assetId, mimeType: "image/png", active: true, starter: true });
  }
  return org.insert(roomBackgrounds, seeded);
}

/** Background photos people can upload (Room Backgrounds, a Look's own background, a team scene). */
export const BACKGROUND_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Stores an uploaded background as WebP, at most 2048 px on a side; returns its asset id, or null
 * for a file of the wrong type, too large, or that isn't a readable image whatever its declared type.
 */
export async function storeBackgroundImage(orgId: string, file: unknown, kind: "room-background" | "look-background"): Promise<string | null> {
  if (!(file instanceof File) || !BACKGROUND_IMAGE_TYPES.includes(file.type) || file.size > BACKGROUND_MAX_BYTES) return null;
  let webp: Buffer;
  try {
    webp = await sharp(new Uint8Array(await file.arrayBuffer())).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  } catch {
    return null;
  }
  return saveAsset(orgId, webp, "image/webp", kind);
}

/** One of the org's backgrounds, or null (another org's id finds nothing). */
export async function getRoomBackground(orgId: string, id: string): Promise<RoomBackground | null> {
  return db.forOrg(orgId).first(roomBackgrounds, eq(roomBackgrounds.id, id));
}

export async function insertRoomBackground(input: Omit<RoomBackground, "id" | "createdAt" | "starter">): Promise<RoomBackground> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(roomBackgrounds, { ...values, id: randomUUID() });
  return row;
}

export async function updateRoomBackground(orgId: string, id: string, patch: Partial<Pick<RoomBackground, "name" | "roomType" | "category" | "style" | "active">>) {
  await db.forOrg(orgId).update(roomBackgrounds, patch, eq(roomBackgrounds.id, id));
}

export async function removeRoomBackground(orgId: string, id: string) {
  const [removed] = await db.forOrg(orgId).delete(roomBackgrounds, eq(roomBackgrounds.id, id));
  if (removed) await deleteAsset(orgId, removed.assetId, removed.mimeType);
}

export type LookBackground = { id: string; name: string | null; roomType: string | null; load: () => Promise<ImageInput | null> };

const SCENE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * The background a look renders on: the merchant's uploaded image, or `id` when it is one of the
 * category's choices (see categoryBackgrounds), else the category's first. Null only when the
 * category has none at all.
 */
export async function resolveLookBackground(orgId: string, category: string, id: string | null): Promise<LookBackground | null> {
  const uploaded = uploadedAssetId(id);
  // getAsset is org-scoped, so another org's asset id resolves to nothing and falls through.
  const upload = uploaded ? await getAsset(orgId, uploaded) : null;
  if (upload) {
    return {
      id: id!,
      name: null,
      roomType: null,
      load: async () => ({ bytes: new Uint8Array(upload.bytes), mimeType: upload.mimeType, name: "uploaded-background" }),
    };
  }
  const { own, scenes } = categoryBackgrounds(category, await listRoomBackgrounds(orgId));
  const background = own.find((b) => b.id === id) ?? own[0];
  if (background) {
    return {
      id: background.id,
      name: background.name,
      roomType: background.roomType,
      load: async () => {
        const asset = await getAsset(orgId, background.assetId);
        return asset ? { bytes: new Uint8Array(asset.bytes), mimeType: asset.mimeType, name: background.name } : null;
      },
    };
  }
  const scene = scenes.find((s) => sceneBackgroundId(s.key) === id) ?? scenes[0];
  if (!scene) return null;
  return {
    id: sceneBackgroundId(scene.key),
    name: null,
    roomType: null,
    load: async () => ({
      bytes: new Uint8Array(await readFile(path.join(process.cwd(), "public", scene.image))),
      mimeType: SCENE_TYPES[path.extname(scene.image)] ?? "image/jpeg",
      name: scene.key,
    }),
  };
}
