import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/ai/errors";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { getImageProvider } from "@/lib/ai/registry";
import type { LifestyleRequest } from "@/lib/ai/types";
import { DEFAULT_CREDIT_RULES, type CreditRules } from "@/lib/credits";
import { addCreditAdjustment, adjustmentTotal, listCreditAdjustments, monthlyAllowance } from "@/lib/platform/credit-adjustments";
import { updateOrganization } from "@/lib/platform/organizations";
import { getPlatformSettings, savePlatformSettings } from "@/lib/platform/settings";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince, listUsage, startJob } from "@/lib/usage";
import { makeOrg } from "../helpers";

// Credit rules from Admin → Credits: weighted job costs, plan access, plan credits and one-off
// adjustments, all enforced where jobs are reserved.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function fakeOpenAi(input: RequestInfo | URL) {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("api.openai.com")) return json({ error: { message: "unexpected" } }, 500);
  const png = (await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#88aacc" } }).png().toBuffer()).toString("base64");
  return json({ created: 1, data: [{ b64_json: png }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
}

let product: LifestyleRequest["product"];
const lifestyle = (): LifestyleRequest => ({ sku: "SOFA-1", product, reference: null, category: "furniture", scene: "livingRoom", customScene: null, sceneUpload: null, style: "scandinavian", productSize: "", aspectRatio: "1:1", resolution: "HD", instructions: "" });
const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ProviderError ? e.code : `unexpected: ${String(e)}`));

async function setRules(patch: (r: CreditRules) => void) {
  const { updatedAt: _a, updatedBy: _b, ...settings } = await getPlatformSettings();
  void [_a, _b];
  const rules = structuredClone(DEFAULT_CREDIT_RULES);
  patch(rules);
  await savePlatformSettings({ ...settings, creditRules: rules }, "test");
}

async function orgWithKey(plan: Parameters<typeof makeOrg>[0] = "pro") {
  const made = await makeOrg(plan);
  await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
  return made;
}

beforeAll(async () => {
  product = { bytes: new Uint8Array(await readFile("public/demo/sofa-source.png")), mimeType: "image/png", name: "sofa.png" };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await setRules(() => {});
});

describe("credit rules", () => {
  it("are saved with the platform settings and survive a switch-only save", async () => {
    await setRules((r) => ((r.planCredits.pro = 777), (r.featureCosts.copy = 4)));
    const { creditRules: _r, updatedAt: _a, updatedBy: _b, ...switches } = await getPlatformSettings();
    void [_r, _a, _b];
    await savePlatformSettings(switches, "test");
    const after = (await getPlatformSettings()).creditRules;
    expect(after.planCredits.pro).toBe(777);
    expect(after.featureCosts.copy).toBe(4);
  });

  it("charge a job its tool's cost", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    await setRules((r) => (r.featureCosts.generate = 3));
    const { org, actor } = await orgWithKey();
    await (await getImageProvider(actor, "generate")).generateLifestyle(lifestyle());
    const [job] = await listUsage(org.id);
    expect(job.credits).toBe(3);
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(3);
  });

  it("refuse a tool the plan doesn't include, without charging", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    await setRules((r) => (r.planFeatures.free = ["copy"]));
    const { org, actor } = await orgWithKey("free");
    expect(await codeOf((await getImageProvider(actor, "generate")).generateLifestyle(lifestyle()))).toBe("not_in_plan");
    expect(await listUsage(org.id)).toHaveLength(0);
  });

  it("refuse a job whose cost is more than the credits left", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    await setRules((r) => (r.featureCosts.generate = 5));
    const { org, actor } = await orgWithKey();
    await updateOrganization(org.id, { creditsOverride: 7 });
    const provider = await getImageProvider(actor, "generate");
    expect(await codeOf(provider.generateLifestyle(lifestyle()))).toBe("ok");
    expect(await codeOf(provider.generateLifestyle(lifestyle()))).toBe("quota_exceeded");
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(5);
  });

  it("use the plan's credits from the rules", async () => {
    await setRules((r) => (r.planCredits.starter = 321));
    const { org } = await makeOrg("starter");
    expect(await monthlyAllowance(org, (await getPlatformSettings()).creditRules)).toBe(321);
  });
});

describe("credit adjustments", () => {
  it("add to and remove from this month's allowance, never below zero", async () => {
    const { org } = await makeOrg("pro");
    const rules = (await getPlatformSettings()).creditRules;
    await addCreditAdjustment(org.id, { amount: 100, reason: "goodwill", actor: "admin" });
    await addCreditAdjustment(org.id, { amount: -30, reason: "correction", actor: "admin" });
    expect(await adjustmentTotal(org.id, startOfMonth())).toBe(70);
    expect(await monthlyAllowance(org, rules)).toBe(rules.planCredits.pro + 70);
    expect((await listCreditAdjustments(org.id)).map((a) => a.amount).sort()).toEqual([-30, 100]);
    await addCreditAdjustment(org.id, { amount: -1_000_000, reason: "zero out", actor: "admin" });
    expect(await monthlyAllowance(org, rules)).toBe(0);
  });

  it("only count for their own org", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await addCreditAdjustment(a.org.id, { amount: 50, reason: "x", actor: "admin" });
    expect(await adjustmentTotal(b.org.id, startOfMonth())).toBe(0);
  });

  it("let a granted org run jobs past its plan credits", async () => {
    const { org, actor } = await makeOrg();
    await updateOrganization(org.id, { creditsOverride: 0 });
    const base = { orgId: org.id, feature: "generate" as const, userId: actor.user.id, userName: actor.user.name, provider: "openai" as const, since: startOfMonth() };
    const rules = (await getPlatformSettings()).creditRules;
    expect(await startJob({ ...base, quota: await monthlyAllowance({ ...org, creditsOverride: 0 }, rules) })).toBeNull();
    await addCreditAdjustment(org.id, { amount: 2, reason: "grant", actor: "admin" });
    expect(await startJob({ ...base, quota: await monthlyAllowance({ ...org, creditsOverride: 0 }, rules), credits: 2 })).not.toBeNull();
  });
});
