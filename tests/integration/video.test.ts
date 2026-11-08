import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { DEFAULT_CREDIT_RULES, videoCost } from "@/lib/credits";
import type { PlanId } from "@/lib/plans";
import { getAsset } from "@/lib/storage/assets";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import { getVideoJobs } from "@/lib/video/jobs";
import { runVideoJob } from "@/lib/video/runner";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Studio video: request checks, the queued job, the worker run (offline demo provider), credits and
// storage. The queue hand-off is stubbed; tests run the job the way the worker would.

let workspace: Workspace;
const dispatched: string[] = [];
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/video/queue", () => ({ dispatchVideoJob: async (_org: string, id: string) => void dispatched.push(id) }));

const { startVideo, getStudioSetup, pollStudioVideos } = await import("@/features/studio/actions");
const { setToolModel, getProviderKeys } = await import("@/features/ai-providers/actions");

async function signedIn(plan: PlanId = "pro", opts: { key?: boolean; role?: Workspace["role"]; credits?: number } = {}) {
  const made = await makeOrg(plan);
  workspace = {
    orgId: made.org.id,
    orgName: made.org.name,
    role: opts.role ?? "admin",
    plan,
    user: { id: made.user.id, name: made.user.name, email: made.user.email },
    isSuperAdmin: false,
    orgs: [],
    creditsMonthly: 500,
    creditsRemaining: opts.credits ?? 500,
  };
  if (opts.key !== false) await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "demo-video-key-123456", models: [], createdBy: "t" });
  return made;
}

const form = (fields: Record<string, string> = {}, frame?: File) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ prompt: "Slow push-in on a steaming cup of coffee", aspectRatio: "9:16", seconds: "8", resolution: "720p", camera: "pushIn", motion: "medium", ...fields })) f.set(k, v);
  if (frame) f.set("startFrame", frame);
  return f;
};

