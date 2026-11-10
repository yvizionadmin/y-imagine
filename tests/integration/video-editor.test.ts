import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEdit, releaseStaleRenders } from "@/lib/editor/edits";
import { probeMedia, runFfmpeg } from "@/lib/editor/ffmpeg";
import { runEditRender } from "@/lib/editor/runner";
import { db, schema } from "@/lib/db";
import { insertGeneration } from "@/lib/generations";
import { getAsset, getAssetRecord, saveAsset } from "@/lib/storage/assets";
import { cleanupOldVideos, videoBytesUsed } from "@/lib/video/storage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Video editor (B10): projects, uploads checked with ffmpeg, saves that only accept the org's own
// files, and a real FFmpeg export (two clips, subtitles, a music track) to one MP4.

let workspace: Workspace;
const dispatched: string[] = [];
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/editor/queue", () => ({ dispatchEditRender: async (_org: string, id: string) => void dispatched.push(id) }));

const actions = await import("@/features/editor/actions");
const { POST: upload } = await import("@/app/api/editor/uploads/route");

let dir: string;
let clipWithSound: Uint8Array;
let music: Uint8Array;
const demoClip = () => readFile(path.join(process.cwd(), "public", "demo", "demo-video.webm"));

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "editor-test-"));
  await runFfmpeg(["-f", "lavfi", "-i", "testsrc=s=640x360:d=3:r=25", "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-y", path.join(dir, "clip.mp4")]);
  await runFfmpeg(["-f", "lavfi", "-i", "sine=f=220:d=2", "-y", path.join(dir, "music.mp3")]);
  clipWithSound = new Uint8Array(await readFile(path.join(dir, "clip.mp4")));
  music = new Uint8Array(await readFile(path.join(dir, "music.mp3")));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
beforeEach(() => {
  dispatched.length = 0;
});

