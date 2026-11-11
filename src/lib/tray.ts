import "server-only";
import { and, desc, eq, gte, inArray, notInArray, or } from "drizzle-orm";
import { countBatchItems } from "@/lib/copy/batches";
import { db, schema } from "@/lib/db";
import { countImageBatchItems } from "@/lib/image-batch/batches";

/** One piece of background work in the top bar's jobs tray (U4). */
export type TrayItem = {
  kind: "video" | "director" | "render" | "generateBulk" | "recolorBulk" | "aplusBulk" | "copyBulk" | "publish";
  id: string;
  /** Prompt, project or run name; for store uploads, empty (the count says it). */
  title: string;
  href: `/${string}`;
  state: "working" | "done" | "failed";
  /** Bulk runs: items finished of the total. Store uploads: images still uploading (done 0). */
  progress: { done: number; total: number } | null;
  /** When it started (working) or finished. */
  at: string;
};

export type TrayState = { running: TrayItem[]; finished: TrayItem[] };

/** Finished work stays in the tray this long. */
export const TRAY_FINISHED_MS = 30 * 60 * 1000;
const LIMIT = 20;

const iso = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString()) : new Date(0).toISOString());
const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

/**
 * The user's own background work: what is running now and what finished in the last half hour (videos, AI Director,
 * editor renders, bulk runs), plus the org's store uploads in progress. Read only.
 */
export async function trayFor(orgId: string, userId: string, now = Date.now()): Promise<TrayState> {
  const { videoJobs, directorProjects, videoEdits, imageBatches, copyBatches, generations } = schema;
  const scope = db.forOrg(orgId);
  const since = new Date(now - TRAY_FINISHED_MS).toISOString();

  const [videos, directors, edits, images, copies, publishing] = await Promise.all([
    scope.select(
      videoJobs,
      and(eq(videoJobs.createdById, userId), or(inArray(videoJobs.status, ["pending", "running"]), gte(videoJobs.finishedAt, since))),
      { orderBy: [desc(videoJobs.createdAt)], limit: LIMIT },
    ),
    scope.select(
      directorProjects,
      and(eq(directorProjects.createdById, userId), or(notInArray(directorProjects.status, ["done", "failed"]), gte(directorProjects.updatedAt, since))),
      { orderBy: [desc(directorProjects.updatedAt)], limit: LIMIT },
    ),
    scope.select(
      videoEdits,
      and(eq(videoEdits.createdById, userId), or(inArray(videoEdits.status, ["pending", "running"]), and(inArray(videoEdits.status, ["ok", "failed"]), gte(videoEdits.updatedAt, since)))),
      { orderBy: [desc(videoEdits.updatedAt)], limit: LIMIT },
    ),
    scope.select(imageBatches, and(eq(imageBatches.createdById, userId), or(eq(imageBatches.status, "running"), gte(imageBatches.finishedAt, since))), {
      orderBy: [desc(imageBatches.createdAt)],
      limit: LIMIT,
    }),
    scope.select(copyBatches, and(eq(copyBatches.createdById, userId), or(eq(copyBatches.status, "running"), gte(copyBatches.finishedAt, since))), {
      orderBy: [desc(copyBatches.createdAt)],
      limit: LIMIT,
    }),
    scope.select(generations, eq(generations.status, "publishing"), { limit: 500 }),
  ]);
  const [imageCounts, copyCounts] = await Promise.all([countImageBatchItems(orgId, images.map((b) => b.id)), countBatchItems(orgId, copies.map((b) => b.id))]);

  // AI Director runs its own scene videos and final render: the project stands for them.
  const directorEdits = new Set(directors.flatMap((p) => (p.editId ? [p.editId] : [])));
  const items: TrayItem[] = [
    ...videos.filter((v) => !v.settings.directorId).map((v): TrayItem => ({
      kind: "video",
      id: v.id,
      title: clip(v.prompt),
      href: "/home?mode=video",
      state: v.status === "ok" ? "done" : v.status === "failed" ? "failed" : "working",
      progress: null,
      at: iso(v.finishedAt ?? v.createdAt),
    })),
    ...directors.map((p): TrayItem => ({
      kind: "director",
      id: p.id,
      title: clip(p.title || p.idea),
      href: `/editor/director?project=${p.id}`,
      state: p.status === "done" ? "done" : p.status === "failed" ? "failed" : "working",
      progress: null,
      at: iso(p.updatedAt),
    })),
    ...edits.filter((e) => !directorEdits.has(e.id)).map((e): TrayItem => ({
      kind: "render",
      id: e.id,
      title: clip(e.name),
      href: `/editor?project=${e.id}`,
      state: e.status === "ok" ? "done" : e.status === "failed" ? "failed" : "working",
      progress: null,
      at: iso(e.updatedAt),
    })),
    ...images.map((b): TrayItem => {
      const c = imageCounts.get(b.id);
      return {
        kind: `${b.tool}Bulk`,
        id: b.id,
        title: clip(b.name),
        href: `/${b.tool}/bulk`,
        state: b.status === "running" ? "working" : (c?.failed ?? 0) > 0 ? "failed" : "done",
        progress: { done: (c?.done ?? 0) + (c?.failed ?? 0), total: b.total },
        at: iso(b.finishedAt ?? b.createdAt),
      };
    }),
    ...copies.map((b): TrayItem => {
      const c = copyCounts.get(b.id);
      return {
        kind: "copyBulk",
        id: b.id,
        title: clip(b.name),
        href: "/copy/bulk",
        state: b.status === "running" ? "working" : (c?.failed ?? 0) > 0 ? "failed" : "done",
        progress: { done: (c?.done ?? 0) + (c?.failed ?? 0), total: b.total },
        at: iso(b.finishedAt ?? b.createdAt),
      };
    }),
  ];
  if (publishing.length) {
    const first = publishing.reduce((min, g) => (iso(g.publishStartedAt) < min ? iso(g.publishStartedAt) : min), iso(publishing[0].publishStartedAt));
    items.push({ kind: "publish", id: "publish", title: "", href: "/history", state: "working", progress: { done: 0, total: publishing.length }, at: first });
  }

  const byTime = (a: TrayItem, b: TrayItem) => b.at.localeCompare(a.at);
  return {
    running: items.filter((i) => i.state === "working").sort(byTime),
    finished: items.filter((i) => i.state !== "working" && i.at >= since).sort(byTime),
  };
}
