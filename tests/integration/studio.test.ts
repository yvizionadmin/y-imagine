import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { listGenerations } from "@/lib/generations";
import type { PlanId } from "@/lib/plans";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Studio home: text-to-image through the registry (feature "create"), saved to History without a
// SKU, and the setup that drives the Image | Video switch.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("next/cache", () => ({ refresh: () => {} }));

const { createImages, getStudioSetup, listStudioRecent } = await import("@/features/studio/actions");
const { queryHistory } = await import("@/features/history/actions");

let calls: { url: string; body: unknown }[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function fakeOpenAi(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  const png = (await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#cc8844" } }).png().toBuffer()).toString("base64");
  return json({ created: 1, data: [{ b64_json: png }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
}

async function signedIn(plan: PlanId = "pro", role: Workspace["role"] = "admin") {
  const made = await makeOrg(plan);
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
  return made;
}

const form = (fields: Record<string, string>, files: File[] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ prompt: "a red chair in a sunny room", aspectRatio: "1:1", resolution: "HD", count: "1", ...fields })) f.set(k, v);
  for (const file of files) f.append("reference", file);
  return f;
};

afterEach(() => {
  vi.unstubAllGlobals();
  calls = [];
});

describe("studio", () => {
  it("makes text-to-image results, charges one job each and keeps them out of store uploads", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    const { org } = await signedIn();
    const result = await createImages(form({ count: "2", aspectRatio: "16:9" }));
    expect(result.ok && result.items).toHaveLength(2);
    // Text only: an image generation, not an edit.
    expect(calls.every((c) => c.url.includes("/images/generations"))).toBe(true);
    expect((calls[0].body as { prompt: string }).prompt).toContain("a red chair");

    const jobs = await listUsage(org.id);
    expect(jobs.map((j) => j.feature)).toEqual(["create", "create"]);
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(2);

    const saved = await listGenerations(org.id);
    expect(saved.map((g) => [g.mode, g.sku, g.settings.aspectRatio])).toEqual([
      ["create", "", "16:9"],
      ["create", "", "16:9"],
    ]);
    expect(await listStudioRecent()).toHaveLength(2);
    expect((await queryHistory({ sort: "newest", page: 1, pageSize: 24 })).pendingCount).toBe(0);
  });

  it("sends reference images as an edit", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    await signedIn();
    const ref = new File([await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer()], "ref.png", { type: "image/png" });
    const result = await createImages(form({}, [ref]));
    expect(result.ok).toBe(true);
    expect(calls[0].url).toContain("/images/edits");
  });

  it("refuses bad input, viewers, and plans without the Studio", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    await signedIn();
    expect(await createImages(form({ prompt: "" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await createImages(form({ count: "5" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await createImages(form({ aspectRatio: "7:3" }))).toEqual({ ok: false, error: "invalid_input" });
    const txt = new File(["x"], "x.txt", { type: "text/plain" });
    expect(await createImages(form({}, [txt]))).toEqual({ ok: false, error: "invalid_input" });

    await signedIn("pro", "viewer");
    expect(await createImages(form({}))).toEqual({ ok: false, error: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("reports video as paid-only and the configured image cost", async () => {
    await signedIn("free");
    const free = await getStudioSetup();
    expect(free.videoAllowed).toBe(false);
    expect(free.imageCost).toBe(1);
    await signedIn("starter");
    expect((await getStudioSetup()).videoAllowed).toBe(true);
  });
});
