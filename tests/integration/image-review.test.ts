import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { insertConnection } from "@/lib/catalog/connections";
import { getGenerations, insertGeneration, type GenerationMode } from "@/lib/generations";
import { saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Image approvals and the publish gate (roadmap B4).

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const notices = vi.hoisted(() => ({ submitted: [] as Record<string, unknown>[], reviewed: [] as Record<string, unknown>[] }));
vi.mock("@/lib/email/notify", async (original) => ({
  ...(await original<typeof import("@/lib/email/notify")>()),
  notifyImagesSubmitted: async (input: Record<string, unknown>) => void notices.submitted.push(input),
  notifyImagesReviewed: async (input: Record<string, unknown>) => void notices.reviewed.push(input),
  requestEmailLocale: async () => "en",
}));

// Uploads are queued (one job per image); here each one runs at once, as the worker would.
vi.mock("@/lib/catalog/publish-queue", () => ({
  dispatchPublishes: async (orgId: string, ids: string[]) => {
    const { runPublish } = await import("@/lib/catalog/publish");
    for (const id of ids) await runPublish(orgId, id);
  },
}));

const { markGenerationsUploaded, publishGenerations, queryHistory, reviewImages } = await import("@/features/history/actions");
const { getCatalogIntegrations, setImageApproval } = await import("@/features/integrations/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;

function as(made: Made, role: Workspace["role"], id = made.user.id) {
  workspace = {
    orgId: made.org.id,
    orgName: made.org.name,
    role,
    plan: made.org.plan,
    user: { id, name: `${role} person`, email: made.user.email },
    isSuperAdmin: false,
    orgs: [],
    creditsMonthly: 500,
    creditsRemaining: 500,
  };
}

async function image(made: Made, over: { sku?: string; mode?: GenerationMode; createdById?: string | null } = {}) {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#884422" } }).png().toBuffer();
  const assetId = await saveAsset(made.org.id, new Uint8Array(png), "image/png", "generation");
  return insertGeneration({
    orgId: made.org.id,
    mode: over.mode ?? "lifestyle",
    sku: over.sku ?? "SOFA-12345", // a product the demo store has
    title: "Oslo Sofa",
    assetId,
    mimeType: "image/png",
    width: 8,
    height: 8,
    settings: {},
    provider: "demo",
    model: "m",
    createdBy: "maker",
    createdById: over.createdById ?? null,
  });
}

/** An org with a store to upload to, signed in as its admin. */
async function withStore() {
  const made = await makeOrg("pro");
  await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
  as(made, "admin");
  return made;
}

const one = async (orgId: string, id: string) => (await getGenerations(orgId, [id]))[0];
const query = () => queryHistory({ sort: "newest", page: 1, pageSize: 24 });

beforeEach(() => {
  vi.stubEnv("IMAGINE_DEMO", "1");
  notices.submitted.length = 0;
  notices.reviewed.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("reviewing images", () => {
  it("goes draft → in review → changes requested → in review → approved, audited", async () => {
    const made = await withStore();
    const { id, sku } = await image(made, { sku: "OSLO-1" });
    expect((await one(made.org.id, id)).reviewStatus).toBe("draft");

    as(made, "editor");
    expect(await reviewImages([id], "submit")).toEqual({ ok: true, changed: 1 });
    expect((await one(made.org.id, id)).reviewStatus).toBe("in_review");

    as(made, "admin");
    expect(await reviewImages([id], "request_changes", "  Brighter room  ")).toEqual({ ok: true, changed: 1 });
    expect(await one(made.org.id, id)).toMatchObject({ reviewStatus: "changes_requested", reviewNote: "Brighter room", reviewedBy: "admin person" });

    // Sending it again clears the old note.
    as(made, "editor");
    await reviewImages([id], "submit");
    expect(await one(made.org.id, id)).toMatchObject({ reviewStatus: "in_review", reviewNote: null, reviewedBy: null });

    as(made, "admin");
    await reviewImages([id], "approve");
    expect((await one(made.org.id, id)).reviewStatus).toBe("approved");

    const entries = await listAudit(made.org.id, { prefix: "image." });
    expect(entries.map((e) => e.action).sort()).toEqual(["image.approved", "image.changes_requested", "image.submitted", "image.submitted"]);
    expect(entries[0]).toMatchObject({ target: sku, meta: { generationId: id } });
  });

  it("does nothing when a step doesn't apply, without an audit entry", async () => {
    const made = await withStore();
    const { id } = await image(made);
    await reviewImages([id], "approve");
    const before = (await listAudit(made.org.id, { prefix: "image." })).length;
    expect(await reviewImages([id], "approve")).toEqual({ ok: true, changed: 0 });
    expect(await reviewImages([id], "submit")).toEqual({ ok: true, changed: 0 });
    expect((await listAudit(made.org.id, { prefix: "image." })).length).toBe(before);
  });

  it("follows roles: viewers nothing, editors submit, only admins decide", async () => {
    const made = await withStore();
    const { id } = await image(made);
    as(made, "viewer");
    expect(await reviewImages([id], "submit")).toEqual({ ok: false, error: "forbidden" });
    as(made, "editor");
    expect(await reviewImages([id], "approve")).toEqual({ ok: false, error: "forbidden" });
    expect(await reviewImages([id], "request_changes", "No")).toEqual({ ok: false, error: "forbidden" });
    expect((await one(made.org.id, id)).reviewStatus).toBe("draft");
  });

  it("wants a note for a change request and refuses unknown steps", async () => {
    const made = await withStore();
    const { id } = await image(made);
    await reviewImages([id], "submit");
    expect(await reviewImages([id], "request_changes", "   ")).toEqual({ ok: false, error: "invalid_input" });
    expect(await reviewImages([id], "toString" as "submit")).toEqual({ ok: false, error: "invalid_input" });
    expect((await one(made.org.id, id)).reviewStatus).toBe("in_review");
  });

  it("can't touch another org's images", async () => {
    const mine = await withStore();
    const theirs = await makeOrg("pro");
    const { id } = await image(theirs);
    as(mine, "admin");
    expect(await reviewImages([id], "approve")).toEqual({ ok: true, changed: 0 });
    expect((await one(theirs.org.id, id)).reviewStatus).toBe("draft");
  });

  it("leaves videos out of review and of the approval filter", async () => {
    const made = await withStore();
    const video = await image(made, { mode: "video", sku: "" });
    const photo = await image(made);
    expect(await reviewImages([video.id, photo.id], "approve")).toEqual({ ok: true, changed: 1 });
    expect((await one(made.org.id, video.id)).reviewStatus).toBe("draft");
    const drafts = await queryHistory({ sort: "newest", page: 1, pageSize: 24, review: "draft" });
    expect(drafts.items).toHaveLength(0);
    const approved = await queryHistory({ sort: "newest", page: 1, pageSize: 24, review: "approved" });
    expect(approved.items.map((i) => i.id)).toEqual([photo.id]);
    expect(approved.items[0].reviewStatus).toBe("approved");
  });

  it("tells admins about a submission, and each maker about their own images", async () => {
    const made = await withStore();
    const a = await image(made, { createdById: "maker-a", sku: "A-1" });
    const b = await image(made, { createdById: "maker-a", sku: "A-2" });
    const c = await image(made, { createdById: "maker-b", sku: "B-1" });

    as(made, "editor");
    await reviewImages([a.id, b.id, c.id], "submit");
    expect(notices.submitted).toHaveLength(1);
    expect(notices.submitted[0]).toMatchObject({ count: 3 });

    as(made, "admin");
    await reviewImages([a.id, b.id, c.id], "approve");
    const byAuthor = Object.fromEntries(notices.reviewed.map((n) => [n.authorId, n]));
    expect(Object.keys(byAuthor).sort()).toEqual(["maker-a", "maker-b"]);
    expect(byAuthor["maker-a"]).toMatchObject({ outcome: "approved", count: 2 });
    expect(byAuthor["maker-b"]).toMatchObject({ outcome: "approved", count: 1, label: "B-1" });
    const bulk = await listAudit(made.org.id, { prefix: "image.approved" });
    expect(bulk[0]).toMatchObject({ target: "3", meta: { count: "3" } });
  });
});

describe("the publish gate", () => {
  it("is off by default: a draft uploads as before", async () => {
    const made = await withStore();
    const { id } = await image(made);
    expect((await query()).approvalRequired).toBe(false);
    expect((await query()).pendingCount).toBe(1);
    expect(await publishGenerations([id])).toEqual({ ok: true, queued: 1, notApproved: 0 });
    expect((await one(made.org.id, id)).status).toBe("uploaded");
  });

  it("refuses an unapproved image by id, without marking it failed", async () => {
    const made = await withStore();
    const { id } = await image(made);
    await setImageApproval(true);
    expect(await publishGenerations([id])).toEqual({ ok: true, queued: 0, notApproved: 1 });
    expect(await one(made.org.id, id)).toMatchObject({ status: "pending", publishError: null, publishedAt: null });

    await reviewImages([id], "approve");
    expect(await publishGenerations([id])).toEqual({ ok: true, queued: 1, notApproved: 0 });
    expect((await one(made.org.id, id)).status).toBe("uploaded");
  });

  it("uploads only approved images with \"upload all\", and counts both groups", async () => {
    const made = await withStore();
    const approved = await image(made);
    const draft = await image(made);
    const inReview = await image(made);
    await setImageApproval(true);
    await reviewImages([approved.id], "approve");
    await reviewImages([inReview.id], "submit");

    const before = await query();
    expect(before).toMatchObject({ approvalRequired: true, pendingCount: 1, awaitingApprovalCount: 2 });

    expect(await publishGenerations("all-pending")).toEqual({ ok: true, queued: 1, notApproved: 0 });
    expect((await one(made.org.id, approved.id)).status).toBe("uploaded");
    expect((await one(made.org.id, draft.id)).status).toBe("pending");
    expect((await one(made.org.id, inReview.id)).status).toBe("pending");
    expect(await query()).toMatchObject({ pendingCount: 0, awaitingApprovalCount: 2 });
  });

  it("blocks again when an approval is withdrawn", async () => {
    const made = await withStore();
    const { id } = await image(made);
    await setImageApproval(true);
    await reviewImages([id], "approve");
    await reviewImages([id], "request_changes", "Wrong colour");
    expect(await publishGenerations([id])).toEqual({ ok: true, queued: 0, notApproved: 1 });
  });

  it("can't be sidestepped with Mark as uploaded", async () => {
    const made = await withStore();
    const approved = await image(made);
    const draft = await image(made);
    await setImageApproval(true);
    await reviewImages([approved.id], "approve");
    expect(await markGenerationsUploaded([approved.id, draft.id])).toEqual({ ok: true, count: 1, skipped: 1 });
    expect((await one(made.org.id, approved.id)).status).toBe("uploaded");
    expect((await one(made.org.id, draft.id)).status).toBe("pending");
  });

  it("stops applying when it is turned off", async () => {
    const made = await withStore();
    const { id } = await image(made);
    await setImageApproval(true);
    await setImageApproval(false);
    expect(await query()).toMatchObject({ approvalRequired: false, awaitingApprovalCount: 0, pendingCount: 1 });
    expect(await publishGenerations([id])).toEqual({ ok: true, queued: 1, notApproved: 0 });
  });

  it("only admins switch it, it's audited, and it belongs to one org", async () => {
    const made = await withStore();
    const other = await withStore();
    as(made, "editor");
    expect(await setImageApproval(true)).toEqual({ ok: false, error: "forbidden" });
    as(made, "admin");
    expect((await getCatalogIntegrations()).imageApprovalRequired).toBe(false);
    expect(await setImageApproval(true)).toEqual({ ok: true });
    expect((await getCatalogIntegrations()).imageApprovalRequired).toBe(true);
    const [entry] = await listAudit(made.org.id, { prefix: "org.image_approval_changed" });
    expect(entry).toMatchObject({ actor: "admin person", target: "on" });
    as(other, "admin");
    expect((await getCatalogIntegrations()).imageApprovalRequired).toBe(false);
  });
});