async function signedIn(plan: "pro" | "free" = "pro", role: Workspace["role"] = "admin") {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

/** A finished Studio video in History, as the video runner leaves it. */
async function studioVideo(orgId: string) {
  const assetId = await saveAsset(orgId, new Uint8Array(await demoClip()), "video/webm", "video");
  await insertGeneration({
    orgId,
    mode: "video",
    sku: "",
    title: "Sofa turntable",
    assetId,
    mimeType: "video/webm",
    width: 1280,
    height: 720,
    settings: { prompt: "Sofa turntable", aspectRatio: "16:9", seconds: "5", resolution: "720p" },
    provider: "demo",
    model: "demo-video-v1",
    createdBy: "t",
    createdById: "t",
  });
  return assetId;
}

function uploadRequest(editId: string, kind: string, bytes: Uint8Array, type: string, name: string) {
  const form = new FormData();
  form.set("editId", editId);
  form.set("kind", kind);
  form.set("file", new File([bytes.slice()], name, { type }));
  return upload(new Request("http://app.test/api/editor/uploads", { method: "POST", body: form }));
}

describe("video editor", () => {
  it("cuts a Studio video and an uploaded clip together with subtitles and music, and exports one MP4", async () => {
    const { org } = await signedIn();
    const studio = await studioVideo(org.id);

    const created = await actions.createEditorProject({ name: "Launch reel", clipAssetId: studio });
    if (!created.ok) throw new Error(created.error);
    const project = created.project;
    expect(project.timeline.clips).toMatchObject([{ assetId: studio, start: 0, end: 5 }]);
    expect(project.timeline.aspectRatio).toBe("16:9");

    const clipRes = await uploadRequest(project.id, "clip", clipWithSound, "video/mp4", "detail.mp4");
    const clipBody = await clipRes.json();
    expect(clipRes.status).toBe(200);
    expect(clipBody.media).toMatchObject({ kind: "clip", mimeType: "video/mp4", name: "detail.mp4", seconds: 3 });
    const musicRes = await uploadRequest(project.id, "audio", music, "audio/mp3", "theme.mp3");
    const musicBody = await musicRes.json();
    expect(musicBody.media).toMatchObject({ kind: "audio", mimeType: "audio/mpeg" });
    expect((await getAssetRecord(org.id, clipBody.media.assetId))?.kind).toBe("editor-media");

    const timeline = {
      ...project.timeline,
      aspectRatio: "9:16",
      clips: [
        { ...project.timeline.clips[0], start: 1, end: 3.5 },
        // Read to the file's very end, last, under a looped track: this once hung ffmpeg.
        { id: "c2", assetId: clipBody.media.assetId, name: "detail.mp4", start: 0, end: 3 },
      ],
      subtitles: [
        { id: "s1", start: 0, end: 2, text: "Two clips, one video" },
        { id: "s2", start: 2.2, end: 4.8, text: "أريكة مريحة" },
      ],
      audio: { assetId: musicBody.media.assetId, name: "theme.mp3", volume: 0.4 },
    };
    const saved = await actions.saveEditorProject(project.id, { name: "Launch reel v2", timeline });
    expect(saved.ok).toBe(true);

    const exported = await actions.exportEditorProject(project.id);
    expect(exported.ok && exported.project.status).toBe("pending");
    expect(dispatched).toEqual([project.id]);
    // A second export can't start while one is waiting.
    expect(await actions.exportEditorProject(project.id)).toEqual({ ok: false, error: "busy" });

    expect(await runEditRender(org.id, project.id)).toBe("done");
    // Claimed once: a second run does nothing.
    expect(await runEditRender(org.id, project.id)).toBe("skipped");
    const done = await actions.getEditorProject(project.id);
    expect(done).toMatchObject({ name: "Launch reel v2", status: "ok", error: null });
    expect(done?.output?.seconds).toBeCloseTo(5.5, 1);

    const outputId = done!.output!.url.split("/").pop()!;
    const output = await getAsset(org.id, outputId);
    expect(output?.mimeType).toBe("video/mp4");
    const file = path.join(dir, "out.mp4");
    await writeFile(file, new Uint8Array(output!.bytes));
    const probe = await probeMedia(file);
    expect(probe).toMatchObject({ hasVideo: true, hasAudio: true });
    expect(probe!.duration).toBeGreaterThan(5.3);
    expect(probe!.duration).toBeLessThan(5.8);
    const info = await runFfmpeg(["-i", file], { allowFailure: true });
    expect(info).toContain("720x1280");

    // Exporting again replaces the earlier file.
    await actions.exportEditorProject(project.id);
    expect(await runEditRender(org.id, project.id)).toBe("done");
    expect(await getAsset(org.id, outputId)).toBeNull();

    // Uploads and exports count toward video storage, and deleting the project removes them.
    expect(await videoBytesUsed(org.id)).toBeGreaterThan(clipWithSound.byteLength + music.byteLength);
    expect(await actions.deleteEditorProject(project.id)).toEqual({ ok: true });
    expect(await getAsset(org.id, clipBody.media.assetId)).toBeNull();
    expect(await getAsset(org.id, musicBody.media.assetId)).toBeNull();
    // The Studio video stays in History.
    expect(await getAsset(org.id, studio)).not.toBeNull();
  });

  it("only saves files that are the org's own", async () => {
    const other = await signedIn();
    const foreign = await studioVideo(other.org.id);
    const foreignImage = await saveAsset(other.org.id, new Uint8Array([1, 2, 3]), "image/png");
    const { org } = await signedIn();
    const own = await studioVideo(org.id);
    const created = await actions.createEditorProject({ name: "Mine" });
    if (!created.ok) throw new Error(created.error);
    const base = { ...created.project.timeline, clips: [{ id: "a", assetId: own, name: "", start: 0, end: 2 }] };

    expect((await actions.saveEditorProject(created.project.id, { name: "Mine", timeline: base })).ok).toBe(true);
    const bad = [
      { ...base, clips: [{ id: "a", assetId: foreign, name: "", start: 0, end: 2 }] },
      { ...base, clips: [{ id: "a", assetId: foreignImage, name: "", start: 0, end: 2 }] },
      // A Studio video can't be used as the music track.
      { ...base, audio: { assetId: own, name: "", volume: 1 } },
      { ...base, clips: [{ id: "a", assetId: own, name: "", start: 0, end: 500 }] },
    ];
    for (const timeline of bad) expect(await actions.saveEditorProject(created.project.id, { name: "Mine", timeline })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.createEditorProject({ clipAssetId: foreign })).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.getEditorProject(created.project.id)).not.toBeNull();
    // Another org's project is not found.
    workspace = { ...workspace, orgId: other.org.id };
    expect(await actions.getEditorProject(created.project.id)).toBeNull();
    expect(await actions.exportEditorProject(created.project.id)).toEqual({ ok: false, error: "not_found" });
  });

  it("checks uploads with ffmpeg and refuses what isn't video or sound", async () => {
    await signedIn();
    const created = await actions.createEditorProject({ name: "Uploads" });
    if (!created.ok) throw new Error(created.error);
    const id = created.project.id;
    const fake = await uploadRequest(id, "clip", new TextEncoder().encode("not a video at all"), "video/mp4", "fake.mp4");
    expect(fake.status).toBe(400);
    // Sound only is not a clip; a clip is not a track type.
    expect((await uploadRequest(id, "clip", music, "audio/mpeg", "a.mp3")).status).toBe(400);
    expect((await uploadRequest(id, "clip", music, "video/mp4", "a.mp4")).status).toBe(400);
    expect((await uploadRequest(id, "audio", clipWithSound, "image/png", "x.png")).status).toBe(400);
    expect((await uploadRequest("00000000-0000-4000-8000-000000000000", "clip", clipWithSound, "video/mp4", "x.mp4")).status).toBe(404);
    expect((await getEdit(workspace.orgId, id))?.media).toEqual([]);
  });

  it("fails an export whose clip was deleted, and closes renders that died", async () => {
    const { org } = await signedIn();
    const studio = await studioVideo(org.id);
    const created = await actions.createEditorProject({ clipAssetId: studio });
    if (!created.ok) throw new Error(created.error);
    await db.forOrg(org.id).delete(schema.assets);
    await actions.exportEditorProject(created.project.id);
    expect(await runEditRender(org.id, created.project.id)).toBe("failed");
    expect(await actions.getEditorProject(created.project.id)).toMatchObject({ status: "failed", error: "media_missing", output: null });

    // A render stuck in `running` past the limit is failed by the schedule.
    await actions.exportEditorProject(created.project.id);
    await db.forOrg(org.id).update(schema.videoEdits, { status: "running", updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() });
    expect(await releaseStaleRenders()).toBeGreaterThanOrEqual(1);
    expect((await getEdit(org.id, created.project.id))?.error).toBe("timed_out");
  });

  it("is for paid plans and members who can edit", async () => {
    await signedIn("free");
    expect((await actions.getEditorSetup()).allowed).toBe(false);
    expect(await actions.createEditorProject({ name: "x" })).toEqual({ ok: false, error: "not_in_plan" });

    await signedIn("pro", "viewer");
    expect(await actions.getEditorSetup()).toMatchObject({ allowed: true, canEdit: false });
    expect(await actions.createEditorProject({ name: "x" })).toEqual({ ok: false, error: "forbidden" });

    await signedIn("pro");
    workspace = { ...workspace, viewAs: { expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    expect(await actions.createEditorProject({ name: "x" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("removes projects left unchanged past the plan's video retention", async () => {
    const { org } = await signedIn("pro");
    const created = await actions.createEditorProject({ name: "Old" });
    const fresh = await actions.createEditorProject({ name: "New" });
    if (!created.ok || !fresh.ok) throw new Error("create failed");
    const res = await uploadRequest(created.project.id, "audio", music, "audio/mpeg", "old.mp3");
    const { media } = await res.json();
    const old = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
    await db.forOrg(org.id).update(schema.videoEdits, { updatedAt: old }, (await import("drizzle-orm")).eq(schema.videoEdits.id, created.project.id));

    await cleanupOldVideos();
    expect(await getEdit(org.id, created.project.id)).toBeNull();
    expect(await getAsset(org.id, media.assetId)).toBeNull();
    expect(await getEdit(org.id, fresh.project.id)).not.toBeNull();
  });
});
