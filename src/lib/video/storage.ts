import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, gte, inArray, lt, lte, max, min, or, sum, type SQL } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { notifyVideoCleanup, quietly } from "@/lib/email/notify";
import { reportError } from "@/lib/observability/report";
import { PLANS, type PlanId } from "@/lib/plans";
import { deleteAsset } from "@/lib/storage/assets";
import { IDLE_EDIT_STATUSES, listIdleEdits, removeEdits } from "@/lib/editor/edits";

// Studio video storage: each plan has room for clips (and their start frames, and the video editor's
// uploads and exports), and clips older than the plan's retention are removed by the `cleanup-videos`
// schedule, as are editor projects left unchanged for that long. Usage is read from the `assets`
// index (byte sizes recorded at save time), so it costs one query and no bucket listing.
//
// Nothing is removed without notice: the same schedule first emails the org's admins about what
// reaches its removal date within CLEANUP_NOTICE_DAYS (a `video_cleanup_notices` row), the Studio
// shows it, and a video is only removed once a notice covering it is that old. So a downgrade, which
// shortens retention, still gives a week before anything goes.

const { assets, generations, organizations, videoCleanupNotices, videoEdits, videoJobs } = schema;
const VIDEO_KINDS = ["video", "video-frame", "editor-media", "edit-render"] as const;
const DAY_MS = 24 * 60 * 60_000;
/** Jobs removed per org per run, so one big org can't hold the sweep; the rest go on the next run. */
const CLEANUP_BATCH = 200;
/** Days between the warning and the removal. */
export const CLEANUP_NOTICE_DAYS = 7;
/** The schedule doesn't start at the same millisecond each day; a notice sent a little under 7 days ago counts. */
const RUN_SLACK_MS = 6 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

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

/** The latest time a video can have been made (or a project last changed) and be removed within the notice period. */
const warnThrough = (plan: PlanId, now: number) => iso(now - (PLANS[plan].videoRetentionDays - CLEANUP_NOTICE_DAYS) * DAY_MS);

/**
 * History videos and idle editor projects made / last changed at or before `through` (and after
 * `after`), with the oldest time among them. Failed jobs have no clip and aren't counted.
 */
async function dueForCleanup(orgId: string, through: string, after: string | null) {
  const range = (column: typeof generations.createdAt | typeof videoEdits.updatedAt): SQL => and(lte(column, through), after ? gt(column, after) : undefined)!;
  const [[videos], [projects]] = await Promise.all([
    db
      .select({ n: count(), oldest: min(generations.createdAt) })
      .from(generations)
      .where(and(eq(generations.orgId, orgId), eq(generations.mode, "video"), range(generations.createdAt))),
    db
      .select({ n: count(), oldest: min(videoEdits.updatedAt) })
      .from(videoEdits)
      .where(and(eq(videoEdits.orgId, orgId), inArray(videoEdits.status, [...IDLE_EDIT_STATUSES]), range(videoEdits.updatedAt))),
  ]);
  const oldest = [videos.oldest, projects.oldest].filter((t): t is string => !!t).sort()[0] ?? null;
  return { count: videos.n + projects.n, oldest };
}

/** What the Studio shows: how many videos / projects go within the notice period, and from when. */
export async function videoCleanupDue(orgId: string, plan: PlanId, now = Date.now()): Promise<{ count: number; date: string } | null> {
  const due = await dueForCleanup(orgId, warnThrough(plan, now), null);
  if (!due.count || !due.oldest) return null;
  // The oldest goes at the end of its retention, but never sooner than a week after the notice that
  // covers it (or a week from now, when tonight's run hasn't announced it yet).
  const [notice] = await db
    .select({ sentAt: videoCleanupNotices.sentAt })
    .from(videoCleanupNotices)
    .where(and(eq(videoCleanupNotices.orgId, orgId), gte(videoCleanupNotices.through, due.oldest)))
    .orderBy(asc(videoCleanupNotices.sentAt))
    .limit(1);
  const announced = (notice ? Date.parse(notice.sentAt) : now) + CLEANUP_NOTICE_DAYS * DAY_MS;
  const expires = Date.parse(due.oldest) + PLANS[plan].videoRetentionDays * DAY_MS;
  return { count: due.count, date: iso(Math.max(announced, expires, now)) };
}

