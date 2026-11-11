import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/lib/db";
import { insertDirector } from "@/lib/director/projects";
import { DEFAULT_DIRECTOR_SETTINGS } from "@/lib/director/limits";
import { insertEdit } from "@/lib/editor/edits";
import { EMPTY_TIMELINE } from "@/lib/editor/timeline";
import { insertGeneration, updateGenerations } from "@/lib/generations";
import { finishImageItem, insertImageBatch, settleImageBatch } from "@/lib/image-batch/batches";
import { saveAsset } from "@/lib/storage/assets";
import { TRAY_FINISHED_MS, trayFor } from "@/lib/tray";
import { insertVideoJob } from "@/lib/video/jobs";
import { makeOrg } from "../helpers";

// U4: the top bar's jobs tray: your running and recently finished work, and the org's store uploads.

type Made = Awaited<ReturnType<typeof makeOrg>>;
const by = (made: Made, userId = made.user.id) => ({ orgId: made.org.id, createdBy: made.user.name, createdById: userId });
const video = (made: Made, prompt: string, settings: Record<string, string | number> = {}, userId?: string) =>
  insertVideoJob({ ...by(made, userId), prompt, settings: settings as never, startFrameAssetId: null, startFrameMime: null, consentedAt: null, credits: 1 });

describe("trayFor", () => {
  it("lists the user's running work and what finished, newest first; nothing of other users or orgs", async () => {
    const made = await makeOrg();
    const org = made.org.id;
    expect(await trayFor(org, made.user.id)).toEqual({ running: [], finished: [] });

    const running = await video(made, "Slow pan over a linen sofa");
    const done = await video(made, "Lamp turning on at dusk");
    await db.forOrg(org).update(schema.videoJobs, { status: "ok", finishedAt: new Date().toISOString() }, eq(schema.videoJobs.id, done.id));
    const old = await video(made, "Old one");
    await db.forOrg(org).update(schema.videoJobs, { status: "ok", finishedAt: new Date(Date.now() - TRAY_FINISHED_MS - 60_000).toISOString() }, eq(schema.videoJobs.id, old.id));
    await video(made, "Someone else's", {}, "another-user");

    const { batch, items } = await insertImageBatch({ ...by(made), tool: "aplus", name: "Chairs A+", settings: {} as never, rows: [{ sku: "A", productSize: "" }, { sku: "B", productSize: "" }] });
    await finishImageItem(org, items[0].id, { status: "done" });

    const tray = await trayFor(org, made.user.id);
    expect(tray.running.map((i) => [i.kind, i.title, i.href, i.progress])).toEqual([
      ["aplusBulk", "Chairs A+", "/aplus/bulk", { done: 1, total: 2 }],
      ["video", "Slow pan over a linen sofa", "/home?mode=video", null],
    ]);
    expect(tray.running[1].id).toBe(running.id);
    expect(tray.finished.map((i) => [i.kind, i.id, i.state])).toEqual([["video", done.id, "done"]]);

    // The run finishes with one failure: it moves to finished, as failed.
    await finishImageItem(org, items[1].id, { status: "failed", error: "provider_error" });
    await settleImageBatch(org, batch.id);
    const after = await trayFor(org, made.user.id);
    expect(after.finished.find((i) => i.id === batch.id)).toMatchObject({ state: "failed", progress: { done: 2, total: 2 } });

    const other = await makeOrg();
    expect(await trayFor(other.org.id, made.user.id)).toEqual({ running: [], finished: [] });
  });

  it("shows an AI Director project once, not its scene videos or its render", async () => {
    const made = await makeOrg();
    const org = made.org.id;
    const project = await insertDirector({ ...by(made), idea: "Morning coffee", settings: DEFAULT_DIRECTOR_SETTINGS });
    await video(made, "Scene 1", { directorId: project.id });
    const edit = await insertEdit({ ...by(made), name: "Morning coffee", timeline: EMPTY_TIMELINE });
    await db.forOrg(org).update(schema.videoEdits, { status: "running" }, eq(schema.videoEdits.id, edit.id));
    await db.forOrg(org).update(schema.directorProjects, { editId: edit.id, status: "assembling" }, eq(schema.directorProjects.id, project.id));
    // A render of the user's own editor project still shows.
    const own = await insertEdit({ ...by(made), name: "My cut", timeline: EMPTY_TIMELINE });
    await db.forOrg(org).update(schema.videoEdits, { status: "pending" }, eq(schema.videoEdits.id, own.id));

    const tray = await trayFor(org, made.user.id);
    expect(tray.running.map((i) => [i.kind, i.title, i.href])).toEqual([
      ["render", "My cut", `/editor?project=${own.id}`],
      ["director", "Morning coffee", `/editor/director?project=${project.id}`],
    ]);
  });

  it("counts the org's store uploads in progress as one entry", async () => {
    const made = await makeOrg();
    const org = made.org.id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const assetId = await saveAsset(org, new Uint8Array([1, 2, 3]), "image/png");
      ids.push((await insertGeneration({ orgId: org, mode: "lifestyle", sku: `S${i}`, title: "T", assetId, mimeType: "image/png", width: 1, height: 1, settings: {}, provider: "demo", model: "m", createdBy: "t", createdById: null })).id);
    }
    await updateGenerations(org, ids.slice(0, 2), { status: "publishing", publishStartedAt: new Date().toISOString() });
    // Any member sees them: uploads aren't tied to who started them.
    const tray = await trayFor(org, "any-member");
    expect(tray.running).toEqual([expect.objectContaining({ kind: "publish", href: "/history", progress: { done: 0, total: 2 } })]);
  });
});
