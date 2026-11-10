import "server-only";
import { and, eq, inArray, lt, sum } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { reportError } from "@/lib/observability/report";
import { PLANS, type PlanId } from "@/lib/plans";
import { deleteAsset } from "@/lib/storage/assets";
import { listIdleEdits, removeEdits } from "@/lib/editor/edits";

// Studio video storage: each plan has room for clips (and their start frames, and the video editor's
// uploads and exports), and clips older than the plan's retention are removed by the `cleanup-videos`
// schedule, as are editor projects left unchanged for that long. Usage is read from the `assets`
// index (byte sizes recorded at save time), so it costs one query and no bucket listing.

const { assets, generations, organizations, videoJobs } = schema;
const VIDEO_KINDS = ["video", "video-frame", "editor-media", "edit-render"] as const;
const DAY_MS = 24 * 60 * 60_000;
/** Jobs removed per org per run, so one big org can't hold the sweep; the rest go on the next run. */
const CLEANUP_BATCH = 200;

export type VideoStorage = { used: number; limit: number; retentionDays: number; full: boolean };

/** Bytes used by this org's clips and start frames. */
export async function videoBytesUsed(orgId: string) {
  const [row] = await db
    .select({ total: sum(assets.byteSize).mapWith(Number) })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), inArray(assets.kind, [...VIDEO_KINDS])));
  return row?.total ?? 0;
}

export async function videoStorageFor(orgId: string, plan: PlanId): Promise<VideoStorage> {
  const used = await videoBytesUsed(orgId);
  const { videoStorageBytes: limit, videoRetentionDays: retentionDays } = PLANS[plan];
  return { used, limit, retentionDays, full: used >= limit };
}

/**
 * Deletes video jobs with their clip, start frame and History item. Used by the schedule and by
 * History's delete, so no file is left behind.
 */
export async function removeVideoJobs(orgId: string, jobs: { id: string; assetId: string | null; mimeType: string | null; startFrameAssetId: string | null; startFrameMime: string | null }[]) {
  if (!jobs.length) return;
  const scoped = db.forOrg(orgId);
  const clipIds = jobs.flatMap((j) => (j.assetId ? [j.assetId] : []));
  const files = jobs.flatMap((j) => [
    ...(j.assetId && j.mimeType ? [[j.assetId, j.mimeType]] : []),
    ...(j.startFrameAssetId && j.startFrameMime ? [[j.startFrameAssetId, j.startFrameMime]] : []),
  ]);
  // Files first: deleting one twice is harmless, so if this fails part-way the next run finds the job and finishes.
  await Promise.all(files.map(([id, mime]) => deleteAsset(orgId, id, mime)));
  if (clipIds.length) await scoped.delete(generations, and(eq(generations.mode, "video"), inArray(generations.assetId, clipIds)));
  await scoped.delete(videoJobs, inArray(videoJobs.id, jobs.map((j) => j.id)));
}

/**
 * Scheduled, all orgs: removes finished or failed videos older than the org's plan retention, and
 * History videos of the same age. Open jobs are never touched. Each org's removal is audited.
 */
export async function cleanupOldVideos(now = Date.now()) {
  const summary = { orgs: 0, removed: 0, failed: 0 };
  const plans = await db.select({ id: organizations.id, plan: organizations.plan }).from(organizations);
  for (const org of plans) {
    const cutoff = new Date(now - PLANS[org.plan].videoRetentionDays * DAY_MS).toISOString();
    try {
      const scoped = db.forOrg(org.id);
      const jobs = await scoped.select(videoJobs, and(inArray(videoJobs.status, ["ok", "failed"]), lt(videoJobs.createdAt, cutoff)), { limit: CLEANUP_BATCH });
      // History videos with no job row at all; one whose job exists is removed together with that job.
      const old = await scoped.select(generations, and(eq(generations.mode, "video"), lt(generations.createdAt, cutoff)), { limit: CLEANUP_BATCH });
      const withJob = old.length ? await scoped.select(videoJobs, inArray(videoJobs.assetId, old.map((g) => g.assetId))) : [];
      const known = new Set(withJob.map((j) => j.assetId));
      const orphans = old.filter((g) => !known.has(g.assetId));
      const edits = await listIdleEdits(org.id, cutoff, CLEANUP_BATCH);
      if (!jobs.length && !orphans.length && !edits.length) continue;
      await removeVideoJobs(org.id, jobs);
      await removeEdits(org.id, edits);
      if (orphans.length) {
        await scoped.delete(generations, inArray(generations.id, orphans.map((g) => g.id)));
        await Promise.all(orphans.map((g) => deleteAsset(org.id, g.assetId, g.mimeType)));
      }
      const count = jobs.length + orphans.length + edits.length;
      summary.orgs++;
      summary.removed += count;
      await recordAudit({
        orgId: org.id,
        action: "video.cleaned_up",
        actor: "Imagine AI",
        target: String(count),
        meta: { retentionDays: String(PLANS[org.plan].videoRetentionDays) },
      });
    } catch (error) {
      summary.failed++;
      reportError("video cleanup failed", error, { orgId: org.id });
    }
  }
  return summary;
}
