import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { improvePrompt } = await import("@/features/prompts/actions");

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply = "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fakeOpenAi(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  calls.push({ url, body });
  return json({ id: "resp_1", object: "response", created_at: 1, model: body.model, status: "completed", output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text: reply, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
}

async function asAdmin() {
  const made = await makeOrg();
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "admin", user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  return made;
}

const base = { tool: "generate" as const, category: "furniture", language: "en" as const };

beforeEach(() => {
  calls = [];
  reply = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Improve with AI", () => {
  it("rewrites through the org's text model with minimal reasoning, tidied, with no credit or usage row", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    const made = await asAdmin();
    await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-5", "gpt-image-2"], createdBy: "t" });
    reply = '**Improved prompt:** "Soft morning light from the left,\nlow camera angle."';
    const result = await improvePrompt({ ...base, text: "make it bright", scene: "livingRoom" });
    expect(result).toEqual({ ok: true, text: "Soft morning light from the left, low camera angle." });
    expect(calls[0].body).toMatchObject({ model: "gpt-5", reasoning: { effort: "minimal" } });
    const prompt = JSON.stringify(calls[0].body.input);
    expect(prompt).toContain("make it bright");
    expect(prompt).toContain("scene: living room");
    expect(prompt).toContain("Never ask for text, captions, logos or watermarks");
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("recolor briefs what is recoloured; empty text asks for a starter in the UI language", async () => {
    vi.stubGlobal("fetch", fakeOpenAi);
    const made = await asAdmin();
    await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "sk-test-0000000000000000", models: ["gpt-5"], createdBy: "t" });
    reply = "غيّر لون القماش فقط";
    expect(await improvePrompt({ tool: "recolor", category: "furniture", text: "", language: "ar" })).toEqual({ ok: true, text: "غيّر لون القماش فقط" });
    const prompt = JSON.stringify(calls[0].body.input);
    expect(prompt).toContain("what is recoloured: fabric (furniture)");
    expect(prompt).toContain("in Modern Standard Arabic");
  });

  it("demo provider works offline, keeps Arabic, and fails on request", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    await asAdmin();
    const en = await improvePrompt({ ...base, text: "sunny room." });
    expect(en.ok && en.text).toMatch(/^sunny room, soft natural daylight/);
    const ar = await improvePrompt({ ...base, text: "غرفة مشمسة" });
    expect(ar.ok && ar.text).toMatch(/^غرفة مشمسة، إضاءة/);
    expect(await improvePrompt({ ...base, text: "FAIL" })).toEqual({ ok: false, error: "generation_failed" });
  });

  it("refuses bad input and orgs with no text provider", async () => {
    await asAdmin();
    expect(await improvePrompt({ ...base, tool: "aplus" as never, text: "x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await improvePrompt({ ...base, category: "nope", text: "x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await improvePrompt({ ...base, scene: "noSuchScene", text: "x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await improvePrompt({ ...base, text: "x".repeat(2001) })).toEqual({ ok: false, error: "invalid_input" });
    expect(await improvePrompt({ ...base, text: "x" })).toEqual({ ok: false, error: "no_provider" });
  });

  it("is rate-limited per user", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    await asAdmin();
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await improvePrompt({ ...base, text: "room" }));
    vi.useRealTimers();
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toEqual({ ok: false, error: "rate_limited" });
  });
});
