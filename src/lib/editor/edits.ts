import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deleteAsset } from "@/lib/storage/assets";
import type { EditorMedia } from "./media";
import type { EditTimeline } from "./timeline";

// Repository for video editor projects (the `video_edits` table). Tenant data: always through
// db.forOrg, except the scheduled stale-render sweep, which spans orgs like the other maintenance jobs.

export type EditStatus = "draft" | "pending" | "running" | "ok" | "failed";
export type VideoEdit = typeof schema.videoEdits.$inferSelect;

const { videoEdits } = schema;

/** A `running` render older than this died with its process (deploy, crash). */
const STALE_RENDER_MS = 20 * 60_000;
/** Renders one org can have waiting or running at once (FFmpeg is heavy on the worker's CPU). */
export const MAX_OPEN_RENDERS = 2;

export async function insertEdit(input: { orgId: string; name: string; timeline: EditTimeline; createdBy: string; createdById: string }) {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(videoEdits, { ...values, id: randomUUID(), media: [], status: "draft" });
  return row;
}

export async function getEdit(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await db.forOrg(orgId).first(videoEdits, eq(videoEdits.id, id))) ?? null;
}

export async function listEdits(orgId: string, limit = 50) {
  return db.forOrg(orgId).select(videoEdits, undefined, { orderBy: [desc(videoEdits.updatedAt)], limit });
}

export async function countEdits(orgId: string) {
  return (await db.forOrg(orgId).select(videoEdits)).length;
}

/** Saves the name and timeline. A finished export stays until the next one replaces it. */
export async function saveEdit(orgId: string, id: string, patch: { name: string; timeline: EditTimeline }) {
  const [row] = await db.forOrg(orgId).update(videoEdits, { ...patch, updatedAt: new Date().toISOString() }, eq(videoEdits.id, id));
  return row ?? null;
}

export async function addEditMedia(orgId: string, id: string, media: EditorMedia) {
  const [row] = await db
    .forOrg(orgId)
    .update(videoEdits, { media: sql`${videoEdits.media} || ${JSON.stringify([media])}::jsonb` as unknown as EditorMedia[], updatedAt: new Date().toISOString() }, eq(videoEdits.id, id));
  return row ?? null;
}

/** Queues an export; refused (null) while one is already waiting or running for this project. */
export async function queueRender(orgId: string, id: string) {
  const [row] = await db
    .forOrg(orgId)
    .update(
      videoEdits,
      { status: "pending", error: null, updatedAt: new Date().toISOString() },
      and(eq(videoEdits.id, id), inArray(videoEdits.status, ["draft", "ok", "failed"])),
    );
  return row ?? null;
}

export async function countOpenRenders(orgId: string) {
  return (await db.forOrg(orgId).select(videoEdits, inArray(videoEdits.status, ["pending", "running"]))).length;
}

/** Takes a pending render for this run; null when another run already has it (safe to run twice). */
export async function claimRender(orgId: string, id: string) {
  const [row] = await db
    .forOrg(orgId)
    .update(videoEdits, { status: "running", updatedAt: new Date().toISOString() }, and(eq(videoEdits.id, id), eq(videoEdits.status, "pending")));
  return row ?? null;
}

export async function finishRender(
  orgId: string,
  id: string,
  patch: { status: "ok"; outputAssetId: string; outputMime: string; outputSeconds: number } | { status: "failed"; error: string },
) {
  const now = new Date().toISOString();
  const [row] = await db
    .forOrg(orgId)
    .update(videoEdits, { error: null, ...patch, updatedAt: now, renderedAt: now }, and(eq(videoEdits.id, id), eq(videoEdits.status, "running")));
  return row ?? null;
}

/** Deletes projects with their uploads and exports (Studio videos they used are left alone). */
export async function removeEdits(orgId: string, edits: Pick<VideoEdit, "id" | "media" | "outputAssetId" | "outputMime">[]) {
  if (!edits.length) return;
  const files = edits.flatMap((e) => [
    ...e.media.map((m) => [m.assetId, m.mimeType] as const),
    ...(e.outputAssetId && e.outputMime ? [[e.outputAssetId, e.outputMime] as const] : []),
  ]);
  // Files first: deleting one twice is harmless, so if this fails part-way the next run finishes it.
  await Promise.all(files.map(([assetId, mime]) => deleteAsset(orgId, assetId, mime)));
  await db.forOrg(orgId).delete(videoEdits, inArray(videoEdits.id, edits.map((e) => e.id)));
}

/** Project states the video retention sweep may remove (never one that is rendering). */
export const IDLE_EDIT_STATUSES = ["draft", "ok", "failed"] as const;

/** Projects not changed since the cutoff and not rendering (the video retention sweep). */
export async function listIdleEdits(orgId: string, cutoff: string, limit: number) {
  return db.forOrg(orgId).select(videoEdits, and(inArray(videoEdits.status, [...IDLE_EDIT_STATUSES]), lt(videoEdits.updatedAt, cutoff)), { limit });
}

/** Fails renders stuck in `running` (scheduled, all orgs). */
export async function releaseStaleRenders() {
  const now = new Date().toISOString();
  const rows = await db
    .update(videoEdits)
    .set({ status: "failed", error: "timed_out", updatedAt: now, renderedAt: now })
    .where(and(eq(videoEdits.status, "running"), lt(videoEdits.updatedAt, new Date(Date.now() - STALE_RENDER_MS).toISOString())))
    .returning({ id: videoEdits.id });
  return rows.length;
}
