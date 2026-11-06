import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { VideoAspectRatio } from "@/lib/ai/types";
import type { VideoResolution } from "@/lib/credits";
import { db, schema } from "@/lib/db";

// Repository for Studio video jobs (the `video_jobs` table). Tenant data: always through db.forOrg,
// except the scheduled stale-job sweep, which spans orgs like the other maintenance jobs.

export type VideoJobStatus = "pending" | "running" | "ok" | "failed";
export type VideoSettings = { aspectRatio: VideoAspectRatio; seconds: number; resolution: VideoResolution; camera: string; motion: string };

export type VideoJob = {
  id: string;
  orgId: string;
  status: VideoJobStatus;
  prompt: string;
  settings: VideoSettings;
  startFrameAssetId: string | null;
  startFrameMime: string | null;
  assetId: string | null;
  mimeType: string | null;
  credits: number;
  provider: string | null;
  model: string | null;
  error: string | null;
  createdBy: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

const { videoJobs } = schema;

/** A `running` job older than this died with its process (deploy, crash). Video calls take up to 10 min. */
const STALE_RUNNING_MS = 20 * 60_000;
/** Jobs one org can have waiting or running at once, so one org can't fill the queue for everyone. */
export const MAX_OPEN_VIDEO_JOBS = 3;

const toJob = (row: typeof videoJobs.$inferSelect) => row as VideoJob;

export async function insertVideoJob(input: Pick<VideoJob, "orgId" | "prompt" | "settings" | "startFrameAssetId" | "startFrameMime" | "credits" | "createdBy" | "createdById">) {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(videoJobs, { ...values, id: randomUUID(), status: "pending" });
  return toJob(row);
}

export async function countOpenVideoJobs(orgId: string) {
  return (await db.forOrg(orgId).select(videoJobs, inArray(videoJobs.status, ["pending", "running"]))).length;
}

/** Takes a pending job for this run; null when another run already has it (safe to run twice). */
export async function claimVideoJob(orgId: string, id: string) {
  const [row] = await db
    .forOrg(orgId)
    .update(videoJobs, { status: "running", updatedAt: new Date().toISOString() }, and(eq(videoJobs.id, id), eq(videoJobs.status, "pending")));
  return row ? toJob(row) : null;
}

export async function finishVideoJob(
  orgId: string,
  id: string,
  patch: { status: "ok" | "failed" | "pending"; error?: string | null; assetId?: string | null; mimeType?: string | null; provider?: string | null; model?: string | null },
) {
  const now = new Date().toISOString();
  await db.forOrg(orgId).update(videoJobs, { error: null, ...patch, updatedAt: now, finishedAt: patch.status === "pending" ? null : now }, eq(videoJobs.id, id));
}

export async function listRecentVideoJobs(orgId: string, limit: number) {
  return (await db.forOrg(orgId).select(videoJobs, undefined, { orderBy: [desc(videoJobs.createdAt)], limit })).map(toJob);
}

export async function getVideoJobs(orgId: string, ids: string[]) {
  return ids.length ? (await db.forOrg(orgId).select(videoJobs, inArray(videoJobs.id, ids))).map(toJob) : [];
}

/** Fails jobs stuck in `running` (scheduled, all orgs). Their credit reservation already lapsed. */
export async function releaseStaleVideoJobs() {
  const now = new Date().toISOString();
  const rows = await db
    .update(videoJobs)
    .set({ status: "failed", error: "timed_out", updatedAt: now, finishedAt: now })
    .where(and(eq(videoJobs.status, "running"), lt(videoJobs.updatedAt, new Date(Date.now() - STALE_RUNNING_MS).toISOString())))
    .returning({ id: videoJobs.id });
  return rows.length;
}
