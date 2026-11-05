import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { getBrandKit } from "@/lib/brand/brand-kit";
import { EMPTY_BRAND_KIT, type BrandKit } from "@/lib/brand/limits";
import { getCopy } from "@/lib/copy/copies";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const dispatched: string[] = [];
vi.mock("@/lib/copy/batch-queue", async (original) => ({
  ...(await original<typeof import("@/lib/copy/batch-queue")>()),
  dispatchItems: async (_orgId: string, ids: string[]) => void dispatched.push(...ids),
}));

const { runInline } = await import("@/lib/copy/batch-queue");
const { getBrandKitSettings, getBrandKitSummary, saveBrandKit } = await import("@/features/brand/actions");
const { generateProductCopy } = await import("@/features/copy/actions");
const { startCopyBatch, getCopyBatch } = await import("@/features/copy/batch-actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const asWorkspace = (made: Made, role: Workspace["role"] = "admin") => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

const kit = (patch: Partial<BrandKit> = {}): BrandKit => ({
  ...EMPTY_BRAND_KIT,
  name: "Northwind Home",
  voice: "warm and practical",
  useWords: ["crafted"],
  avoidWords: ["cheap"],
  ...patch,
});

const form = (patch: Record<string, string> = {}) => {
  const data = new FormData();
  const values: Record<string, string | string[]> = { sku: "SOFA-9", productName: "Oslo Sofa", category: "furniture", details: "Oak legs, cheap to run", keywords: "", tone: "friendly", length: "short", channel: "website", languages: ["en", "ar"], ...patch };
  for (const [k, v] of Object.entries(values)) for (const one of [v].flat()) data.append(k, one);
  return data;
};

let prompts: string[] = [];
async function fakeGemini(_input: RequestInfo | URL, init?: RequestInit) {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  prompts.push(JSON.stringify(body));
  const one = { title: "t", bullets: ["b"], description: "d", metaTitle: "m", metaDescription: "md", tags: ["x"] };
  const text = JSON.stringify({ en: one, ar: one });
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  prompts = [];
  dispatched.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("brand kit settings", () => {
  it("admins save a cleaned kit, every change is audited, an empty kit removes it", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    expect(await getBrandKitSummary()).toBeNull();

    const saved = await saveBrandKit({ ...kit(), name: "  Northwind Home ", useWords: [" crafted", "crafted", "", "easy care"], rules: "No exclamation marks" });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.kit).toMatchObject({ name: "Northwind Home", useWords: ["crafted", "easy care"], rules: "No exclamation marks", updatedBy: made.user.name });
    expect(await getBrandKitSummary()).toEqual({ name: "Northwind Home" });

    const removed = await saveBrandKit(EMPTY_BRAND_KIT);
    expect(removed).toEqual({ ok: true, kit: null });
    expect(await getBrandKit(made.org.id)).toBeNull();
    // Saving an empty kit when there is none is a no-op, not another audit entry.
    await saveBrandKit(EMPTY_BRAND_KIT);
    expect((await listAudit(made.org.id, { prefix: "brand_kit." })).map((e) => e.action)).toEqual(["brand_kit.removed", "brand_kit.updated"]);
  });

  it("caps long fields and word lists, and rejects the wrong shape", async () => {
    asWorkspace(await makeOrg());
    const saved = await saveBrandKit(kit({ about: "a".repeat(5000), avoidWords: Array.from({ length: 50 }, (_, i) => `w${i}`) }));
    expect(saved.ok && saved.kit?.about.length).toBe(600);
    expect(saved.ok && saved.kit?.avoidWords).toHaveLength(30);
    expect(await saveBrandKit({ ...kit(), useWords: "crafted" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveBrandKit(null)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("only admins change it; everyone in the org can read it; other orgs can't see it", async () => {
    const made = await makeOrg();
    asWorkspace(made);
    await saveBrandKit(kit());
    for (const role of ["editor", "viewer"] as const) {
      asWorkspace(made, role);
      expect(await saveBrandKit(kit({ name: "Hijacked" }))).toEqual({ ok: false, error: "forbidden" });
      expect(await getBrandKitSettings()).toMatchObject({ canManage: false, kit: { name: "Northwind Home" } });
    }
    asWorkspace(await makeOrg());
    expect((await getBrandKitSettings()).kit).toBeNull();
  });
});

describe("copy with the brand kit", () => {
  it("adds the kit to the prompt when on, leaves it out when off, and records the choice", async () => {
    vi.stubGlobal("fetch", fakeGemini);
    const made = await makeOrg();
    asWorkspace(made);
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash"], createdBy: "t" });
    await saveBrandKit(kit());

    const on = await generateProductCopy(form());
    if (!on.ok) throw new Error(on.error);
    expect(prompts[0]).toContain("Brand: Northwind Home");
    expect(prompts[0]).toContain("Brand voice: warm and practical");
    expect(prompts[0]).toContain("Never use these words or their translations in any language: cheap.");
    expect(on.copy.settings.brandVoice).toBe(true);

    const off = await generateProductCopy(form({ brandVoice: "off" }));
    if (!off.ok) throw new Error(off.error);
    expect(prompts[1]).not.toContain("Northwind");
    expect(off.copy.settings.brandVoice).toBe(false);
  });

  it("the demo writer shows the kit offline: brand in the meta title, avoided words taken out", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    asWorkspace(await makeOrg());
    await saveBrandKit(kit());
    const result = await generateProductCopy(form());
    if (!result.ok) throw new Error(result.error);
    expect(result.copy.copy.en?.metaTitle).toBe("Oslo Sofa | Northwind Home");
    expect(JSON.stringify(result.copy.copy)).not.toMatch(/cheap/i);
  });

  it("bulk runs carry the choice to every product", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    asWorkspace(made);
    await saveBrandKit(kit());
    const settings = { category: "furniture", tone: "friendly", length: "short", channel: "website", languages: ["en"] } as const;
    const run = async (brandVoice: boolean) => {
      dispatched.length = 0;
      const result = await startCopyBatch({ text: "OSLO-1,Oslo Sofa", settings: { ...settings, languages: [...settings.languages], brandVoice } });
      if (!result.ok) throw new Error(result.error);
      await runInline(made.org.id, dispatched);
      const batch = await getCopyBatch(result.batch.id);
      return getCopy(made.org.id, batch!.items[0].copyId!);
    };
    expect((await run(true))?.copy.en?.metaTitle).toBe("Oslo Sofa | Northwind Home");
    const off = await run(false);
    expect(off?.settings.brandVoice).toBe(false);
    expect(off?.copy.en?.metaTitle).not.toContain("Northwind");
  });
});
