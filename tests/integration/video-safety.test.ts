import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { listAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { listGenerations } from "@/lib/generations";
import { cleanupOldVideos } from "@/lib/jobs/maintenance";
import { PLANS, type PlanId } from "@/lib/plans";
import { getAsset } from "@/lib/storage/assets";
import { getVideoJobs } from "@/lib/video/jobs";
import { runVideoJob } from "@/lib/video/runner";
import { videoBytesUsed } from "@/lib/video/storage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Video safety + storage (roadmap A6): likeness consent for a start frame, storage quota per plan,
// and the scheduled removal of clips past the plan's retention.

let workspace: Workspace;
const dispatched: string[] = [];
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/video/queue", () => ({ dispatchVideoJob: async (_org: string, id: string) => void dispatched.push(id) }));

const { startVideo, getStudioSetup } = await import("@/features/studio/actions");
const { deleteGenerations } = await import("@/features/history/actions");

beforeEach(() => {
  vi.stubEnv("IMAGINE_DEMO", "1");
  vi.stubEnv("DEMO_VIDEO_LATENCY_MS", "0");
  dispatched.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

async function signedIn(plan: PlanId = "starter") {
  const made = await makeOrg(plan);
  workspace = {
    orgId: made.org.id,
    orgName: made.org.name,
    role: "admin",
    plan,
    user: { id: made.user.id, name: made.user.name, email: made.user.email },
    isSuperAdmin: false,
    orgs: [],
    creditsMonthly: 500,
    creditsRemaining: 500,
  };
  await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "demo-video-key-123456", models: [], createdBy: "t" });
  return made;
}

const form = (fields: Record<string, string> = {}, frame?: File) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ prompt: "A model turns slowly in a linen dress", aspectRatio: "9:16", seconds: "4", resolution: "720p", camera: "static", motion: "low", ...fields })) f.set(k, v);
  if (frame) f.set("startFrame", frame);
  return f;
};

const frame = async () => new File([await sharp({ create: { width: 90, height: 160, channels: 3, background: "#884422" } }).png().toBuffer()], "frame.png", { type: "image/png" });

/** Makes one finished video (clip + History item) and returns its job. */
async function finishedVideo(orgId: string, withFrame = false) {
  const started = await startVideo(form(withFrame ? { likenessConsent: "yes" } : {}, withFrame ? await frame() : undefined));
  expect(started.ok).toBe(true);
  const id = dispatched.at(-1)!;
  expect(await runVideoJob(orgId, id)).toBe("done");
  return (await getVideoJobs(orgId, [id]))[0];
}

const age = (orgId: string, days: number) =>
  Promise.all([
    db.$client`update video_jobs set created_at = now() - make_interval(days => ${days}) where org_id = ${orgId}`,
    db.$client`update generations set created_at = now() - make_interval(days => ${days}) where org_id = ${orgId}`,
  ]);

describe("likeness consent", () => {
  it("a start frame needs the consent box; it is stored on the job and audited", async () => {
    const { org } = await signedIn();
    expect(await startVideo(form({}, await frame()))).toEqual({ ok: false, error: "consent_required" });
    expect(await startVideo(form({ likenessConsent: "on" }, await frame()))).toEqual({ ok: false, error: "consent_required" });
    expect(dispatched).toHaveLength(0);
    // Nothing was stored for the refused requests.
    expect(await videoBytesUsed(org.id)).toBe(0);

    expect((await startVideo(form({ likenessConsent: "yes" }, await frame()))).ok).toBe(true);
    const [job] = await getVideoJobs(org.id, dispatched);
    expect(job.consentedAt).not.toBeNull();
    const [entry] = await listAudit(org.id, { prefix: "video.consent_given" });
    expect(entry).toMatchObject({ actor: workspace.user.name, target: "A model turns slowly in a linen dress", meta: { job: job.id } });
  });

  it("text-only videos don't ask for it", async () => {
    const { org } = await signedIn();
    expect((await startVideo(form())).ok).toBe(true);
    expect((await getVideoJobs(org.id, dispatched))[0].consentedAt).toBeNull();
    expect(await listAudit(org.id, { prefix: "video.consent_given" })).toHaveLength(0);
  });
});

