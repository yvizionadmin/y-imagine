import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { listGenerations } from "@/lib/generations";
import { getAsset } from "@/lib/storage/assets";
import { getVideoJobs } from "@/lib/video/jobs";
import { videoSize } from "@/lib/video/history";
import { runVideoJob } from "@/lib/video/runner";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Finished Studio videos are also History items (mode "video", no SKU): listed, never counted as
// pending store uploads, and deleting one removes the clip and its Studio card.

let workspace: Workspace;
const dispatched: string[] = [];
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/video/queue", () => ({ dispatchVideoJob: async (_org: string, id: string) => void dispatched.push(id) }));

const { startVideo, listStudioRecent } = await import("@/features/studio/actions");
const { queryHistory, deleteGenerations } = await import("@/features/history/actions");

beforeEach(() => {
  vi.stubEnv("IMAGINE_DEMO", "1");
  vi.stubEnv("DEMO_VIDEO_LATENCY_MS", "0");
  dispatched.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

async function signedIn() {
  const made = await makeOrg("pro");
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "admin", plan: "pro", user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "demo-video-key-123456", models: [], createdBy: "t" });
  return made;
}

const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ prompt: "Waves rolling onto a quiet beach at dusk", aspectRatio: "16:9", seconds: "4", resolution: "720p", camera: "static", motion: "low" })) f.set(k, v);
  return f;
};

describe("videos in History", () => {
  it("sizes a clip from its resolution and aspect ratio", () => {
    expect(videoSize("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(videoSize("1080p", "9:16")).toEqual({ width: 1080, height: 1920 });
    expect(videoSize("480p", "1:1")).toEqual({ width: 480, height: 480 });
    expect(videoSize("360p", "21:9")).toEqual({ width: 840, height: 360 });
  });

  it("saves a finished video to History and deletes it with its Studio card", async () => {
    const { org } = await signedIn();
    expect((await startVideo(form())).ok).toBe(true);
    expect(await runVideoJob(org.id, dispatched[0])).toBe("done");

    const [saved] = await listGenerations(org.id);
    expect(saved).toMatchObject({ mode: "video", sku: "", width: 1280, height: 720, mimeType: "video/webm", title: "Waves rolling onto a quiet beach at dusk" });
    expect(saved.settings).toMatchObject({ seconds: "4", resolution: "720p", aspectRatio: "16:9" });

    const history = await queryHistory({ sort: "newest", page: 1, pageSize: 24, mode: "video" });
    expect(history.items.map((i) => i.id)).toEqual([saved.id]);
    expect(history.pendingCount).toBe(0);

    expect(await deleteGenerations([saved.id])).toEqual({ ok: true, count: 1 });
    expect(await getAsset(org.id, saved.assetId)).toBeNull();
    expect(await getVideoJobs(org.id, dispatched)).toHaveLength(0);
    expect(await listStudioRecent()).toHaveLength(0);
  });

  it("doesn't save failed videos", async () => {
    const { org } = await signedIn();
    const f = form();
    f.set("prompt", "FAIL please");
    await startVideo(f);
    expect(await runVideoJob(org.id, dispatched[0])).toBe("failed");
    expect(await listGenerations(org.id)).toHaveLength(0);
  });
});
