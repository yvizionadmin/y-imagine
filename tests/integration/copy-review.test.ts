import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import type { Workspace } from "@/lib/workspace";
import { copiesAsCsv } from "@/features/copy/components/copy-export";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const dispatched: string[] = [];
vi.mock("@/lib/copy/batch-queue", async (original) => ({
  ...(await original<typeof import("@/lib/copy/batch-queue")>()),
  dispatchItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const { runInline } = await import("@/lib/copy/batch-queue");
const { generateProductCopy, reviewCopy, saveCopyEdits, listRecentCopies, getCopyReviewRights } = await import("@/features/copy/actions");
const { startCopyBatch, getCopyBatch, reviewCopyBatch, exportCopyBatch } = await import("@/features/copy/batch-actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"]) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

async function written(made: Made, sku = "SOFA-9") {
  as(made, "editor");
  const data = new FormData();
  for (const [k, v] of Object.entries({ sku, productName: "Oslo Sofa", category: "furniture", details: "Oak legs", keywords: "", tone: "friendly", length: "short", channel: "website", languages: "en" })) data.append(k, v);
  const result = await generateProductCopy(data);
  if (!result.ok) throw new Error(result.error);
  return result.copy;
}

beforeEach(() => {
  dispatched.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("copy approvals", () => {
  it("draft → in review → changes requested (with a note) → in review → approved, each step audited", async () => {
    const made = await makeOrg();
    const copy = await written(made);
    expect(copy.reviewStatus).toBe("draft");

    as(made, "editor");
    expect(await getCopyReviewRights()).toEqual({ submit: true, approve: false });
    const submitted = await reviewCopy(copy.id, "submit");
    expect(submitted.ok && submitted.copy.reviewStatus).toBe("in_review");
    expect(await reviewCopy(copy.id, "approve")).toEqual({ ok: false, error: "forbidden" });
    expect((await listRecentCopies("in_review")).map((c) => c.id)).toEqual([copy.id]);

    as(made, "admin");
    expect(await reviewCopy(copy.id, "request_changes", "   ")).toEqual({ ok: false, error: "invalid_input" });
    const changes = await reviewCopy(copy.id, "request_changes", "Shorten the title");
    expect(changes.ok && changes.copy).toMatchObject({ reviewStatus: "changes_requested", reviewNote: "Shorten the title", reviewedBy: made.user.name });
    expect(await listRecentCopies("in_review")).toEqual([]);

    as(made, "editor");
    const again = await reviewCopy(copy.id, "submit");
    expect(again.ok && again.copy).toMatchObject({ reviewStatus: "in_review", reviewNote: null });

    as(made, "admin");
    const approved = await reviewCopy(copy.id, "approve");
    expect(approved.ok && approved.copy).toMatchObject({ reviewStatus: "approved", reviewedBy: made.user.name });
    expect(approved.ok && approved.copy.reviewedAt).not.toBeNull();
    // Already approved: approving or submitting again changes nothing.
    expect(await reviewCopy(copy.id, "approve")).toEqual({ ok: false, error: "invalid_input" });
    expect(await reviewCopy(copy.id, "submit")).toEqual({ ok: false, error: "invalid_input" });

    expect((await listAudit(made.org.id, { prefix: "copy." })).map((e) => [e.action, e.target])).toEqual([
      ["copy.approved", "SOFA-9"],
      ["copy.submitted", "SOFA-9"],
      ["copy.changes_requested", "SOFA-9"],
      ["copy.submitted", "SOFA-9"],
    ]);
  });

  it("editing approved copy sends it back to draft; editing copy in review keeps it in review", async () => {
    const made = await makeOrg();
    const copy = await written(made);
    await reviewCopy(copy.id, "submit");
    const edit = (title: string) => saveCopyEdits(copy.id, { en: { ...copy.copy.en!, title } });
    expect(((await edit("Edited in review")) as { copy: { reviewStatus: string } }).copy.reviewStatus).toBe("in_review");

    as(made, "admin");
    await reviewCopy(copy.id, "approve");
    const edited = await edit("Edited after approval");
    expect(edited.ok && edited.copy).toMatchObject({ reviewStatus: "draft", reviewedBy: null, reviewedAt: null });
  });

  it("viewers can't review, admins can approve a draft directly, other orgs can't touch it", async () => {
    const made = await makeOrg();
    const copy = await written(made);
    as(made, "viewer");
    expect(await getCopyReviewRights()).toEqual({ submit: false, approve: false });
    expect(await reviewCopy(copy.id, "submit")).toEqual({ ok: false, error: "forbidden" });
    expect(await reviewCopy(copy.id, "wrong" as never)).toEqual({ ok: false, error: "invalid_input" });

    as(await makeOrg(), "admin");
    expect(await reviewCopy(copy.id, "approve")).toEqual({ ok: false, error: "not_found" });

    as(made, "admin");
    const approved = await reviewCopy(copy.id, "approve");
    expect(approved.ok && approved.copy.reviewStatus).toBe("approved");
  });
});

describe("bulk approvals", () => {
  it("submits and approves a whole run, and downloads only approved products", async () => {
    const made = await makeOrg();
    as(made, "editor");
    const started = await startCopyBatch({ text: "OSLO-1,Oslo Sofa\nLAMP-2,Arc Lamp\nRUG-3,Wool Rug", settings: { category: "furniture", tone: "friendly", length: "short", channel: "website", languages: ["en"] } });
    if (!started.ok) throw new Error(started.error);
    await runInline(made.org.id, dispatched);
    const id = started.batch.id;
    const items = (await getCopyBatch(id))!.items;
    expect(items.map((i) => i.review)).toEqual(["draft", "draft", "draft"]);

    expect(await reviewCopyBatch(id, "approve")).toEqual({ ok: false, error: "forbidden" });
    expect(await reviewCopyBatch(id, "submit")).toEqual({ ok: true, changed: 3 });

    as(made, "admin");
    await reviewCopy(items[2].copyId!, "request_changes", "Wrong material");
    expect(await exportCopyBatch(id, { approvedOnly: true })).toEqual([]);
    await reviewCopy(items[0].copyId!, "approve");
    expect((await exportCopyBatch(id, { approvedOnly: true })).map((p) => p.sku)).toEqual(["OSLO-1"]);

    expect(await reviewCopyBatch(id, "approve")).toEqual({ ok: true, changed: 2 });
    expect((await getCopyBatch(id))!.items.map((i) => i.review)).toEqual(["approved", "approved", "approved"]);
    const all = await exportCopyBatch(id);
    expect(all.map((p) => p.review)).toEqual(["approved", "approved", "approved"]);
    expect((await listAudit(made.org.id, { prefix: "copy.approved" }))[0]).toMatchObject({ target: started.batch.name, meta: { count: "2" } });

    as(await makeOrg(), "admin");
    expect(await reviewCopyBatch(id, "approve")).toEqual({ ok: false, error: "not_found" });
  });

  it("CSV keeps its columns and adds the approval status last", () => {
    const copy = { title: "T", bullets: ["a"], description: "D", metaTitle: "M", metaDescription: "MD", tags: ["x"] };
    const [header, row] = copiesAsCsv([{ sku: "S1", productName: "P", copy: { en: copy }, review: "approved" }]).replace("﻿", "").split("\r\n");
    expect(header.split(",").at(-1)).toBe('"approval_status"');
    expect(header.split(",").slice(0, 4)).toEqual(['"sku"', '"product_name"', '"language"', '"title"']);
    expect(row.split(",").at(-1)).toBe('"approved"');
  });
});
