import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { blobStore } from "./blob-store";

// Org-scoped binary storage (generated images, look products, room backgrounds). The `assets`
// table indexes each object; bytes live in the blob store (S3-compatible bucket, or local disk in
// development). Callers only see opaque asset ids, and /api/assets/[id] serves an asset only to its org.

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
/** Studio video clips; kept apart so upload checks that call isAssetMime stay image-only. */
const VIDEO_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const ALL_EXT: Record<string, string> = { ...EXT, ...VIDEO_EXT };
const ID = /^[0-9a-f-]{36}$/;
const ORG = /^[A-Za-z0-9_-]{1,64}$/;

export type AssetKind = "generation" | "look-product" | "room-background" | "look-background" | "look" | "swatch" | "video" | "video-frame";

const { assets } = schema;

/** Image types accepted as uploads and stored as image assets. */
export const isAssetMime = (mime: string) => mime in EXT;
export const isVideoMime = (mime: string) => mime in VIDEO_EXT;
export const assetUrl = (id: string) => `/api/assets/${id}`;

function key(orgId: string, id: string, mime: string) {
  if (!ORG.test(orgId) || !ID.test(id) || !(mime in ALL_EXT)) throw new Error("invalid asset reference");
  return `${orgId}/${id}.${ALL_EXT[mime]}`;
}

export async function saveAsset(orgId: string, bytes: Uint8Array, mime: string, kind: AssetKind = "generation") {
  const id = randomUUID();
  await blobStore().put(key(orgId, id, mime), bytes, mime);
  await db.forOrg(orgId).insert(assets, { id, mimeType: mime, kind, byteSize: bytes.byteLength });
  return id;
}

/** The asset if it belongs to this org, else null. */
export async function getAsset(orgId: string, id: string) {
  if (!ID.test(id)) return null;
  const record = await db.forOrg(orgId).first(assets, eq(assets.id, id));
  if (!record) return null;
  return { mimeType: record.mimeType, bytes: await blobStore().get(key(orgId, id, record.mimeType)) };
}

export async function readAsset(orgId: string, id: string, mime: string) {
  return blobStore().get(key(orgId, id, mime));
}

export async function deleteAsset(orgId: string, id: string, mime: string) {
  await blobStore().delete(key(orgId, id, mime));
  await db.forOrg(orgId).delete(assets, eq(assets.id, id));
}
