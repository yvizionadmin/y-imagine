import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProvider } from "@/lib/ai/providers/demo";
import { listAudit } from "@/lib/audit";
import { insertConnection } from "@/lib/catalog/connections";
import { resolveProductType } from "@/lib/catalog/org-catalog";
import { customTypeValue, PRODUCT_TYPES_PER_CATEGORY } from "@/lib/product-types";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// B6: product types per org. Admins choose the categories the org sells and add their own types;
// tools accept them for that org only and give the model the type's name.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
// The duplicate check names built-in types in both languages, as the pages do.
vi.mock("next-intl/server", async () => {
  const en = (await import("../../messages/en.json")).default as unknown as { Presets: Record<string, Record<string, string>> };
  const ar = (await import("../../messages/ar.json")).default as unknown as { Presets: Record<string, Record<string, string>> };
  return {
    getTranslations: async ({ locale }: { locale: "en" | "ar" }) => (key: string) => {
      const [group, name] = key.split(".");
      return (locale === "ar" ? ar : en).Presets[group][name];
    },
  };
});

const { addProductType, getProductTypes, removeProductType, setCategoryVisible } = await import("@/features/product-types/actions");
const { generateLifestyleImage } = await import("@/features/generate/actions");
const { startImageBatch } = await import("@/features/generate/batch-actions");

async function signedIn(role: Workspace["role"] = "admin") {
  const made = await makeOrg();
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made.org.id;
}

const png = async () => new File([new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#888" } }).png().toBuffer())], "sofa.png", { type: "image/png" });

beforeEach(() => vi.stubEnv("IMAGINE_DEMO", "1"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("product types per org", () => {
  it("two orgs see different product types and categories", async () => {
    const first = await signedIn();
    const added = await addProductType("furniture", "  Rattan   daybeds ");
    expect(added).toMatchObject({ ok: true, type: { category: "furniture", name: "Rattan daybeds" } });
    expect(await setCategoryVisible("cosmetics", false)).toEqual({ ok: true });

    await signedIn();
    expect(await getProductTypes()).toEqual({ hiddenCategories: [], productTypes: [], canManage: true });

    workspace = { ...workspace, orgId: first };
    const mine = await getProductTypes();
    expect(mine.hiddenCategories).toEqual(["cosmetics"]);
    expect(mine.productTypes.map((t) => t.name)).toEqual(["Rattan daybeds"]);
    expect((await listAudit(first, { prefix: "catalog." })).map((e) => [e.action, e.target])).toEqual([
      ["catalog.category_hidden", "cosmetics"],
      ["catalog.type_added", "furniture: Rattan daybeds"],
    ]);

    expect(await setCategoryVisible("cosmetics", true)).toEqual({ ok: true });
    expect((await getProductTypes()).hiddenCategories).toEqual([]);
  });

  it("refuses duplicates (own or built-in, either language, any case), the per-category limit and bad input", async () => {
    await signedIn();
    expect((await addProductType("furniture", "Daybeds")).ok).toBe(true);
    expect(await addProductType("furniture", "DAYBEDS")).toEqual({ ok: false, error: "duplicate" });
    expect(await addProductType("furniture", "sofas")).toEqual({ ok: false, error: "duplicate" });
    expect(await addProductType("furniture", "الكنب")).toEqual({ ok: false, error: "duplicate" });
    expect((await addProductType("outdoor", "Daybeds")).ok).toBe(true); // another category
    expect(await addProductType("furniture", " ")).toEqual({ ok: false, error: "invalid_input" });
    expect(await addProductType("furniture", "x".repeat(61))).toEqual({ ok: false, error: "invalid_input" });
    expect(await addProductType("notACategory", "Things")).toEqual({ ok: false, error: "invalid_input" });
    for (let i = 1; i < PRODUCT_TYPES_PER_CATEGORY; i++) expect((await addProductType("decor", `Type ${i}`)).ok).toBe(true);
    expect((await addProductType("decor", "One more")).ok).toBe(true);
    expect(await addProductType("decor", "Too many")).toEqual({ ok: false, error: "limit" });
  });

  it("keeps at least one category, and only admins change anything", async () => {
    await signedIn();
    const { productTypes: _none, hiddenCategories } = await getProductTypes();
    expect(_none).toEqual([]);
    expect(hiddenCategories).toEqual([]);
    const keys = ["furniture", "homeAppliances", "kitchenAppliances", "mobile", "fashion", "outdoor", "kidsToys", "cosmetics", "lighting", "outdoorKidsToys", "bathroom", "decor"];
    for (const key of keys.slice(1)) expect(await setCategoryVisible(key, false)).toEqual({ ok: true });
    expect(await setCategoryVisible("furniture", false)).toEqual({ ok: false, error: "invalid_input" });

    const added = await addProductType("furniture", "Daybeds");
    workspace = { ...workspace, role: "editor" };
    expect((await getProductTypes()).canManage).toBe(false);
    expect(await addProductType("furniture", "Chaises")).toEqual({ ok: false, error: "forbidden" });
    expect(await setCategoryVisible("decor", true)).toEqual({ ok: false, error: "forbidden" });
    expect(await removeProductType(added.ok ? added.type.id : "")).toEqual({ ok: false, error: "forbidden" });
    workspace = { ...workspace, role: "admin" };
    expect(await removeProductType(added.ok ? added.type.id : "")).toEqual({ ok: true });
    expect(await removeProductType(added.ok ? added.type.id : "")).toEqual({ ok: false, error: "not_found" });
  });

  it("an own type is valid only for its org and category; built-in keys stay as they are", async () => {
    const orgId = await signedIn();
    const added = await addProductType("furniture", "Daybeds");
    if (!added.ok) throw new Error("not added");
    const value = customTypeValue(added.type.id);
    expect(await resolveProductType(orgId, "furniture", value)).toBe("Daybeds");
    expect(await resolveProductType(orgId, "outdoor", value)).toBeUndefined();
    expect(await resolveProductType(orgId, "furniture", "sofas")).toBe("sofas");
    expect(await resolveProductType(orgId, "furniture", "faucets")).toBeUndefined();
    expect(await resolveProductType(orgId, "furniture", null)).toBeNull();
    const other = await signedIn();
    expect(await resolveProductType(other, "furniture", value)).toBeUndefined();
  });

  it("Generate and bulk Generate give the model the own type's name; another org's type is refused", async () => {
    const orgId = await signedIn();
    const added = await addProductType("furniture", "Rattan daybeds");
    if (!added.ok) throw new Error("not added");
    const spy = vi.spyOn(demoProvider, "generateLifestyle");
    const form = async (subcategory: string) => {
      const data = new FormData();
      for (const [k, v] of Object.entries({ sku: "DAY-1", category: "furniture", aspectRatio: "1:1", resolution: "HD", subcategory })) data.set(k, v);
      data.set("product", await png());
      return data;
    };
    expect((await generateLifestyleImage(await form(customTypeValue(added.type.id)))).ok).toBe(true);
    expect(spy.mock.calls[0][0].subcategory).toBe("Rattan daybeds");

    await insertConnection({ orgId, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
    const batch = await startImageBatch({ text: "DAY-1", settings: { category: "furniture", subcategory: customTypeValue(added.type.id), aspectRatio: "1:1", resolution: "HD", catalogImage: 1 } });
    expect(batch).toMatchObject({ ok: true, batch: { settings: { subcategory: "Rattan daybeds" } } });

    await signedIn();
    expect(await generateLifestyleImage(await form(customTypeValue(added.type.id)))).toEqual({ ok: false, error: "invalid_input" });
    expect(orgId).not.toBe(workspace.orgId);
  });
});
