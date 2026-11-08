import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listProviderKeys, saveProviderKey } from "@/lib/ai/provider-keys";
import { insertUser } from "@/lib/auth/users";
import { setBrandKit } from "@/lib/brand/brand-kit";
import { getThread, listMessages, listThreads } from "@/lib/chat/threads";
import type { ChatEvent, ChatTurnInput } from "@/lib/chat/turn";
import { getPlatformSettings, savePlatformSettings } from "@/lib/platform/settings";
import { updateOrganization } from "@/lib/platform/organizations";
import { ensureMembership } from "@/lib/team/members";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import { startOfMonth } from "@/lib/time";
import type { Workspace } from "@/lib/workspace";
import { makeOrg, uniqueEmail } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { runChatTurn } = await import("@/lib/chat/turn");
const { POST } = await import("@/app/api/chat/route");
const { getChatState, openChatThread, renameChatThread, deleteChatThread } = await import("@/features/chat/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const actorOf = (made: Made) => ({ ...made.actor, orgName: made.org.name });

const asWorkspace = (made: Made, role: Workspace["role"] = "admin", user = made.user) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: user.id, name: user.name, email: user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

/** Reads a turn to the end; `stopAfter` aborts once that many reply pieces arrived. */
async function run(input: Omit<ChatTurnInput, "signal">, stopAfter?: number) {
  const controller = new AbortController();
  const events: ChatEvent[] = [];
  let pieces = 0;
  for await (const event of runChatTurn({ ...input, signal: controller.signal })) {
    events.push(event);
    if (event.type === "delta" && ++pieces === stopAfter) controller.abort();
  }
  const reply = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
  return { events, reply, last: events.at(-1)!, thread: events.find((e) => e.type === "thread")?.thread ?? null };
}

// Gemini streams over server-sent events: one JSON chunk per `data:` line.
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let failWith: number | null = null;
function fakeGemini(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  calls.push({ url, body });
  if (failWith) return Promise.resolve(new Response(JSON.stringify({ error: { code: failWith, message: "API key not valid", status: "UNAUTHENTICATED" } }), { status: failWith, headers: { "content-type": "application/json" } }));
  const chunks = ["Hello ", "from ", "Gemini."].map((text, i, all) => ({
    candidates: [{ content: { role: "model", parts: [{ text }] }, ...(i === all.length - 1 ? { finishReason: "STOP" } : {}) }],
    ...(i === all.length - 1 ? { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } } : {}),
  }));
  const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("");
  return Promise.resolve(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
}

const geminiKey = (orgId: string) => saveProviderKey({ orgId, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash", "gemini-3-pro"], createdBy: "t" });

beforeEach(() => {
  calls = [];
  failWith = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat turns", () => {
  it("without a provider (demo off) refuses, keeps nothing and charges nothing", async () => {
    const made = await makeOrg();
    const { last } = await run({ actor: actorOf(made), threadId: null, text: "Hello" });
    expect(last).toEqual({ type: "error", code: "no_provider" });
    expect(await listThreads(made.org.id, made.user.id)).toHaveLength(0);
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("streams a Gemini reply with the system prompt and history, saves both messages, one 'chat' job", async () => {
    vi.stubGlobal("fetch", fakeGemini);
    const made = await makeOrg();
    await geminiKey(made.org.id);
    await setBrandKit(made.org.id, { name: "Oslo Home", about: "", voice: "Warm and calm", audience: "", useWords: [], avoidWords: ["cheap"], rules: "" }, "t");

    const first = await run({ actor: actorOf(made), threadId: null, text: "Write a title for a linen sofa\nwith oak legs" });
    expect(first.reply).toBe("Hello from Gemini.");
    expect(first.thread?.title).toBe("Write a title for a linen sofa");
    expect(first.last).toMatchObject({ type: "done", message: { role: "assistant", content: "Hello from Gemini.", provider: "gemini", model: "gemini-3-pro", status: "ok" } });
    expect(calls[0].url).toContain("/gemini-3-pro:streamGenerateContent");
    const system = JSON.stringify(calls[0].body.systemInstruction);
    expect(system).toContain(made.org.name);
    expect(system).toContain("Brand voice: Warm and calm");
    expect(system).toContain("cheap");

    // The second message carries the history.
    const second = await run({ actor: actorOf(made), threadId: first.thread!.id, text: "Shorter please" });
    expect(second.last.type).toBe("done");
    const contents = calls[1].body.contents as { role: string; parts: { text: string }[] }[];
    expect(contents.map((c) => [c.role, c.parts[0].text])).toEqual([
      ["user", "Write a title for a linen sofa\nwith oak legs"],
      ["model", "Hello from Gemini."],
      ["user", "Shorter please"],
    ]);
    expect((await listMessages(made.org.id, first.thread!.id)).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const usage = await listUsage(made.org.id);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ feature: "chat", ok: true, provider: "gemini", model: "gemini-3-pro", credits: 1 });
  });

  it("a rejected key fails the turn, marks the key invalid and takes the message back", async () => {
    vi.stubGlobal("fetch", fakeGemini);
    const made = await makeOrg();
    await geminiKey(made.org.id);
    const ok = await run({ actor: actorOf(made), threadId: null, text: "First" });
    failWith = 401;
    const failed = await run({ actor: actorOf(made), threadId: ok.thread!.id, text: "Second" });
    expect(failed.last).toEqual({ type: "error", code: "invalid_key" });
    expect((await listMessages(made.org.id, ok.thread!.id)).map((m) => m.content)).toEqual(["First", "Hello from Gemini."]);
    expect((await listProviderKeys(made.org.id)).find((k) => k.provider === "gemini")?.status).toBe("invalid");
    expect(await creditsUsedSince(made.org.id, startOfMonth())).toBe(1); // the failed reply is free
  });

  it("a failed first reply removes the thread it started", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    const { last } = await run({ actor: actorOf(made), threadId: null, text: "please FAIL" });
    expect(last).toEqual({ type: "error", code: "generation_failed" });
    expect(await listThreads(made.org.id, made.user.id)).toHaveLength(0);
  });

  it("a stopped reply keeps what was written (charged); stopped before any text is free and kept nowhere", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    const stopped = await run({ actor: actorOf(made), threadId: null, text: "Tell me about sofas" }, 3);
    expect(stopped.last).toMatchObject({ type: "done", message: { status: "stopped", model: "demo-chat-v1" } });
    const saved = await listMessages(made.org.id, stopped.thread!.id);
    expect(saved[1].content).toBe(stopped.reply);
    expect(stopped.reply.length).toBeGreaterThan(0);
    expect(await creditsUsedSince(made.org.id, startOfMonth())).toBe(1);

    // Aborted before the provider wrote anything.
    const controller = new AbortController();
    controller.abort();
    const events: ChatEvent[] = [];
    for await (const e of runChatTurn({ actor: actorOf(made), threadId: stopped.thread!.id, text: "Again", signal: controller.signal })) events.push(e);
    expect(events.at(-1)).toEqual({ type: "error", code: "generation_failed" });
    expect(await listMessages(made.org.id, stopped.thread!.id)).toHaveLength(2);
    expect(await creditsUsedSince(made.org.id, startOfMonth())).toBe(1);
  });

  it("is refused by the quota and the kill switch like every tool", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await updateOrganization(made.org.id, { creditsOverride: 0 });
    expect((await run({ actor: actorOf(made), threadId: null, text: "Hi" })).last).toEqual({ type: "error", code: "quota_exceeded" });

    await updateOrganization(made.org.id, { creditsOverride: null });
    const settings = await getPlatformSettings();
    await savePlatformSettings({ ...settings, disabledFeatures: ["chat"] }, "t");
    try {
      expect((await run({ actor: actorOf(made), threadId: null, text: "Hi" })).last).toEqual({ type: "error", code: "feature_disabled" });
    } finally {
      await savePlatformSettings({ ...settings, disabledFeatures: [] }, "t");
    }
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("threads are private to their user and org", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    const other = await makeOrg();
    const colleague = await insertUser({ name: "Colleague", email: uniqueEmail("colleague"), password: "test-password-1", createdBy: "t" });
    await ensureMembership({ orgId: made.org.id, userId: colleague.id, name: colleague.name, email: colleague.email, role: "editor", invitedBy: null });
    const { thread } = await run({ actor: actorOf(made), threadId: null, text: "Mine" });

    expect(await getThread(made.org.id, colleague.id, thread!.id)).toBeNull();
    expect(await getThread(other.org.id, other.user.id, thread!.id)).toBeNull();
    const colleagueActor = { orgId: made.org.id, orgName: made.org.name, user: { id: colleague.id, name: colleague.name } };
    expect((await run({ actor: colleagueActor, threadId: thread!.id, text: "Let me in" })).last).toEqual({ type: "error", code: "not_found" });
    expect(await listMessages(made.org.id, thread!.id)).toHaveLength(2);

    asWorkspace(made, "editor", colleague);
    expect(await openChatThread(thread!.id)).toBeNull();
    expect(await deleteChatThread(thread!.id)).toEqual({ ok: false });
    expect((await getChatState()).threads).toHaveLength(0);
  });
});

describe("chat route and actions", () => {
  const post = (body: unknown) => POST(new Request("https://app.test/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const readEvents = async (response: Response) =>
    (await response.text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatEvent);

  it("streams NDJSON events and the actions list, open, rename and delete the thread", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    asWorkspace(made, "editor");
    const response = await post({ text: "  Ideas for a summer sale  ", threadId: null });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: "thread", thread: { title: "Ideas for a summer sale" }, message: { role: "user", content: "Ideas for a summer sale" } });
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(3);
    expect(events.at(-1)).toMatchObject({ type: "done", message: { role: "assistant", status: "ok" } });

    const state = await getChatState();
    expect(state.canSend).toBe(true);
    const id = state.threads[0].id;
    expect((await openChatThread(id))?.messages).toHaveLength(2);
    expect(await renameChatThread(id, "  Summer sale\nplan ")).toMatchObject({ ok: true, thread: { title: "Summer sale" } });
    expect(await renameChatThread(id, "   ")).toEqual({ ok: false, error: "invalid_input" });
    expect(await deleteChatThread(id)).toEqual({ ok: true });
    expect(await openChatThread(id)).toBeNull();
  });

  it("refuses viewers and bad input before anything runs", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    asWorkspace(made, "viewer");
    expect((await post({ text: "Hi", threadId: null })).status).toBe(403);
    expect((await getChatState()).canSend).toBe(false);

    asWorkspace(made, "editor");
    expect((await post({ text: "   ", threadId: null })).status).toBe(400);
    expect((await post({ text: "x".repeat(4001), threadId: null })).status).toBe(400);
    expect((await post({ text: "Hi", threadId: 42 })).status).toBe(400);
    expect(await listThreads(made.org.id, made.user.id)).toHaveLength(0);
  });
});
