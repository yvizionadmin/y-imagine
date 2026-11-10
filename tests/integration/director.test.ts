import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceDirector } from "@/lib/director/advance";
import { DEFAULT_DIRECTOR_SETTINGS, type DirectorSettings } from "@/lib/director/limits";
import { getDirector, lockDirector, releaseStaleDirectors, STALE_DIRECTOR_MS, unlockDirector, updateDirector } from "@/lib/director/projects";
import { db, schema } from "@/lib/db";
import { getEdit } from "@/lib/editor/edits";
import { probeMedia } from "@/lib/editor/ffmpeg";
import { runEditRender } from "@/lib/editor/runner";
import { listRecentGenerations } from "@/lib/generations";
import { getPlatformSettings, savePlatformSettings } from "@/lib/platform/settings";
import { updateOrganization } from "@/lib/platform/organizations";
import { getAsset, getAssetRecord } from "@/lib/storage/assets";
import { listUsage } from "@/lib/usage";
import { getVideoJobs } from "@/lib/video/jobs";
import { runVideoJob } from "@/lib/video/runner";
import type { Workspace } from "@/lib/workspace";
import { eq } from "drizzle-orm";
import { makeOrg } from "../helpers";

// B11 AI Director: idea → script → storyboard → a video per scene → one assembled MP4. The queues
// are recorded here and run by hand, so each hand-off (scene finished, render finished) is checked.

let workspace: Workspace;
const queued = { director: [] as string[], video: [] as string[], render: [] as string[] };
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/director/queue", () => ({ dispatchDirector: async (_o: string, id: string) => void queued.director.push(id) }));
vi.mock("@/lib/video/queue", () => ({ dispatchVideoJob: async (_o: string, id: string) => void queued.video.push(id) }));
vi.mock("@/lib/editor/queue", () => ({ dispatchEditRender: async (_o: string, id: string) => void queued.render.push(id) }));

const actions = await import("@/features/director/actions");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "director-test-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
beforeEach(() => {
  queued.director.length = queued.video.length = queued.render.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
  vi.stubEnv("DEMO_VIDEO_LATENCY_MS", "0");
});
afterEach(() => vi.unstubAllEnvs());

async function signedIn(plan: "pro" | "free" = "pro", role: Workspace["role"] = "admin", creditsRemaining = 500) {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining };
  return made;
}

const settings = (patch: Partial<DirectorSettings> = {}): DirectorSettings => ({ ...DEFAULT_DIRECTOR_SETTINGS, aspectRatio: "16:9", seconds: 4, scenes: 3, ...patch });

/** Runs whatever was queued until nothing is left (the worker's job, done by hand). */
async function drain(orgId: string) {
  for (let round = 0; round < 20; round++) {
    const director = queued.director.splice(0);
    const videos = queued.video.splice(0);
    const renders = queued.render.splice(0);
    if (!director.length && !videos.length && !renders.length) return;
    for (const id of new Set(director)) await advanceDirector(orgId, id);
    for (const id of videos) await runVideoJob(orgId, id);
    for (const id of renders) await runEditRender(orgId, id);
  }
  throw new Error("still working after 20 rounds");
}

