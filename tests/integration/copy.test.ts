import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/ai/errors";
import { setModelPreference } from "@/lib/ai/model-preferences";
import { listProviderKeys, saveProviderKey } from "@/lib/ai/provider-keys";
import type { CopyRequest } from "@/lib/ai/types";
import { listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { getTextProvider } = await import("@/lib/ai/registry");
const { generateProductCopy, saveCopyEdits, deleteCopy, listRecentCopies } = await import("@/features/copy/actions");

const written = (lang: string) => ({
  title: `${lang} title`, bullets: [`${lang} one`, `${lang} two`], description: `${lang} description`,
  metaTitle: `${lang} meta`, metaDescription: `${lang} meta description`, tags: ["sofa", "Linen"],
});

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let failWith: number | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fakeText(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  calls.push({ url, body });
  if (failWith) return json({ error: { message: "nope", type: "invalid_request_error", code: "invalid_api_key" } }, failWith);
  const text = JSON.stringify({ en: written("en"), ar: written("ar") });
  if (url.includes("generativelanguage")) {
    return json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  }
  if (url.includes("api.openai.com") && url.endsWith("/responses")) {
    return json({ id: "resp_1", object: "response", created_at: 1, model: body.model, status: "completed", output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  }
  return json({ error: { message: `unexpected ${url}` } }, 500);
}

const request = (patch: Partial<CopyRequest> = {}): CopyRequest => ({
  sku: "SOFA-1", productName: "Oslo Sofa", category: "furniture", details: "Oak legs", keywords: [], tone: "professional",
  length: "medium", channel: "website", languages: ["en", "ar"], image: null, ...patch,
});

const asWorkspace = (made: Awaited<ReturnType<typeof makeOrg>>, role: Workspace["role"] = "admin") => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

beforeEach(() => {
  calls = [];
  failWith = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("text provider routing", () => {
  it("without a key (demo off) refuses before charging", async () => {
    const made = await makeOrg();
    const error = await (await getTextProvider(made.actor, "copy")).generateCopy(request()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("no_provider");
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("Gemini writes both languages in one structured call, tidied, as a 'copy' job", async () => {
    vi.stubGlobal("fetch", fakeText);
    const made = await makeOrg();
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash", "gemini-2.5-flash-image", "gemini-3-pro"], createdBy: "t" });
    const result = await (await getTextProvider(made.actor, "copy")).generateCopy(request({ image: { bytes: new Uint8Array([1, 2]), mimeType: "image/png", name: "p" } }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/gemini-3-pro:generateContent"); // best text model, image models skipped
    expect(JSON.stringify(calls[0].body)).toContain("inlineData"); // photo attached
    expect(result.model).toBe("gemini-3-pro");
    expect(result.copy.en?.title).toBe("en title");
    expect(result.copy.ar?.tags).toEqual(["sofa", "linen"]);
    const [usage] = await listUsage(made.org.id);
    expect(usage).toMatchObject({ feature: "copy", ok: true, provider: "gemini", model: "gemini-3-pro" });
  });

  it("follows the tool's model preference (OpenAI) and maps a rejected key", async () => {
    vi.stubGlobal("fetch", fakeText);
    const made = await makeOrg();
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash"], createdBy: "t" });
    await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-5", "gpt-5-mini", "gpt-image-1"], createdBy: "t" });
    await setModelPreference(made.org.id, "copy", { provider: "openai", model: "gpt-5-mini" }, "t");
    const provider = await getTextProvider(made.actor, "copy");
    expect((await provider.generateCopy(request({ languages: ["en"] }))).model).toBe("gpt-5-mini");
    expect(calls[0].url).toMatch(/api\.openai\.com.*\/responses$/);
    // gpt-5 spent a 4k cap entirely on reasoning and returned no copy; low effort + room fixes it.
    expect(calls[0].body).toMatchObject({ reasoning: { effort: "low" }, max_output_tokens: 16_000 });

    failWith = 401;
    expect(await provider.generateCopy(request()).catch((e) => e.code)).toBe("invalid_key");
    expect((await listProviderKeys(made.org.id)).find((k) => k.provider === "openai")?.status).toBe("invalid");
  });

  it("demo writer works offline and fails on request", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    const provider = await getTextProvider(made.actor, "copy");
    const result = await provider.generateCopy(request({ details: "Oak legs, Linen covers" }));
    expect(result.provider).toBe("demo");
    expect(result.copy.en?.bullets).toEqual(["Oak legs", "Linen covers"]);
    expect(result.copy.ar?.title).toBe("Oslo Sofa");
    expect(await provider.generateCopy(request({ sku: "FAIL-1" })).catch((e) => e.code)).toBe("generation_failed");
  });
});

describe("copy actions", () => {
  const form = (patch: Record<string, string | string[]> = {}) => {
    const data = new FormData();
    const values: Record<string, string | string[]> = { sku: "SOFA-9", productName: "Oslo Sofa", category: "furniture", details: "Oak legs", keywords: "linen sofa, sofa, linen sofa", tone: "friendly", length: "short", channel: "noon", languages: ["en", "ar"], ...patch };
    for (const [k, v] of Object.entries(values)) for (const one of [v].flat()) data.append(k, one);
    return data;
  };

  it("generates, saves and lists copy; edits replace the saved text", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    asWorkspace(await makeOrg());
    const result = await generateProductCopy(form());
    if (!result.ok) throw new Error(result.error);
    expect(result.copy.settings).toMatchObject({ tone: "friendly", channel: "noon", languages: ["en", "ar"], keywords: ["linen sofa", "sofa"] });
    expect((await listRecentCopies())[0].id).toBe(result.copy.id);

    const edited = { ...result.copy.copy, en: { ...result.copy.copy.en!, title: "Edited title" } };
    const saved = await saveCopyEdits(result.copy.id, edited);
    expect(saved.ok && saved.copy.copy.en?.title).toBe("Edited title");
    expect(await saveCopyEdits(result.copy.id, { en: { title: 5 } })).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects missing fields and wrong option values", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    asWorkspace(await makeOrg());
    expect(await generateProductCopy(form({ productName: "" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateProductCopy(form({ tone: "angry" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await generateProductCopy(form({ languages: ["fr"] }))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("other orgs can't see, edit or delete it; only admins or the author delete", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const owner = await makeOrg();
    asWorkspace(owner, "editor");
    const result = await generateProductCopy(form());
    if (!result.ok) throw new Error(result.error);

    asWorkspace(await makeOrg());
    expect(await listRecentCopies()).toHaveLength(0);
    expect(await saveCopyEdits(result.copy.id, result.copy.copy)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteCopy(result.copy.id)).toEqual({ ok: false, error: "not_found" });

    asWorkspace(owner, "viewer");
    workspace = { ...workspace, user: { ...workspace.user, name: "Someone Else" } };
    expect(await deleteCopy(result.copy.id)).toEqual({ ok: false, error: "forbidden" });
    asWorkspace(owner, "editor");
    expect(await deleteCopy(result.copy.id)).toEqual({ ok: true });
  });
});