describe("video storage", () => {
  it("counts clips and start frames against the plan and refuses a new video when full", async () => {
    const { org } = await signedIn("starter");
    const job = await finishedVideo(org.id, true);
    const used = await videoBytesUsed(org.id);
    expect(used).toBeGreaterThan(0);
    const setup = await getStudioSetup();
    expect(setup.videoStorage).toEqual({ used, limit: PLANS.starter.videoStorageBytes, retentionDays: 30, full: false });

    // Fill the plan's room (index rows only; the bytes don't matter to the check).
    const big = 2_000_000_000;
    const rows = Array.from({ length: Math.ceil(PLANS.starter.videoStorageBytes / big) }, () => ({ id: randomUUID(), mimeType: "video/mp4", kind: "video" as const, byteSize: big }));
    await db.forOrg(org.id).insert(schema.assets, rows);
    expect((await getStudioSetup()).videoStorage.full).toBe(true);
    expect(await startVideo(form())).toEqual({ ok: false, error: "storage_full" });

    // Image assets don't count.
    expect(await videoBytesUsed(org.id)).toBe(used + rows.length * big);
    expect(job.status).toBe("ok");
  });

  it("deleting a video in History frees its clip and its start frame", async () => {
    const { org } = await signedIn();
    const job = await finishedVideo(org.id, true);
    const [item] = await listGenerations(org.id);
    expect(await getAsset(org.id, job.startFrameAssetId!)).not.toBeNull();
    expect((await deleteGenerations([item.id])).ok).toBe(true);
    expect(await getAsset(org.id, job.assetId!)).toBeNull();
    expect(await getAsset(org.id, job.startFrameAssetId!)).toBeNull();
    expect(await videoBytesUsed(org.id)).toBe(0);
  });
});

describe("scheduled cleanup", () => {
  it("removes clips past the plan's retention with their History item, keeps newer ones, audits it", async () => {
    const { org } = await signedIn("starter");
    const old = await finishedVideo(org.id, true);
    await age(org.id, PLANS.starter.videoRetentionDays + 1);
    const fresh = await finishedVideo(org.id);

    const summary = await cleanupOldVideos();
    expect(summary.failed).toBe(0);
    expect(await getVideoJobs(org.id, [old.id, fresh.id])).toEqual([expect.objectContaining({ id: fresh.id })]);
    expect(await getAsset(org.id, old.assetId!)).toBeNull();
    expect(await getAsset(org.id, old.startFrameAssetId!)).toBeNull();
    expect(await getAsset(org.id, fresh.assetId!)).not.toBeNull();
    expect((await listGenerations(org.id)).map((g) => g.assetId)).toEqual([fresh.assetId]);
    const [entry] = await listAudit(org.id, { prefix: "video.cleaned_up" });
    expect(entry).toMatchObject({ actor: "Imagine AI", target: "1", meta: { retentionDays: "30" } });

    // A second run has nothing left to do for this org.
    await cleanupOldVideos();
    expect(await listAudit(org.id, { prefix: "video.cleaned_up" })).toHaveLength(1);
  });

  it("removes an old History video that has no job row, and only that one", async () => {
    const { org } = await signedIn("starter");
    const job = await finishedVideo(org.id);
    await db.forOrg(org.id).delete(schema.videoJobs);
    await age(org.id, PLANS.starter.videoRetentionDays + 1);
    await cleanupOldVideos();
    expect(await listGenerations(org.id)).toHaveLength(0);
    expect(await getAsset(org.id, job.assetId!)).toBeNull();
  });

  it("follows the plan: Pro keeps the same clip longer; open jobs are never touched", async () => {
    const { org } = await signedIn("pro");
    const kept = await finishedVideo(org.id);
    expect((await startVideo(form())).ok).toBe(true); // still pending
    await age(org.id, PLANS.starter.videoRetentionDays + 1);
    await cleanupOldVideos();
    expect((await getVideoJobs(org.id, [kept.id, dispatched.at(-1)!])).map((j) => j.status).sort()).toEqual(["ok", "pending"]);

    await age(org.id, PLANS.pro.videoRetentionDays + 1);
    await cleanupOldVideos();
    expect((await getVideoJobs(org.id, [kept.id, dispatched.at(-1)!])).map((j) => j.status)).toEqual(["pending"]);
    expect(await listGenerations(org.id)).toHaveLength(0);
  });
});
