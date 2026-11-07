import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// A tool's results feed (Gemini-style): every result is saved to History, and each tool lists the signed-in
// user's own results for that tool, oldest first, newest last.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { saveGeneration, listToolFeed } = await import("@/features/history/actions");

// 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const as = (made: Awaited<ReturnType<typeof makeOrg>>, name: string): Workspace => ({
  orgId: made.org.id,
  orgName: made.org.name,
  role: "admin",
  plan: "pro",
  user: { id: `${name}-id`, name, email: `${name}@feed.test` },
  isSuperAdmin: false,
  orgs: [],
  creditsMonthly: 500,
  creditsRemaining: 500,
});

const save = (mode: string, sku: string) =>
  saveGeneration({ mode, sku, title: "Living Room", imageUrl: PNG, width: 1, height: 1, settings: { aspectRatio: "1:1" }, provider: "openai", model: "demo" });

describe("listToolFeed", () => {
  let made: Awaited<ReturnType<typeof makeOrg>>;
  beforeEach(async () => {
    made = await makeOrg("pro");
  });

  it("lists my results for this tool only, oldest first", async () => {
    workspace = as(made, "Ana");
    expect((await save("lifestyle", "SOFA-1")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect((await save("lifestyle", "SOFA-2")).ok).toBe(true);
    expect((await save("recolor", "SOFA-3")).ok).toBe(true);
    workspace = as(made, "Ben");
    expect((await save("lifestyle", "CHAIR-9")).ok).toBe(true);

    workspace = as(made, "Ana");
    const feed = await listToolFeed("lifestyle");
    expect(feed.map((i) => i.sku)).toEqual(["SOFA-1", "SOFA-2"]);
    expect(feed[0].imageUrl).toMatch(/^\/api\/assets\//);
    expect((await listToolFeed("recolor")).map((i) => i.sku)).toEqual(["SOFA-3"]);
    // Opened from History: one product's results only.
    expect((await listToolFeed("lifestyle", "SOFA-2")).map((i) => i.sku)).toEqual(["SOFA-2"]);
    expect(await listToolFeed("lifestyle", "CHAIR-9")).toEqual([]);
  });

  it("has no feed for tools without one, and nothing for another org", async () => {
    workspace = as(made, "Ana");
    await save("lifestyle", "SOFA-1");
    expect(await listToolFeed("create")).toEqual([]);
    workspace = as(await makeOrg("pro"), "Ana");
    expect(await listToolFeed("lifestyle")).toEqual([]);
  });
});
