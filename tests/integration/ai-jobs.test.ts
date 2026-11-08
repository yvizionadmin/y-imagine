import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/ai/errors";
import { setModelPreference } from "@/lib/ai/model-preferences";
import { listProviderKeys, saveProviderKey } from "@/lib/ai/provider-keys";
import { getImageProvider } from "@/lib/ai/registry";
import type { LifestyleRequest } from "@/lib/ai/types";
import { savePlatformSettings, getPlatformSettings } from "@/lib/platform/settings";
import { updateOrganization } from "@/lib/platform/organizations";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import { startOfMonth } from "@/lib/time";
import { makeOrg } from "../helpers";

// The AI path end to end with provider HTTP stubbed: routing, request mapping, output shaping,
// error codes, and the usage/credit bookkeeping around every job.

type Call = { url: string; body: unknown; images: number; fields: Record<string, string> };
let calls: Call[] = [];
let mode: "ok" | "401" | "quota" | "429" = "ok";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const png = async (w: number, h: number) => (await sharp({ create: { width: w, height: h, channels: 3, background: "#88aacc" } }).png().toBuffer()).toString("base64");

async function fakeProviders(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const call: Call = { url, body: null, images: 0, fields: {} };
  if (init?.body instanceof FormData) {
    for (const [k, v] of init.body.entries()) {
      if (typeof v === "string") call.fields[k] = v;
      else call.images++;
    }
  } else if (typeof init?.body === "string") call.body = JSON.parse(init.body);
  calls.push(call);
  if (mode === "401") return json({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }, 401);
  if (mode === "quota") return json({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, 429);
  if (mode === "429") return json({ error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, 429);
  if (url.includes("api.openai.com") && url.includes("/images/")) {
    const [w, h] = (call.fields.size ?? "1024x1024").split("x").map(Number);
    return json({ created: 1, data: [{ b64_json: await png(w, h) }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  }
  if (url.includes("generativelanguage") && url.includes("-image:generateContent")) {
    return json({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: await png(1344, 768) } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  }
  if (url.includes("generativelanguage") && url.includes(":generateContent")) {
    return json({ candidates: [{ content: { role: "model", parts: [{ text: '{"shape":true,"stitching":true,"lighting":false,"texture":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  }
  return json({ error: { message: "unexpected " + url } }, 500);
}

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ProviderError ? e.code : `unexpected: ${String(e)}`));

let product: LifestyleRequest["product"];
let swatch: LifestyleRequest["product"];
const lifestyle = (): LifestyleRequest => ({ sku: "SOFA-1", product, reference: null, category: "furniture", scene: "livingRoom", customScene: null, sceneUpload: null, style: "scandinavian", productSize: "", aspectRatio: "16:9", resolution: "HD", instructions: "warm light" });

beforeAll(async () => {
  product = { bytes: new Uint8Array(await readFile("public/demo/sofa-source.png")), mimeType: "image/png", name: "sofa.png" };
  swatch = { bytes: new Uint8Array(await readFile("public/demo/swatch-beige-linen.png")), mimeType: "image/png", name: "swatch.png" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  calls = [];
  mode = "ok";
});

describe("provider routing", () => {
  it("without a key (demo off) refuses before charging", async () => {
    const { org, actor } = await makeOrg();
    expect(await codeOf((await getImageProvider(actor, "generate")).generateLifestyle(lifestyle()))).toBe("no_provider");
    expect(await listUsage(org.id)).toHaveLength(0);
  });

  it("OpenAI: lifestyle is an image edit with the best model the key has", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor, user } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-4o-mini", "gpt-5-mini", "gpt-image-1", "gpt-image-1.5"], createdBy: "t" });
    const image = await (await getImageProvider(actor, "generate")).generateLifestyle(lifestyle());
    const edit = calls.at(-1)!;
    expect(edit.url).toMatch(/\/v1\/images\/edits$/);
    expect(edit.images).toBe(2); // product + library scene
    expect(edit.fields.model).toBe("gpt-image-1.5");
    expect(edit.fields.size).toBe("1536x1024");
    expect(edit.fields.prompt).toMatch(/Keep the product exactly/);
    expect(edit.fields.prompt).toMatch(/scandinavian/);
    expect([image.width, image.height]).toEqual([1200, 675]);
    expect(image.url.startsWith("data:image/webp")).toBe(true);

    const [row] = await listUsage(org.id);
    expect(row).toMatchObject({ ok: true, provider: "openai", model: "gpt-image-1.5", userId: user.id });
  });

  it("A+: only the hero comes from the model; text is composed locally", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    const aplus = await (await getImageProvider(actor, "aplus")).generateAplus({
      sku: "S", product, reference: { kind: "library", layout: "bento" }, category: "furniture", scene: "/scenes/living-room.png", style: null,
      title: "مريح جدا", subtitle: "", features: [{ title: "Soft", description: "Linen" }], aspectRatio: "1:1", resolution: "HD",
    });
    expect(aplus.width).toBe(1200);
    expect(calls.at(-1)!.fields.prompt).not.toContain("مريح");
  });

  it("Looks: one composite in, requested size out", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    const background = { bytes: new Uint8Array(await readFile("public/scenes/living-room.png")), mimeType: "image/png", name: "room" };
    const look = await (await getImageProvider(actor, "looks")).generateLook({ background, items: [{ image: product, x: 0.3, y: 0.4, w: 0.4, h: 0.4 }], width: 1600, height: 900, prompt: "cosy", style: null, category: "fashion", subcategory: "handbags" });
    expect([look.width, look.height]).toEqual([1600, 900]);
    expect(calls.at(-1)!.images).toBe(1);
    expect(calls.at(-1)!.fields.prompt).toContain("fashion (handbags) product cut-outs");
  });

  it("Upscale: one image edit, resized to the exact 2K or 4K long edge, counted as an upscale job", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    const provider = await getImageProvider(actor, "upscale");
    const meta = await sharp(product.bytes).metadata();
    const image = await provider.upscale({ image: product, size: "2K" });
    expect(Math.max(image.width, image.height)).toBe(2048);
    expect(image.width / image.height).toBeCloseTo((meta.width ?? 1) / (meta.height ?? 1), 1);
    expect(calls.at(-1)!.images).toBe(1);
    expect(calls.at(-1)!.fields.prompt).toMatch(/Upscale this image/);
    expect(calls.at(-1)!.fields.quality).toBe("high");
    const big = await provider.upscale({ image: product, size: "4K" });
    expect(Math.max(big.width, big.height)).toBe(4096);
    expect((await listUsage(org.id)).map((u) => u.feature)).toEqual(["upscale", "upscale"]);
  });

  it("Gemini preference: recolor with swatch, aspect ratio and a vision preservation check", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash", "gemini-2.5-flash-image"], createdBy: "t" });
    await setModelPreference(org.id, "recolor", { provider: "gemini", model: "gemini-2.5-flash-image" }, "t");
    const provider = await getImageProvider(actor, "recolor");
    const result = await provider.recolor({ sku: "S", category: "furniture", product, swatch, hex: "#D8C8B5", scope: "main", aspectRatio: "1:1", resolution: "HD", notes: "" });
    const imageCall = calls.find((c) => c.url.includes("-image:generateContent"))!;
    const parts = (imageCall.body as { contents: { parts: { inlineData?: unknown }[] }[] }).contents[0].parts;
    expect(parts.filter((p) => p.inlineData)).toHaveLength(2);
    expect(JSON.stringify(imageCall.body)).toContain('"aspectRatio":"1:1"');
    expect(result.image.width).toBe(result.image.height);
    expect(result.preserved).toEqual(["shape", "stitching", "texture"]);
    expect(calls.some((c) => c.url.includes("/gemini-2.5-flash:generateContent"))).toBe(true);

    const before = calls.length;
    expect((await provider.analyzeSwatch(swatch)).hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(calls.length).toBe(before); // measured locally, no provider call
  });
});

describe("image prompts", () => {
  async function openAiProvider(feature: "generate" | "recolor" | "aplus") {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    return getImageProvider(actor, feature);
  }
  const lastPrompt = () => calls.at(-1)!.fields.prompt;

  it("Generate names each image by position and skips missing ones", async () => {
    const provider = await openAiProvider("generate");
    await provider.generateLifestyle(lifestyle());
    expect(lastPrompt()).toMatch(/^Image 1 is the product photo\. Image 2 is the scene reference\./);
    expect(lastPrompt()).toContain("like the scene in image 2");

    await provider.generateLifestyle({ ...lifestyle(), reference: product });
    expect(calls.at(-1)!.images).toBe(3);
    expect(lastPrompt()).toContain("Image 2 is a composition reference");
    expect(lastPrompt()).toContain("like the scene in image 3");

    await provider.generateLifestyle({ ...lifestyle(), scene: null, customScene: "a sunny beach hut" });
    expect(calls.at(-1)!.images).toBe(1);
    expect(lastPrompt()).not.toContain("Image 2");
    expect(lastPrompt()).toContain("Place it in this setting: a sunny beach hut.");
  });

  it("Generate uses an uploaded background as the actual scene", async () => {
    const provider = await openAiProvider("generate");
    const room = { bytes: new Uint8Array(await readFile("public/scenes/luxury-loft.png")), mimeType: "image/png", name: "room.png" };
    await provider.generateLifestyle({ ...lifestyle(), scene: null, sceneUpload: room });
    expect(calls.at(-1)!.images).toBe(2); // product + the merchant's background, no library scene
    expect(lastPrompt()).toContain("Image 2 is the background photo.");
    expect(lastPrompt()).toContain("Place it into the background photo, image 2: keep that room");
  });

  it("Generate passes the product size for true scale", async () => {
    const provider = await openAiProvider("generate");
    await provider.generateLifestyle({ ...lifestyle(), productSize: "220 × 95 × 85 cm" });
    expect(lastPrompt()).toContain("The product's real size is 220 × 95 × 85 cm.");
    await provider.generateLifestyle(lifestyle());
    expect(lastPrompt()).not.toContain("real size is");
    expect(lastPrompt()).toContain("true-to-life scale");
  });

  it("Generate adds the camera angle and minimal props, and later shots match the first", async () => {
    const provider = await openAiProvider("generate");
    await provider.generateLifestyle({ ...lifestyle(), angle: "frontLeft45", minimalProps: true });
    expect(lastPrompt()).toContain("three-quarter view from the front-left");
    expect(lastPrompt()).toContain("Keep the scene minimal");
    expect(lastPrompt()).toContain("fully in frame");

    await provider.generateLifestyle({ ...lifestyle(), angle: "closeup" });
    expect(lastPrompt()).not.toContain("fully in frame");

    // A matched shot replaces the scene sources: product + the first shot only.
    await provider.generateLifestyle({ ...lifestyle(), angle: "left90", matchShot: { ...product, name: "first-shot" } });
    expect(calls.at(-1)!.images).toBe(2);
    expect(lastPrompt()).toContain("Image 2 is an earlier photo from the same shoot.");
    expect(lastPrompt()).toContain("exact same room as image 2");
    expect(lastPrompt()).not.toContain("scene reference");
  });

  it("Recolor keeps frame and hardware unless the whole product is asked for", async () => {
    const provider = await openAiProvider("recolor");
    const request = { sku: "S", category: "furniture", product, swatch, hex: "#D8C8B5", aspectRatio: "1:1", resolution: "HD" as const, notes: "" };
    await provider.recolor({ ...request, scope: "main" });
    const main = calls.find((c) => c.url.includes("/images/"))!.fields.prompt;
    expect(main).toContain("Change only the main material");
    calls = [];
    await provider.recolor({ ...request, scope: "all" });
    const all = calls.find((c) => c.url.includes("/images/"))!.fields.prompt;
    expect(all).toContain("Change every visible part");
    expect(all).not.toContain("Change only the main material");
  });

  it("A+ keeps the corner clear where the title box goes (right for Arabic)", async () => {
    const provider = await openAiProvider("aplus");
    const request = { sku: "S", product, reference: null, category: "furniture", scene: null, style: null, subtitle: "", features: [{ title: "Linen", description: "Woven linen" }, { title: "Oak", description: "Solid oak legs" }], aspectRatio: "1:1", resolution: "HD" as const };
    await provider.generateAplus({ ...request, title: "Cloud Sofa" });
    expect(lastPrompt()).toContain("Keep the top-left area calm");
    expect(lastPrompt()).toContain("Do not add, remove or redesign any part of it");
    // 1:1 bento hero keeps ~88% of a 1536x1024 render: too little is cut to mention.
    expect(lastPrompt()).not.toContain("middle");
    await provider.generateAplus({ ...request, aspectRatio: "16:9", title: "Cloud Sofa" });
    // 16:9 bento hero is about 2.4:1 with this short text, so about 60% of the 1.5:1 render's height survives.
    expect(lastPrompt()).toMatch(/keeps only the middle (5\d|6\d)% of its height/);
    await provider.generateAplus({ ...request, title: "كنبة مريحة" });
    expect(lastPrompt()).toContain("Keep the top-right area calm");
  });
});

describe("provider errors", () => {
  it("maps quota, rate limit and rejected keys; failures are recorded but not charged", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    const provider = await getImageProvider(actor, "generate");
    mode = "quota";
    expect(await codeOf(provider.generateLifestyle(lifestyle()))).toBe("no_credits");
    mode = "429";
    expect(await codeOf(provider.generateLifestyle(lifestyle()))).toBe("rate_limited");
    mode = "401";
    expect(await codeOf(provider.generateLifestyle(lifestyle()))).toBe("invalid_key");
    expect((await listProviderKeys(org.id))[0].status).toBe("invalid");
    const usage = await listUsage(org.id);
    expect(usage.filter((e) => !e.ok)).toHaveLength(3);
    expect(await creditsUsedSince(org.id, startOfMonth())).toBe(0);
  });

  it("falls back from a preferred provider whose key is invalid", async () => {
    vi.stubGlobal("fetch", fakeProviders);
    const { org, actor } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-image-1"], createdBy: "t" });
    await saveProviderKey({ orgId: org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash-image"], createdBy: "t" });
    await setModelPreference(org.id, "generate", { provider: "openai", model: "gpt-image-1" }, "t");
    expect((await getImageProvider(actor, "generate")).id).toBe("openai");
    const { recordKeyCheck } = await import("@/lib/ai/provider-keys");
    await recordKeyCheck(org.id, "openai", { ok: false, error: "invalid_key" });
    expect((await getImageProvider(actor, "generate")).id).toBe("gemini");
  });
});

describe("credits, kill switch and rate limits (demo provider)", () => {
  it("parallel jobs never overshoot the quota", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const { org, actor } = await makeOrg();
    await updateOrganization(org.id, { creditsOverride: 2 });
    const provider = await getImageProvider(actor, "generate");
    const results = await Promise.all(Array.from({ length: 6 }, () => codeOf(provider.generateLifestyle(lifestyle()))));
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect(results.filter((r) => r === "quota_exceeded")).toHaveLength(4);
    expect(await listUsage(org.id)).toHaveLength(2); // refused jobs aren't usage events
  });

  it("a switched-off tool refuses jobs without a usage event", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const { org, actor } = await makeOrg();
    const settings = await getPlatformSettings();
    await savePlatformSettings({ ...settings, disabledFeatures: ["generate"] }, "t");
    try {
      expect(await codeOf((await getImageProvider(actor, "generate")).generateLifestyle(lifestyle()))).toBe("feature_disabled");
      expect(await listUsage(org.id)).toHaveLength(0);
    } finally {
      await savePlatformSettings({ ...settings, disabledFeatures: [] }, "t");
    }
  });

  it("per-user burst limit returns rate_limited before reserving credits", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const { org, actor } = await makeOrg();
    const provider = await getImageProvider(actor, "generate");
    // The limit is counted atomically, so 14 at once still means exactly 12 run.
    const results = await Promise.all(Array.from({ length: 14 }, () => codeOf(provider.generateLifestyle(lifestyle()))));
    expect(results.filter((r) => r === "ok")).toHaveLength(12);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(2);
    expect(await listUsage(org.id)).toHaveLength(12);
  });
});