beforeEach(() => {
  vi.stubEnv("IMAGINE_DEMO", "1");
  vi.stubEnv("DEMO_VIDEO_LATENCY_MS", "0");
  dispatched.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("studio video", () => {
  it("queues a job, runs it, stores the clip and charges length × resolution", async () => {
    const { org } = await signedIn("starter");
    const started = await startVideo(form());
    expect(started.ok && started.item).toMatchObject({ kind: "video", status: "pending", aspectRatio: "9:16", seconds: 8 });
    expect(dispatched).toHaveLength(1);
    // Nothing is charged until the provider call starts.
    expect(await listUsage(org.id)).toHaveLength(0);

    expect(await runVideoJob(org.id, dispatched[0])).toBe("done");
    expect(await runVideoJob(org.id, dispatched[0])).toBe("skipped");
    const [job] = await getVideoJobs(org.id, dispatched);
    expect(job.status).toBe("ok");
    expect((await getAsset(org.id, job.assetId!))?.mimeType).toBe("video/webm");

    const expected = videoCost(DEFAULT_CREDIT_RULES, { seconds: 8, resolution: "720p" });
    expect(job.credits).toBe(expected);
    expect((await listUsage(org.id)).map((e) => [e.feature, e.credits, e.ok])).toEqual([["video", expected, true]]);
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(expected);
    expect((await pollStudioVideos(dispatched))[0]).toMatchObject({ status: "ok", url: `/api/assets/${job.assetId}` });
  });

  it("takes a start frame for image-to-video", async () => {
    const { org } = await signedIn();
    const png = await sharp({ create: { width: 90, height: 160, channels: 3, background: "#123456" } }).png().toBuffer();
    const started = await startVideo(form({ likenessConsent: "yes" }, new File([png], "frame.png", { type: "image/png" })));
    expect(started.ok).toBe(true);
    const [job] = await getVideoJobs(org.id, dispatched);
    expect(job.startFrameMime).toBe("image/png");
    expect(await runVideoJob(org.id, job.id)).toBe("done");
  });

  it("a failed video is recorded and costs nothing", async () => {
    const { org } = await signedIn();
    await startVideo(form({ prompt: "please FAIL this one" }));
    expect(await runVideoJob(org.id, dispatched[0])).toBe("failed");
    const [job] = await getVideoJobs(org.id, dispatched);
    expect([job.status, job.error]).toEqual(["failed", "generation_failed"]);
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(0);
  });

  it("is paid plans only, whatever else is set", async () => {
    await signedIn("free");
    expect(await startVideo(form())).toEqual({ ok: false, error: "not_in_plan" });
    expect((await getStudioSetup()).videoAllowed).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it("only offers and accepts what the model supports", async () => {
    await signedIn();
    const setup = await getStudioSetup();
    expect(setup.videoCaps.aspectRatios).toEqual(["16:9", "9:16"]);
    expect(await startVideo(form({ aspectRatio: "1:1" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startVideo(form({ seconds: "7" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startVideo(form({ resolution: "4k" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startVideo(form({ camera: "spin" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startVideo(form({ prompt: "" }))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("uses Seedance's options with a BytePlus key and runs the job", async () => {
    const { org } = await signedIn("pro", { key: false });
    await saveProviderKey({ orgId: org.id, provider: "byteplus", key: "demo-byteplus-key-123456", models: null, createdBy: "t" });
    const setup = await getStudioSetup();
    expect(setup.videoProblem).toBeNull();
    expect(setup.videoCaps.aspectRatios).toContain("21:9");
    expect(setup.videoCaps.durations).toContain(30);

    const started = await startVideo(form({ aspectRatio: "21:9", seconds: "30", resolution: "480p" }));
    expect(started.ok && started.item).toMatchObject({ aspectRatio: "21:9", seconds: 30, width: 1280, height: 549 });
    expect(await startVideo(form({ resolution: "360p" }))).toEqual({ ok: false, error: "invalid_input" });

    expect(await runVideoJob(org.id, dispatched[0])).toBe("done");
    const [job] = await getVideoJobs(org.id, dispatched);
    expect(job.credits).toBe(videoCost(DEFAULT_CREDIT_RULES, { seconds: 30, resolution: "480p" }));
  });

  it("uses Kling's options with a Kling key and runs the job", async () => {
    const { org } = await signedIn("pro", { key: false });
    await saveProviderKey({ orgId: org.id, provider: "kling", key: "demo-kling-key-123456", models: null, createdBy: "t" });
    const setup = await getStudioSetup();
    expect(setup).toMatchObject({ videoProblem: null, videoModel: "Kling 3.0" });
    expect(setup.videoCaps.aspectRatios).toEqual(["16:9", "9:16", "1:1"]);

    // Settings Kling doesn't take are refused before a job exists.
    expect(await startVideo(form({ aspectRatio: "21:9" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startVideo(form({ seconds: "30" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(dispatched).toHaveLength(0);

    expect((await startVideo(form({ aspectRatio: "1:1", seconds: "5", resolution: "1080p" }))).ok).toBe(true);
    expect(await runVideoJob(org.id, dispatched[0])).toBe("done");
    const [job] = await getVideoJobs(org.id, dispatched);
    expect(job.credits).toBe(videoCost(DEFAULT_CREDIT_RULES, { seconds: 5, resolution: "1080p" }));
  });

  it("uses the video model chosen in Settings → API Keys, else Automatic", async () => {
    const { org } = await signedIn("pro");
    await saveProviderKey({ orgId: org.id, provider: "byteplus", key: "demo-byteplus-key-123456", models: null, createdBy: "t" });
    // Automatic: Gemini comes first.
    expect((await getStudioSetup()).videoCaps.aspectRatios).toEqual(["16:9", "9:16"]);
    expect((await getProviderKeys()).models.video).toEqual({ gemini: ["gemini-omni-1.2-flash"], byteplus: ["dreamina-seedance-2-5-260628"] });

    expect(await setToolModel("video", { provider: "byteplus", model: "dreamina-seedance-2-5-260628" })).toEqual({ ok: true });
    const setup = await getStudioSetup();
    expect(setup).toMatchObject({ videoModel: "Seedance 2.5", canManageModels: true });
    expect(setup.videoCaps.durations).toContain(30);
    expect((await startVideo(form({ aspectRatio: "1:1", seconds: "20" }))).ok).toBe(true);

    // Only video providers and models a key can call; back to Automatic with null.
    expect(await setToolModel("video", { provider: "openai", model: "gpt-image-2" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await setToolModel("video", { provider: "byteplus", model: "dreamina-seedance-9-9-999999" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await setToolModel("video", null)).toEqual({ ok: true });
    expect((await getStudioSetup()).videoCaps.aspectRatios).toEqual(["16:9", "9:16"]);
  });

  it("checks credits, viewers, the per-org limit and a missing key", async () => {
    await signedIn("pro", { credits: 3 });
    expect(await startVideo(form())).toEqual({ ok: false, error: "not_enough_credits" });

    await signedIn("pro", { role: "viewer" });
    expect(await startVideo(form())).toEqual({ ok: false, error: "forbidden" });

    await signedIn("pro");
    for (let i = 0; i < 3; i++) expect((await startVideo(form())).ok).toBe(true);
    expect(await startVideo(form())).toEqual({ ok: false, error: "too_many_jobs" });

    vi.stubEnv("IMAGINE_DEMO", "0");
    await signedIn("pro", { key: false });
    expect(await startVideo(form())).toEqual({ ok: false, error: "no_provider" });
    expect((await getStudioSetup()).videoProblem).toBe("no_provider");
  });
});