describe("AI Director", () => {
  it("turns one idea into a finished multi-scene MP4 with narration (B11 done when)", async () => {
    const made = await signedIn();
    const created = await actions.createDirectorProject({ idea: "Our new oak lounge chair for slow Sunday mornings", settings: settings() });
    if (!created.ok) throw new Error(created.error);
    expect(created.project.status).toBe("planning");
    expect(queued.director).toEqual([created.project.id]);

    await drain(made.org.id);
    const done = await actions.getDirectorProject(created.project.id);
    expect(done).toMatchObject({ status: "done", title: "Our new oak lounge chair for slow Sunday mornings", error: null });
    expect(done!.scenes).toHaveLength(3);
    for (const scene of done!.scenes) {
      expect(scene).toMatchObject({ videoStatus: "ok", error: null });
      expect(scene.narration.length).toBeGreaterThan(0);
      expect((await getAssetRecord(made.org.id, scene.imageAssetId!))?.kind).toBe("video-frame");
    }

    // The scene videos are Studio jobs, first frame = storyboard image, linked to the project; they're in History too.
    const jobs = await getVideoJobs(made.org.id, done!.scenes.map((s) => s.videoJobId!));
    expect(jobs.map((j) => [j.status, j.settings.directorId, j.settings.seconds, j.settings.aspectRatio])).toEqual(Array(3).fill(["ok", created.project.id, 4, "16:9"]));
    expect(jobs.map((j) => j.startFrameAssetId).sort()).toEqual(done!.scenes.map((s) => s.imageAssetId).sort());
    expect(await listRecentGenerations(made.org.id, "video", 10)).toHaveLength(3);

    // The finished video is an editor project: three clips, narration subtitles and a voice-over.
    const edit = await getEdit(made.org.id, done!.editId!);
    expect(edit).toMatchObject({ status: "ok" });
    const timeline = edit!.timeline;
    expect(timeline.clips.map((c) => c.assetId)).toEqual(done!.scenes.map((s) => s.videoAssetId));
    expect(timeline.subtitles.map((s) => [s.start, s.text])).toEqual(done!.scenes.map((s, i) => [i * 4, s.narration]));
    expect(timeline.voice).toMatchObject({ start: 0, volume: 1 });
    expect(timeline.clipVolume).toBe(0.3);
    const file = path.join(dir, "director.mp4");
    await writeFile(file, new Uint8Array((await getAsset(made.org.id, edit!.outputAssetId!))!.bytes));
    const probe = await probeMedia(file);
    expect(probe).toMatchObject({ hasVideo: true, hasAudio: true });
    // Three scenes; the demo clip is shorter than 4 s, so each is cut at its real end.
    expect(probe!.duration).toBeGreaterThan(5);
    expect(done!.output?.url).toBe(`/api/assets/${edit!.outputAssetId}`);

    // Every part was its own job: the script, 3 images, 3 videos, the voice-over.
    const usage = (await listUsage(made.org.id)).map((u) => u.feature).sort();
    expect(usage).toEqual(["create", "create", "create", "director", "video", "video", "video", "voice"]);
  });

  it("films no more than the org's open video limit at once; the rest follow as scenes finish", async () => {
    const made = await signedIn();
    const created = await actions.createDirectorProject({ idea: "Summer outdoor furniture sale", settings: settings({ scenes: 5, voiceOver: false, subtitles: false }) });
    if (!created.ok) throw new Error(created.error);
    // Script and storyboard, then the first three scenes are queued.
    await advanceDirector(made.org.id, created.project.id);
    let p = await getDirector(made.org.id, created.project.id);
    expect(p?.status).toBe("filming");
    expect(p!.scenes.filter((s) => s.videoJobId)).toHaveLength(3);
    queued.director.length = 0;
    await drain(made.org.id);
    p = await getDirector(made.org.id, created.project.id);
    expect(p?.status).toBe("done");
    const edit = await getEdit(made.org.id, p!.editId!);
    expect(edit!.timeline).toMatchObject({ subtitles: [], voice: null, clipVolume: 1 });
    expect(edit!.timeline.clips).toHaveLength(5);
  });

  it("stops at a failed scene and retries from there, keeping what was made", async () => {
    const made = await signedIn();
    const created = await actions.createDirectorProject({ idea: "Kitchen launch", settings: settings({ scenes: 2, voiceOver: false }) });
    if (!created.ok) throw new Error(created.error);
    await advanceDirector(made.org.id, created.project.id);
    // Make the second scene's video fail.
    const p = await getDirector(made.org.id, created.project.id);
    const failing = p!.scenes[1];
    await db.update(schema.videoJobs).set({ prompt: "FAIL this one" }).where(eq(schema.videoJobs.id, failing.videoJobId!));
    queued.director.length = 0;
    await drain(made.org.id);
    const failed = await actions.getDirectorProject(created.project.id);
    expect(failed).toMatchObject({ status: "failed", failedStep: "filming", error: "generation_failed" });
    expect(failed!.scenes[0].videoStatus).toBe("ok");
    expect(failed!.scenes[1]).toMatchObject({ error: "generation_failed", videoStatus: "failed" });

    const retried = await actions.retryDirectorProject(created.project.id);
    if (!retried.ok) throw new Error(retried.error);
    expect(retried.project.status).toBe("filming");
    await drain(made.org.id);
    const done = await getDirector(made.org.id, created.project.id);
    expect(done?.status).toBe("done");
    // The first scene's clip was kept: only the failed scene was filmed again.
    expect(done!.scenes[0].videoJobId).toBe(p!.scenes[0].videoJobId);
    expect(done!.scenes[1].videoJobId).not.toBe(failing.videoJobId);
  });

  it("refuses what it can't afford or isn't allowed, before any job", async () => {
    let made = await signedIn("pro", "admin", 5);
    // 3 × (image 1 + 4 s video 8) + script 1 + voice 1 = 29 credits.
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings() })).toEqual({ ok: false, error: "not_enough_credits" });
    await signedIn();
    expect(await actions.createDirectorProject({ idea: " ", settings: settings() })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings({ seconds: 7 }) })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings({ aspectRatio: "1:1" }) })).toEqual({ ok: false, error: "invalid_input" }); // demo model: 16:9 / 9:16
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: { ...settings(), scenes: 9 } })).toEqual({ ok: false, error: "invalid_input" });
    await signedIn("pro", "viewer");
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings() })).toEqual({ ok: false, error: "forbidden" });
    made = await signedIn("free");
    expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings() })).toEqual({ ok: false, error: "not_in_plan" });
    expect((await actions.getDirectorSetup()).allowed).toBe(false);

    await signedIn();
    const before = await getPlatformSettings();
    try {
      await savePlatformSettings({ ...before, disabledFeatures: [...before.disabledFeatures, "director"] }, "test");
      expect(await actions.createDirectorProject({ idea: "Sofa", settings: settings() })).toEqual({ ok: false, error: "feature_disabled" });
    } finally {
      await savePlatformSettings(before, "test");
    }
    vi.unstubAllEnvs(); // no demo: no provider
    expect((await actions.getDirectorSetup()).problem).toBe("no_provider");
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("a script that fails or a month out of credits fails the project at that step", async () => {
    const made = await signedIn();
    const created = await actions.createDirectorProject({ idea: "please FAIL", settings: settings({ scenes: 2 }) });
    if (!created.ok) throw new Error(created.error);
    expect(await advanceDirector(made.org.id, created.project.id)).toBe("failed");
    expect(await getDirector(made.org.id, created.project.id)).toMatchObject({ status: "failed", failedStep: "planning", error: "generation_failed" });

    const second = await actions.createDirectorProject({ idea: "Lamps", settings: settings({ scenes: 2 }) });
    if (!second.ok) throw new Error(second.error);
    await updateOrganization(made.org.id, { creditsOverride: 1 }); // the script fits, the images don't
    expect(await advanceDirector(made.org.id, second.project.id)).toBe("failed");
    expect(await getDirector(made.org.id, second.project.id)).toMatchObject({ status: "failed", failedStep: "storyboard", error: "quota_exceeded" });
  });

  it("one worker at a time; stale projects are closed; viewers read; delete keeps History", async () => {
    const made = await signedIn();
    const created = await actions.createDirectorProject({ idea: "Rugs", settings: settings({ scenes: 2, voiceOver: false }) });
    if (!created.ok) throw new Error(created.error);
    expect(await lockDirector(made.org.id, created.project.id)).not.toBeNull();
    expect(await advanceDirector(made.org.id, created.project.id)).toBe("busy");
    await unlockDirector(made.org.id, created.project.id);

    await db.update(schema.directorProjects).set({ updatedAt: new Date(Date.now() - STALE_DIRECTOR_MS - 60_000).toISOString() }).where(eq(schema.directorProjects.id, created.project.id));
    expect(await releaseStaleDirectors()).toBeGreaterThanOrEqual(1);
    expect(await getDirector(made.org.id, created.project.id)).toMatchObject({ status: "failed", failedStep: "planning", error: "timed_out" });

    // Other orgs see nothing.
    const other = workspace;
    await signedIn();
    expect(await actions.getDirectorProject(created.project.id)).toBeNull();
    expect(await actions.listDirectorProjects()).toEqual([]);
    workspace = { ...other, role: "viewer" };
    expect((await actions.listDirectorProjects()).map((p) => p.id)).toEqual([created.project.id]);
    expect(await actions.deleteDirectorProject(created.project.id)).toEqual({ ok: false, error: "forbidden" });
    workspace = { ...other, role: "admin" };
    await updateDirector(made.org.id, created.project.id, { status: "filming" });
    expect(await actions.deleteDirectorProject(created.project.id)).toEqual({ ok: false, error: "busy" });
    await updateDirector(made.org.id, created.project.id, { status: "failed" });
    expect(await actions.deleteDirectorProject(created.project.id)).toEqual({ ok: true });
    expect(await getDirector(made.org.id, created.project.id)).toBeNull();
  });
});
