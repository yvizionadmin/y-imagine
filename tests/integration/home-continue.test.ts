import { describe, expect, it, vi } from "vitest";
import { finishItem, insertBatch, listBatchItems, settleBatch } from "@/lib/copy/batches";
import { insertDirector } from "@/lib/director/projects";
import { DEFAULT_DIRECTOR_SETTINGS } from "@/lib/director/limits";
import { insertEdit } from "@/lib/editor/edits";
import { EMPTY_TIMELINE } from "@/lib/editor/timeline";
import { finishImageItem, insertImageBatch } from "@/lib/image-batch/batches";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// U2: Home's "Continue where you left off": the org's latest projects and bulk runs, read only.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
const { listContinueItems } = await import("@/features/studio/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"] = "admin") => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};
const tick = () => new Promise((r) => setTimeout(r, 5));
const by = (made: Made) => ({ orgId: made.org.id, createdBy: made.user.name, createdById: made.user.id });

describe("listContinueItems", () => {
  it("lists the org's Director and editor projects and bulk runs, newest first, each with where it opens", async () => {
    const made = await makeOrg();
    as(made, "viewer"); // read only: viewers see it too
    expect(await listContinueItems()).toEqual([]);

    const director = await insertDirector({ ...by(made), idea: "A calm Sunday with our oak chair", settings: DEFAULT_DIRECTOR_SETTINGS });
    await tick();
    const edit = await insertEdit({ ...by(made), name: "Launch cut", timeline: EMPTY_TIMELINE });
    await tick();
    const { batch: images, items } = await insertImageBatch({ ...by(made), tool: "recolor", name: "Spring colours", settings: {} as never, rows: [{ sku: "A1", productSize: "" }, { sku: "A2", productSize: "" }] });
    await finishImageItem(made.org.id, items[0].id, { status: "done" });
    await tick();
    const copy = await insertBatch({ ...by(made), name: "Chair copy", settings: {} as never, rows: [{ sku: "C1", productName: "Chair", category: null, details: "oak", keywords: [] }] });
    const [copyItem] = await listBatchItems(made.org.id, copy.batch.id);
    await finishItem(made.org.id, copyItem.id, { status: "failed", error: "provider_error" });
    await settleBatch(made.org.id, copy.batch.id);

    const list = await listContinueItems();
    expect(list.map((i) => [i.kind, i.title, i.href, i.state, i.progress])).toEqual([
      ["copyBulk", "Chair copy", "/copy/bulk", "failed", { done: 0, total: 1 }],
      ["recolorBulk", "Spring colours", "/recolor/bulk", "working", { done: 1, total: 2 }],
      ["editor", "Launch cut", `/editor?project=${edit.id}`, "draft", null],
      ["director", "A calm Sunday with our oak chair", `/editor/director?project=${director.id}`, "working", null],
    ]);
    expect(list.map((i) => i.id)).toEqual([copy.batch.id, images.id, edit.id, director.id]);

    // Other orgs see none of it.
    as(await makeOrg());
    expect(await listContinueItems()).toEqual([]);
  });

  it("shows at most six, the newest", async () => {
    const made = await makeOrg();
    as(made);
    for (let i = 0; i < 8; i++) {
      await insertEdit({ ...by(made), name: `Cut ${i}`, timeline: EMPTY_TIMELINE });
      await tick();
    }
    expect((await listContinueItems()).map((i) => i.title)).toEqual(["Cut 7", "Cut 6", "Cut 5", "Cut 4", "Cut 3", "Cut 2"]);
  });
});
