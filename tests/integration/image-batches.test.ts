import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { insertConnection } from "@/lib/catalog/connections";
import { db, schema } from "@/lib/db";
import { listGenerations } from "@/lib/generations";
import { listImageBatchItems, releaseStaleImageItems } from "@/lib/image-batch/batches";
import { IMAGE_BATCH_MAX_ROWS, parseImageRows } from "@/lib/image-batch/rows";
import { hit, LIMITS } from "@/lib/rate-limit";
import { readAsset } from "@/lib/storage/assets";
import { listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

// Items are handed to the runner here instead of BullMQ / after(); tests run them explicitly.
const dispatched: string[] = [];
vi.mock("@/lib/image-batch/queue", async (original) => ({
  ...(await original<typeof import("@/lib/image-batch/queue")>()),
  dispatchImageItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const { runImageItemsInline } = await import("@/lib/image-batch/queue");
const { runImageItem } = await import("@/lib/image-batch/runner");
const { startImageBatch } = await import("@/features/generate/batch-actions");
const { getImageBatchRun, listImageBatchRuns, cancelImageBatchRun, retryFailedImages, deleteImageBatchRun } = await import("@/features/image-batch/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"] = "editor", creditsRemaining = 500) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining };
};
const settings = { category: "furniture", scene: "livingRoom", customScene: null, style: null, aspectRatio: "1:1", resolution: "HD", instructions: "", title: "Living room" };
const start = (text: string, patch: Record<string, unknown> = {}) => startImageBatch({ text, settings: { ...settings, ...patch } });
const withCatalog = async () => {
  const made = await makeOrg();
  await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
  as(made);
  return made;
};

beforeEach(() => {
  dispatched.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("product list", () => {
  it("one SKU per line with an optional size; header, blanks, bad SKUs and duplicates skipped; capped", () => {
    const parsed = parseImageRows('sku,size\nSOFA-1, 220 × 90 cm\n\n"CHAIR-2"\nsofa-1\n,nothing', 80);
    expect(parsed.rows).toEqual([
      { sku: "SOFA-1", productSize: "220 × 90 cm" },
      { sku: "CHAIR-2", productSize: "" },
    ]);
    expect(parsed.skipped).toEqual([
      { line: 5, reason: "duplicate" },
      { line: 6, reason: "invalid_sku" },
    ]);
    const many = parseImageRows(Array.from({ length: IMAGE_BATCH_MAX_ROWS + 5 }, (_, i) => `S-${i}`).join("\n"), 80);
    expect(many.rows).toHaveLength(IMAGE_BATCH_MAX_ROWS);
    expect(many.truncated).toBe(true);
  });
});

describe("bulk generate", () => {
  it("makes one image per SKU from its catalog photo, saves each to History, one job each", async () => {
    const made = await withCatalog();
    const result = await start("SOFA-12345,220 cm wide\nCHAIR-OAK-99\nNOPE-404", { name: "Spring" });
    if (!result.ok) throw new Error(result.error);
    expect(result.batch).toMatchObject({ tool: "generate", status: "running", total: 3, counts: { pending: 3 }, canManage: true });

    await runImageItemsInline(made.org.id, dispatched);
    const run = await getImageBatchRun(result.batch.id);
    expect(run?.batch.status).toBe("done");
    expect(run?.items.map((i) => [i.sku, i.status, i.error])).toEqual([
      ["SOFA-12345", "done", null],
      ["CHAIR-OAK-99", "done", null],
      ["NOPE-404", "failed", "sku_not_found"],
    ]);
    expect(run?.items[0].imageUrl).toMatch(/^\/api\/assets\//);

    const history = await listGenerations(made.org.id);
    expect(history).toHaveLength(2);
    const sofa = history.find((g) => g.sku === "SOFA-12345")!; // items run two at a time, so any order
    expect(sofa).toMatchObject({ mode: "lifestyle", sku: "SOFA-12345", title: "Living room", createdBy: made.user.name, settings: { scene: "livingRoom", productSize: "220 cm wide", batchId: result.batch.id } });
    expect((await readAsset(made.org.id, sofa.assetId, sofa.mimeType)).byteLength).toBeGreaterThan(0);
    const usage = await listUsage(made.org.id);
    expect(usage.filter((u) => u.feature === "generate" && u.ok)).toHaveLength(2);
    expect((await listImageBatchRuns("generate")).map((b) => b.id)).toEqual([result.batch.id]);
  });

  it("refuses viewers, bad settings, empty lists, runs bigger than the credits left, and orgs without a catalog", async () => {
    const made = await withCatalog();
    expect(await start("A-1", { scene: "nope" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await start("A-1", { customScene: "a sunny terrace" })).toEqual({ ok: false, error: "invalid_input" }); // two scene sources
    expect(await start("A-1", { style: "baroque" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await start("A-1", { scene: null, customScene: "a sunny terrace" })).toMatchObject({ ok: true });
    expect(await start("\n,\n")).toEqual({ ok: false, error: "empty" });
    as(made, "editor", 1);
    expect(await start("A-1\nA-2")).toEqual({ ok: false, error: "not_enough_credits" });
    as(made, "viewer");
    expect(await start("A-1")).toEqual({ ok: false, error: "forbidden" });
    as(await makeOrg());
    expect(await start("A-1")).toEqual({ ok: false, error: "no_connection" });
  });

  it("a rate-limited item waits without being charged; failures can be retried; duplicates do nothing", async () => {
    const made = await withCatalog();
    const result = await start("SOFA-12345");
    if (!result.ok) throw new Error(result.error);
    for (let i = 0; i < LIMITS.jobsPerUser.limit; i++) await hit("jobs-user", made.user.id, LIMITS.jobsPerUser);
    expect(await runImageItem(made.org.id, dispatched[0])).toBe("retry");
    expect((await listImageBatchItems(made.org.id, result.batch.id))[0].status).toBe("pending");
    expect(await listUsage(made.org.id)).toHaveLength(0);

    const other = await start("NOPE-404");
    if (!other.ok) throw new Error(other.error);
    await runImageItem(made.org.id, dispatched[1]);
    expect(await runImageItem(made.org.id, dispatched[1])).toBe("skipped"); // already finished
    expect(await retryFailedImages(other.batch.id)).toEqual({ ok: true, retried: 1 });
    expect((await getImageBatchRun(other.batch.id))?.batch.status).toBe("running");
  });

  it("stop cancels what hasn't started; only admins or the starter manage a run; other orgs can't see it", async () => {
    const made = await withCatalog();
    const result = await start("SOFA-12345\nCHAIR-OAK-99");
    if (!result.ok) throw new Error(result.error);
    const someone = await makeOrg();
    workspace = { ...workspace, user: { ...workspace.user, id: someone.user.id } };
    expect(await cancelImageBatchRun(result.batch.id)).toEqual({ ok: false, error: "forbidden" });
    as(made, "admin");
    expect(await cancelImageBatchRun(result.batch.id)).toEqual({ ok: true });
    await runImageItemsInline(made.org.id, dispatched);
    expect((await getImageBatchRun(result.batch.id))?.items.map((i) => i.status)).toEqual(["cancelled", "cancelled"]);
    expect(await listGenerations(made.org.id)).toHaveLength(0);

    as(await makeOrg(), "admin");
    expect(await getImageBatchRun(result.batch.id)).toBeNull();
    expect(await deleteImageBatchRun(result.batch.id)).toEqual({ ok: false, error: "not_found" });
    as(made, "admin");
    expect(await deleteImageBatchRun(result.batch.id)).toEqual({ ok: true });
  });

  it("items stuck running after a crash are failed and the run settles", async () => {
    const made = await withCatalog();
    const result = await start("SOFA-12345");
    if (!result.ok) throw new Error(result.error);
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await db.update(schema.imageBatchItems).set({ status: "running", updatedAt: old }).where(eq(schema.imageBatchItems.id, dispatched[0]));
    expect(await releaseStaleImageItems()).toBeGreaterThanOrEqual(1);
    expect((await getImageBatchRun(result.batch.id))?.items[0]).toMatchObject({ status: "failed", error: "timed_out" });
    expect((await getImageBatchRun(result.batch.id))?.batch.status).toBe("done");
    void made;
  });
});
