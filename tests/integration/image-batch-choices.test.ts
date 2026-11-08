import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertConnection } from "@/lib/catalog/connections";
import { listGenerations } from "@/lib/generations";
import { catalogTitle, parseCatalogImage, usableImagePosition } from "@/lib/image-batch/rows";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Bulk improvements (roadmap B7): which catalog image a run uses, and Arabic titles for bulk A+.
// The demo catalog: SOFA-12345 has one image, CHAIR-OAK-99 two, and both have Arabic names.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const dispatched: string[] = [];
vi.mock("@/lib/image-batch/queue", async (original) => ({
  ...(await original<typeof import("@/lib/image-batch/queue")>()),
  dispatchImageItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const imported = vi.hoisted(() => [] as { sku: string; url: string }[]);
vi.mock("@/lib/catalog/lookup", async (original) => {
  const real = await original<typeof import("@/lib/catalog/lookup")>();
  return {
    ...real,
    importProductPng: (orgId: string, sku: string, url: string) => {
      imported.push({ sku, url });
      return real.importProductPng(orgId, sku, url);
    },
  };
});

const { runImageItemsInline } = await import("@/lib/image-batch/queue");
const { startImageBatch } = await import("@/features/generate/batch-actions");
const { startAplusBatch } = await import("@/features/aplus/batch-actions");
const { startRecolorBatch } = await import("@/features/recolor/batch-actions");

async function withCatalog() {
  const made = await makeOrg();
  await insertConnection({ orgId: made.org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
  workspace = {
    orgId: made.org.id,
    orgName: made.org.name,
    role: "editor",
    plan: made.org.plan,
    user: { id: made.user.id, name: made.user.name, email: made.user.email },
    isSuperAdmin: false,
    orgs: [],
    creditsMonthly: 500,
    creditsRemaining: 500,
  };
  return made;
}

const generate = (text: string, extra: Record<string, unknown> = {}) =>
  startImageBatch({ text, settings: { category: "furniture", customScene: "A bright room", aspectRatio: "1:1", resolution: "HD", title: "Bulk", ...extra } });

const APLUS = (title = "") => ["sku,title,subtitle,feature_1,feature_1_text,feature_2,feature_2_text", `CHAIR-OAK-99,${title},Sub,Oak,Solid oak,Soft,Soft seat`].join("\n");
const aplus = (text: string, extra: Record<string, unknown> = {}) => startAplusBatch({ text, settings: { category: "furniture", aspectRatio: "1:1", resolution: "HD", title: "Bulk", ...extra } });

async function run(orgId: string) {
  await runImageItemsInline(orgId, [...dispatched]);
  return listGenerations(orgId);
}

beforeEach(() => {
  vi.stubEnv("IMAGINE_DEMO", "1");
  dispatched.length = 0;
  imported.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("rules", () => {
  it("reads the setting: absent is the first image, out of range is refused", () => {
    expect(parseCatalogImage(undefined)).toBe(1);
    expect(parseCatalogImage(null)).toBe(1);
    expect(parseCatalogImage("")).toBe(1);
    expect(parseCatalogImage("3")).toBe(3);
    expect(parseCatalogImage(5)).toBe(5);
    for (const bad of [0, 6, -1, 1.5, "two", "../1", {}]) expect(parseCatalogImage(bad), String(bad)).toBeNull();
  });

  it("uses the last image when a product has fewer", () => {
    expect(usableImagePosition(4, 2)).toBe(2);
    expect(usableImagePosition(1, 5)).toBe(1);
    expect(usableImagePosition(2, 5)).toBe(2);
    expect(usableImagePosition(0, 3)).toBe(0);
  });

  it("picks the title by language, falling back to the main name", () => {
    const product = { name: "Oak Chair", nameAr: "كرسي بلوط" };
    expect(catalogTitle(product, "ar")).toBe("كرسي بلوط");
    expect(catalogTitle(product, "en")).toBe("Oak Chair");
    expect(catalogTitle(product, undefined)).toBe("Oak Chair");
    expect(catalogTitle({ name: "Oak Chair", nameAr: null }, "ar")).toBe("Oak Chair");
    expect(catalogTitle({ name: "Oak Chair", nameAr: "   " }, "ar")).toBe("Oak Chair");
  });
});

describe("choosing the catalog image", () => {
  it("uses the first image by default, and records it", async () => {
    const { org } = await withCatalog();
    expect((await generate("CHAIR-OAK-99")).ok).toBe(true);
    const [made] = await run(org.id);
    expect(imported).toEqual([{ sku: "CHAIR-OAK-99", url: "/demo/source-chair.png" }]);
    expect(made.settings.catalogImage).toBe("1");
  });

  it("uses the chosen image, or a product's last one when it has fewer", async () => {
    const { org } = await withCatalog();
    expect((await generate("CHAIR-OAK-99\nSOFA-12345", { catalogImage: 2 })).ok).toBe(true);
    const made = await run(org.id);
    expect(imported).toEqual(
      expect.arrayContaining([
        { sku: "CHAIR-OAK-99", url: "/demo/sofa-source.png" },
        { sku: "SOFA-12345", url: "/demo/sofa-grey-base.png" },
      ]),
    );
    const bySku = Object.fromEntries(made.map((g) => [g.sku, g.settings.catalogImage]));
    expect(bySku).toEqual({ "CHAIR-OAK-99": "2", "SOFA-12345": "1" });
  });

  it("refuses a position out of range, in every tool", async () => {
    await withCatalog();
    expect(await generate("SOFA-12345", { catalogImage: 9 })).toEqual({ ok: false, error: "invalid_input" });
    expect(await aplus(APLUS("T"), { catalogImage: "x" })).toEqual({ ok: false, error: "invalid_input" });
    const form = new FormData();
    for (const [k, v] of Object.entries({ text: "SOFA-12345", category: "furniture", hex: "#2F4F4F", scope: "main", aspectRatio: "1:1", resolution: "HD", catalogImage: "6" })) form.set(k, v);
    form.set("swatch", new File([new Uint8Array([1])], "s.png", { type: "image/png" }));
    expect(await startRecolorBatch(form)).toEqual({ ok: false, error: "invalid_input" });
    expect(dispatched).toHaveLength(0);
  });

  it("reaches bulk A+ too", async () => {
    const { org } = await withCatalog();
    expect((await aplus(APLUS("Title"), { catalogImage: 2 })).ok).toBe(true);
    await run(org.id);
    expect(imported).toEqual([{ sku: "CHAIR-OAK-99", url: "/demo/sofa-source.png" }]);
  });
});

describe("bulk A+ titles from the catalog", () => {
  it("uses the Arabic name when the run asks for it", async () => {
    const { org } = await withCatalog();
    expect((await aplus(APLUS(), { catalogTitle: "ar" })).ok).toBe(true);
    const [made] = await run(org.id);
    expect(made.title).toBe("كرسي استرخاء بإطار من خشب البلوط");
    expect(made.settings.title).toBe(made.title);
  });

  it("uses the main name by default", async () => {
    const { org } = await withCatalog();
    expect((await aplus(APLUS())).ok).toBe(true);
    expect((await run(org.id))[0].title).toBe("Oak Frame Lounge Chair");
  });

  it("keeps a title the row gave, whatever the setting", async () => {
    const { org } = await withCatalog();
    expect((await aplus(APLUS("My own title"), { catalogTitle: "ar" })).ok).toBe(true);
    expect((await run(org.id))[0].title).toBe("My own title");
  });

  it("refuses an unknown language", async () => {
    await withCatalog();
    expect(await aplus(APLUS(), { catalogTitle: "fr" })).toEqual({ ok: false, error: "invalid_input" });
  });
});