/**
 * Scheduled, all orgs (before the removal): announces videos and projects that newly fall within
 * the notice period, with one email to the org's admins and a notice row. Each warning is audited.
 */
export async function warnBeforeCleanup(now = Date.now()) {
  const summary = { orgs: 0, failed: 0 };
  const orgs = await db.select({ id: organizations.id, name: organizations.name, plan: organizations.plan }).from(organizations);
  for (const org of orgs) {
    try {
      const through = warnThrough(org.plan, now);
      const [last] = await db.select({ through: max(videoCleanupNotices.through) }).from(videoCleanupNotices).where(eq(videoCleanupNotices.orgId, org.id));
      const due = await dueForCleanup(org.id, through, last?.through ?? null);
      if (!due.count || !due.oldest) continue;
      const removeOn = iso(Math.max(now + CLEANUP_NOTICE_DAYS * DAY_MS, Date.parse(due.oldest) + PLANS[org.plan].videoRetentionDays * DAY_MS));
      await db.forOrg(org.id).insert(videoCleanupNotices, { id: randomUUID(), through, count: due.count, sentAt: iso(now) });
      await quietly("video cleanup", () => notifyVideoCleanup({ orgId: org.id, orgName: org.name, count: due.count, days: PLANS[org.plan].videoRetentionDays, removeOn }));
      await recordAudit({ orgId: org.id, action: "video.cleanup_warned", actor: "Imagine AI", target: String(due.count), meta: { removeOn: removeOn.slice(0, 10) } });
      summary.orgs++;
    } catch (error) {
      summary.failed++;
      reportError("video cleanup warning failed", error, { orgId: org.id });
    }
  }
  return summary;
}

/** The latest `through` announced at least CLEANUP_NOTICE_DAYS ago: nothing newer may be removed yet. */
async function announcedThrough(orgId: string, now: number) {
  const [row] = await db
    .select({ through: max(videoCleanupNotices.through) })
    .from(videoCleanupNotices)
    .where(and(eq(videoCleanupNotices.orgId, orgId), lte(videoCleanupNotices.sentAt, iso(now - CLEANUP_NOTICE_DAYS * DAY_MS + RUN_SLACK_MS))));
  return row?.through ?? null;
}

/**
 * Scheduled, all orgs: first sends the warnings (`warnBeforeCleanup`), then removes finished videos
 * older than the org's plan retention, History videos and idle editor projects of the same age, once a
 * notice covering them is a week old (failed jobs at the retention alone). Open jobs are never touched.
 * Each org's removal is audited.
 */
export async function cleanupOldVideos(now = Date.now()) {
  const warned = await warnBeforeCleanup(now);
  const summary = { orgs: 0, removed: 0, failed: 0, warned: warned.orgs };
  const plans = await db.select({ id: organizations.id, plan: organizations.plan }).from(organizations);
  for (const org of plans) {
    try {
      const expired = iso(now - PLANS[org.plan].videoRetentionDays * DAY_MS);
      const announced = await announcedThrough(org.id, now);
      // Clips and projects wait for their notice; failed jobs (no clip to lose) only for the retention.
      const cutoff = announced ? (announced < expired ? announced : expired) : null;
      const scoped = db.forOrg(org.id);
      const jobs = await scoped.select(
        videoJobs,
        or(and(eq(videoJobs.status, "failed"), lt(videoJobs.createdAt, expired)), cutoff ? and(eq(videoJobs.status, "ok"), lt(videoJobs.createdAt, cutoff)) : undefined),
        { limit: CLEANUP_BATCH },
      );
      // History videos with no job row at all; one whose job exists is removed together with that job.
      const old = cutoff ? await scoped.select(generations, and(eq(generations.mode, "video"), lt(generations.createdAt, cutoff)), { limit: CLEANUP_BATCH }) : [];
      const withJob = old.length ? await scoped.select(videoJobs, inArray(videoJobs.assetId, old.map((g) => g.assetId))) : [];
      const known = new Set(withJob.map((j) => j.assetId));
      const orphans = old.filter((g) => !known.has(g.assetId));
      const edits = cutoff ? await listIdleEdits(org.id, cutoff, CLEANUP_BATCH) : [];
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
