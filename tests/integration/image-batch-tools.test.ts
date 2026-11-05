import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { insertConnection } from "@/lib/catalog/connections";
import { db, schema } from "@/lib/db";
import { listGenerations } from "@/lib/generations";
import { parseAplusRows, type RecolorBatchSettings } from "@/lib/image-batch/rows";
import { listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const dispatched: string[] = [];
vi.mock("@/lib/image-batch/queue", async (original) => ({
  ...(await original<typeof import("@/lib/image-batch/queue")>()),
  dispatchImageItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const { runImageItemsInline } = await import("@/lib/image-batch/queue");
const { startRecolorBatch } = await import("@/features/recolor/batch-actions");
const { startAplusBatch } = await import("@/features/aplus/batch-actions");
const { getImageBatchRun, listImageBatchRuns, deleteImageBatchRun } = await import("@/features/image-batch/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"] = "editor") => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};
const withCatalog = async () => {
  const made = await makeOrg();
  await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
  as(made);
  return made;
};

async function recolorForm(patch: Record<string, string | null> = {}) {
  const form = new FormData();
  const values: Record<string, string | null> = { text: "SOFA-12345\nCHAIR-OAK-99", category: "furniture", subcategory: null, hex: "#2F4F4F", scope: "main", aspectRatio: "1:1", resolution: "HD", notes: "", title: "Slate", ...patch };
  for (const [k, v] of Object.entries(values)) if (v !== null) form.set(k, v);
  if (patch.swatch !== null) {
    const bytes = await readFile(path.join(process.cwd(), "public/demo/sofa-source.png"));
    form.set("swatch", new File([bytes], "slate.png", { type: "image/png" }));
  }
  return form;
}

const APLUS_CSV = [
  "sku,title,subtitle,feature_1,feature_1_text,feature_2,feature_2_text",
  'SOFA-12345,Oslo Sofa,"Soft, deep seats",Linen,Breathable woven linen,Oak legs,Solid oak',
  "CHAIR-OAK-99,,Made to last,Shell,Curved moulded shell,Legs,Powder-coated steel",
].join("\n");
const aplusSettings = { category: "furniture", subcategory: null, layout: "bento", scene: null, style: null, aspectRatio: "16:9", resolution: "HD", title: "A+ bento" };

beforeEach(() => {
  dispatched.length = 0;
  vi.stubEnv("IMAGINE_DEMO", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("bulk recolor", () => {
  it("applies one stored swatch to every SKU, saves each to History, and removes the swatch with the run", async () => {
    const made = await withCatalog();
    const started = await startRecolorBatch(await recolorForm());
    if (!started.ok) throw new Error(started.error);
    const settings = started.batch.settings as RecolorBatchSettings;
    expect(started.batch).toMatchObject({ tool: "recolor", total: 2 });
    expect(settings).toMatchObject({ hex: "#2F4F4F", swatchName: "slate.png", scope: "main" });
    const [swatch] = await db.select().from(schema.assets).where(eq(schema.assets.id, settings.swatchAssetId));
    expect(swatch).toMatchObject({ kind: "swatch", orgId: made.org.id });

    await runImageItemsInline(made.org.id, dispatched);
    const run = await getImageBatchRun(started.batch.id);
    expect(run?.items.map((i) => i.status)).toEqual(["done", "done"]);
    const history = await listGenerations(made.org.id);
    expect(history.map((g) => g.mode)).toEqual(["recolor", "recolor"]);
    expect(history[0]).toMatchObject({ title: "Slate", settings: { hex: "#2F4F4F", swatch: "slate.png", batchId: started.batch.id } });
    expect((await listUsage(made.org.id)).filter((u) => u.feature === "recolor")).toHaveLength(2);
    expect((await listImageBatchRuns("recolor")).map((b) => b.id)).toEqual([started.batch.id]);
    expect(await listImageBatchRuns("generate")).toEqual([]);

    expect(await deleteImageBatchRun(started.batch.id)).toEqual({ ok: true });
    expect(await db.select().from(schema.assets).where(eq(schema.assets.id, settings.swatchAssetId))).toEqual([]);
    expect(await listGenerations(made.org.id)).toHaveLength(2); // images stay in History
  });

  it("refuses a missing swatch, a bad colour or scope, viewers, and orgs without a catalog", async () => {
    const made = await withCatalog();
    expect(await startRecolorBatch(await recolorForm({ swatch: null }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startRecolorBatch(await recolorForm({ hex: "slate" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startRecolorBatch(await recolorForm({ scope: "everything" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startRecolorBatch(await recolorForm({ subcategory: "spaceships" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await startRecolorBatch(await recolorForm({ text: "" }))).toEqual({ ok: false, error: "empty" });
    as(made, "viewer");
    expect(await startRecolorBatch(await recolorForm())).toEqual({ ok: false, error: "forbidden" });
    as(await makeOrg());
    expect(await startRecolorBatch(await recolorForm())).toEqual({ ok: false, error: "no_connection" });
    expect(await db.select().from(schema.assets).where(eq(schema.assets.kind, "swatch")).then((r) => r.filter((a) => a.orgId === workspace.orgId))).toEqual([]);
  });
});

describe("bulk A+", () => {
  it("parses per-product text: header aliases, quoted commas, 2–4 features, limits, duplicates", () => {
    const parsed = parseAplusRows(
      [
        "SKU,Title,Subtitle,Feature 1,Feature 1 text,feature_2_title,feature_2_description",
        'A-1,Oslo,"Soft, deep",Linen,Woven,Oak,Solid',
        "A-2,Only one,,Linen,Woven,,",
        "a-1,Dup,,x,y,z,w",
        `A-3,${"T".repeat(61)},,x,y,z,w`,
        ",No SKU,,x,y,z,w",
      ].join("\n"),
    );
    expect(parsed.rows).toEqual([{ sku: "A-1", productSize: "", data: { title: "Oslo", subtitle: "Soft, deep", features: [{ title: "Linen", description: "Woven" }, { title: "Oak", description: "Solid" }] } }]);
    expect(parsed.skipped).toEqual([
      { row: 2, reason: "missing_features" },
      { row: 3, reason: "duplicate" },
      { row: 4, reason: "too_long" },
      { row: 5, reason: "invalid_sku" },
    ]);
  });

  it("makes one A+ image per row; an empty title uses the catalog name", async () => {
    const made = await withCatalog();
    const started = await startAplusBatch({ text: APLUS_CSV, settings: aplusSettings });
    if (!started.ok) throw new Error(started.error);
    await runImageItemsInline(made.org.id, dispatched);
    expect((await getImageBatchRun(started.batch.id))?.items.map((i) => i.status)).toEqual(["done", "done"]);
    const history = await listGenerations(made.org.id);
    const chair = history.find((g) => g.sku === "CHAIR-OAK-99")!;
    expect(history.map((g) => g.mode)).toEqual(["aplus", "aplus"]);
    expect(history.find((g) => g.sku === "SOFA-12345")?.title).toBe("Oslo Sofa");
    expect(chair.title.length).toBeGreaterThan(0); // from the demo catalog's product name
    expect(chair.settings).toMatchObject({ layout: "bento", subtitle: "Made to last", batchId: started.batch.id });
    expect(JSON.parse(chair.settings.features!)).toHaveLength(2);
    expect((await listUsage(made.org.id)).filter((u) => u.feature === "aplus")).toHaveLength(2);
  });

  it("refuses unknown layouts, scenes outside the category, and CSVs without usable rows", async () => {
    await withCatalog();
    expect(await startAplusBatch({ text: APLUS_CSV, settings: { ...aplusSettings, layout: "magazine" } })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startAplusBatch({ text: APLUS_CSV, settings: { ...aplusSettings, scene: "nope" } })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startAplusBatch({ text: "sku,title\nA-1,No features", settings: aplusSettings })).toEqual({ ok: false, error: "empty" });
  });
});
