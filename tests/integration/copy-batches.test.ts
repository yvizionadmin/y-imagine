import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertConnection } from "@/lib/catalog/connections";
import { getBatchItem, listBatchItems, releaseStaleItems } from "@/lib/copy/batches";
import { getCopy } from "@/lib/copy/copies";
import { db, schema } from "@/lib/db";
import { hit, LIMITS } from "@/lib/rate-limit";
import { listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { eq } from "drizzle-orm";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

// Items are handed to the runner here instead of BullMQ / after(); tests run them explicitly.
const dispatched: string[] = [];
vi.mock("@/lib/copy/batch-queue", async (original) => ({
  ...(await original<typeof import("@/lib/copy/batch-queue")>()),
  dispatchItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const { runInline } = await import("@/lib/copy/batch-queue");
const { runBatchItem } = await import("@/lib/copy/batch-runner");
const { startCopyBatch, getCopyBatch, listCopyBatches, cancelCopyBatch, retryFailedItems, deleteCopyBatch, exportCopyBatch } = await import("@/features/copy/batch-actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const asWorkspace = (made: Made, role: Workspace["role"] = "admin", creditsRemaining = 500) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining };
};

const settings = { category: "furniture", tone: "friendly", length: "short", channel: "website", languages: ["en", "ar"] } as const;
const start = (text: string, extra: Partial<Parameters<typeof startCopyBatch>[0]> = {}) => startCopyBatch({ text, settings: { ...settings, languages: [...settings.languages] }, ...extra });

beforeEach(() => {
  dispatched.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("bulk copy", () => {
  it("writes every product (catalog fills SKU-only rows), one copy job each, and finishes the batch", async () => {
    const made = await makeOrg();
    asWorkspace(made, "editor");
    await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });

    const result = await start("sku,name,details,keywords\nOSLO-1,Oslo Sofa,\"Oak legs\",sofa\nSOFA-12345\nNOPE-404", { name: "Spring drop" });
    if (!result.ok) throw new Error(result.error);
    expect(result.batch).toMatchObject({ name: "Spring drop", status: "running", total: 3, canManage: true, counts: { pending: 3 } });
    expect(dispatched).toHaveLength(3);

    await runInline(made.org.id, dispatched);
    const run = await getCopyBatch(result.batch.id);
    expect(run?.batch.status).toBe("done");
    expect(run?.batch.finishedAt).not.toBeNull();
    expect(run?.items.map((i) => [i.sku, i.status, i.error])).toEqual([
      ["OSLO-1", "done", null],
      ["SOFA-12345", "done", null],
      ["NOPE-404", "failed", "sku_not_found"],
    ]);
    expect(run?.items[1].productName).toBe("Grey Fabric 3-Seater Sofa");

    const copy = await getCopy(made.org.id, run!.items[0].copyId!);
    expect(copy).toMatchObject({ sku: "OSLO-1", createdBy: made.user.name, settings: { tone: "friendly", category: "furniture", keywords: ["sofa"], languages: ["en", "ar"] } });
    // Only written products are charged, attributed to whoever started the run.
    const usage = await listUsage(made.org.id);
    expect(usage.map((u) => [u.feature, u.ok, u.userId])).toEqual([
      ["copy", true, made.user.id],
      ["copy", true, made.user.id],
    ]);
    expect((await exportCopyBatch(result.batch.id)).map((p) => p.sku)).toEqual(["OSLO-1", "SOFA-12345"]);
    // A duplicate delivery does nothing.
    expect(await runBatchItem(made.org.id, run!.items[0].id)).toBe("skipped");
  });

  it("refuses runs it can't finish: no products, not enough credits, viewers, no provider", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    expect(await start("sku,name\n,missing")).toEqual({ ok: false, error: "empty" });
    expect(await start("A\nB")).toMatchObject({ ok: true });
    asWorkspace(made, "admin", 1);
    expect(await start("A\nB")).toEqual({ ok: false, error: "not_enough_credits" });
    asWorkspace(made, "viewer");
    expect(await start("A")).toEqual({ ok: false, error: "forbidden" });
    asWorkspace(made);
    expect(await startCopyBatch({ text: "A", settings: { ...settings, languages: [], tone: "angry" as never } })).toEqual({ ok: false, error: "invalid_input" });
    vi.stubEnv("IMAGINE_DEMO", "0");
    expect(await start("A")).toEqual({ ok: false, error: "no_provider" });
  });

  it("a failed product is free and can be retried; stopping skips what hasn't started", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    const result = await start("FAIL-1,Broken\nOK-1,Fine\nOK-2,Later");
    if (!result.ok) throw new Error(result.error);
    const [fail, ok1, ok2] = dispatched;
    expect(await runBatchItem(made.org.id, fail)).toBe("failed");
    expect(await runBatchItem(made.org.id, ok1)).toBe("done");
    expect((await getBatchItem(made.org.id, fail))?.error).toBe("generation_failed");

    expect(await retryFailedItems(result.batch.id)).toEqual({ ok: true, retried: 1 });
    expect((await getBatchItem(made.org.id, fail))?.status).toBe("pending");

    expect(await cancelCopyBatch(result.batch.id)).toEqual({ ok: true });
    expect(await runBatchItem(made.org.id, ok2)).toBe("skipped");
    const run = await getCopyBatch(result.batch.id);
    expect(run?.batch).toMatchObject({ status: "cancelled", counts: { done: 1, cancelled: 2, pending: 0 } });
    expect((await listUsage(made.org.id)).filter((u) => u.ok)).toHaveLength(1);
  });

  it("a rate-limited product goes back to waiting without being charged", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    const result = await start("RL-1,Rate limited");
    if (!result.ok) throw new Error(result.error);
    for (let i = 0; i < LIMITS.jobsPerUser.limit; i++) await hit("jobs-user", made.user.id, LIMITS.jobsPerUser);
    expect(await runBatchItem(made.org.id, dispatched[0])).toBe("retry");
    expect((await getBatchItem(made.org.id, dispatched[0]))?.status).toBe("pending");
    expect((await getCopyBatch(result.batch.id))?.batch.status).toBe("running");
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("other orgs can't see or touch a run; only admins or the starter manage it", async () => {
    const owner = await makeOrg();
    asWorkspace(owner, "editor");
    const result = await start("A-1,One");
    if (!result.ok) throw new Error(result.error);

    asWorkspace(await makeOrg());
    expect(await listCopyBatches()).toHaveLength(0);
    expect(await getCopyBatch(result.batch.id)).toBeNull();
    expect(await cancelCopyBatch(result.batch.id)).toEqual({ ok: false, error: "not_found" });
    expect(await exportCopyBatch(result.batch.id)).toEqual([]);

    asWorkspace(owner, "editor");
    workspace = { ...workspace, user: { ...workspace.user, id: "someone-else" } };
    expect((await getCopyBatch(result.batch.id))?.batch.canManage).toBe(false);
    expect(await deleteCopyBatch(result.batch.id)).toEqual({ ok: false, error: "forbidden" });
    asWorkspace(owner, "admin");
    workspace = { ...workspace, user: { ...workspace.user, id: "another-admin" } };
    expect(await deleteCopyBatch(result.batch.id)).toEqual({ ok: true });
    expect(await getCopyBatch(result.batch.id)).toBeNull();
  });

  it("items stuck running (crashed process) are timed out and their batch settles", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    const result = await start("S-1,Stuck");
    if (!result.ok) throw new Error(result.error);
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await db.update(schema.copyBatchItems).set({ status: "running", updatedAt: old }).where(eq(schema.copyBatchItems.id, dispatched[0]));
    expect(await releaseStaleItems()).toBeGreaterThanOrEqual(1);
    const [item] = await listBatchItems(made.org.id, result.batch.id);
    expect(item).toMatchObject({ status: "failed", error: "timed_out" });
    expect((await getCopyBatch(result.batch.id))?.batch.status).toBe("done");
  });
});
