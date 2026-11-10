import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import type { AgentStep, AgentStreamEvent } from "@/lib/agent/limits";
import type { AgentRunInput } from "@/lib/agent/run";
import { getRun, listRuns, releaseStaleRuns, STALE_RUN_MS } from "@/lib/agent/runs";
import { AgentToolError, agentTools } from "@/lib/agent/tools";
import { insertUser } from "@/lib/auth/users";
import { insertConnection } from "@/lib/catalog/connections";
import { getCopy } from "@/lib/copy/copies";
import { db, schema } from "@/lib/db";
import { getGenerations } from "@/lib/generations";
import { updateOrganization } from "@/lib/platform/organizations";
import { ensureMembership } from "@/lib/team/members";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince, listUsage } from "@/lib/usage";
import type { Workspace } from "@/lib/workspace";
import { eq } from "drizzle-orm";
import { makeOrg, uniqueEmail } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));

const { runAgent } = await import("@/lib/agent/run");
const { POST } = await import("@/app/api/agent/route");
const { getAgentState, openAgentRun, deleteAgentRun } = await import("@/features/agents/actions");

type Made = Awaited<ReturnType<typeof makeOrg>>;
const actorOf = (made: Made, user = made.user) => ({ orgId: made.org.id, orgName: made.org.name, user: { id: user.id, name: user.name } });
const asWorkspace = (made: Made, role: Workspace["role"] = "admin", user = made.user, extra: Partial<Workspace> = {}) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: user.id, name: user.name, email: user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500, ...extra };
};
const connectDemoStore = (orgId: string) => insertConnection({ orgId, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });

async function run(input: Omit<AgentRunInput, "signal">, stopAfterTool?: number) {
  const controller = new AbortController();
  const events: AgentStreamEvent[] = [];
  let tools = 0;
  for await (const event of runAgent({ ...input, signal: controller.signal })) {
    events.push(event);
    if (event.type === "step" && event.step.kind === "tool" && event.step.status === "ok" && ++tools === stopAfterTool) controller.abort();
  }
  return { events, last: events.at(-1)!, runId: events.find((e) => e.type === "run")?.run.id ?? null };
}
const toolSteps = (steps: AgentStep[]) => steps.flatMap((s) => (s.kind === "tool" ? [s] : []));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("agent runs", () => {
  it("finds a product, writes its copy and makes an image in one run (B3 done when), charging each tool", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    const { events, last, runId } = await run({ actor: actorOf(made), goal: "Find the grey sofa, write Arabic and English copy and make a lifestyle image" });

    expect(last.type).toBe("done");
    const saved = (last as Extract<AgentStreamEvent, { type: "done" }>).run;
    expect(saved).toMatchObject({ id: runId, status: "ok", error: null });
    const tools = toolSteps(saved.steps);
    expect(tools.map((s) => [s.tool, s.status])).toEqual([
      ["search_catalog", "ok"],
      ["write_copy", "ok"],
      ["generate_image", "ok"],
    ]);
    // Steps arrive live: each tool shows as running before it finishes.
    expect(events.filter((e) => e.type === "step" && e.step.kind === "tool" && e.step.status === "running")).toHaveLength(3);
    expect(saved.steps.at(-1)).toMatchObject({ kind: "text" });

    const search = tools[0].output;
    expect(search?.tool === "search_catalog" && search.products[0].sku).toBe("SOFA-12345");
    const copy = tools[1].output;
    if (copy?.tool !== "write_copy") throw new Error("no copy");
    const savedCopy = await getCopy(made.org.id, copy.copyId);
    expect(savedCopy?.sku).toBe("SOFA-12345");
    expect(Object.keys(savedCopy!.copy).sort()).toEqual(["ar", "en"]);
    const image = tools[2].output;
    if (image?.tool !== "generate_image") throw new Error("no image");
    const [generation] = await getGenerations(made.org.id, [image.generationId]);
    expect(generation).toMatchObject({ mode: "lifestyle", sku: "SOFA-12345", createdById: made.user.id });
    expect(generation.settings.agentRunId).toBe(runId);
    expect(image.url).toBe(`/api/assets/${generation.assetId}`);

    // One job for the run and one per tool that made something (search is free).
    expect((await listUsage(made.org.id)).map((u) => [u.feature, u.ok]).sort()).toEqual([
      ["agent", true],
      ["copy", true],
      ["generate", true],
    ]);
    expect(await creditsUsedSince(made.org.id, startOfMonth())).toBe(3);
    // Saved: it reopens the same.
    expect(await getRun(made.org.id, made.user.id, runId!)).toMatchObject({ status: "ok", steps: saved.steps });
  });

  it("without a provider (demo off) refuses, keeps no run and charges nothing", async () => {
    const made = await makeOrg();
    const { last } = await run({ actor: actorOf(made), goal: "Find the sofa" });
    expect(last).toEqual({ type: "error", code: "no_provider" });
    expect(await listRuns(made.org.id, made.user.id)).toHaveLength(0);
    expect(await listUsage(made.org.id)).toHaveLength(0);
  });

  it("over the month's credits nothing runs; a failure before any tool is dropped", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    await updateOrganization(made.org.id, { creditsOverride: 0 });
    expect((await run({ actor: actorOf(made), goal: "Find the sofa" })).last).toEqual({ type: "error", code: "quota_exceeded" });
    await updateOrganization(made.org.id, { creditsOverride: null });
    expect((await run({ actor: actorOf(made), goal: "please FAIL" })).last).toEqual({ type: "error", code: "generation_failed" });
    expect(await listRuns(made.org.id, made.user.id)).toHaveLength(0);
  });

  it("without a store the search step fails with no_connection and nothing else is charged", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    const { last } = await run({ actor: actorOf(made), goal: "Find the grey sofa" });
    const saved = (last as Extract<AgentStreamEvent, { type: "done" }>).run;
    expect(toolSteps(saved.steps).map((s) => [s.tool, s.status, s.error])).toEqual([
      ["search_catalog", "failed", "no_connection"],
      ["search_catalog", "failed", "no_connection"],
    ]);
    expect((await listUsage(made.org.id)).map((u) => u.feature)).toEqual(["agent"]);
  });

  it("a stopped run keeps what was already made", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    const { last, runId } = await run({ actor: actorOf(made), goal: "Find the grey sofa, write copy and make an image" }, 2);
    expect(last).toMatchObject({ type: "done", run: { status: "stopped" } });
    const saved = await getRun(made.org.id, made.user.id, runId!);
    expect(toolSteps(saved!.steps).map((s) => s.tool)).toEqual(["search_catalog", "write_copy"]);
    expect((await listUsage(made.org.id)).map((u) => u.feature).sort()).toEqual(["agent", "copy"]);
  });

  it("tools only work on catalog products and stop at their per-run limit", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    const tools = Object.fromEntries(agentTools(made.actor, "run-1").map((t) => [t.name, t]));
    const write = (sku: string) => tools.write_copy.execute(tools.write_copy.input.parse({ sku }));
    await expect(write("NOT-A-SKU")).rejects.toMatchObject({ code: "sku_not_found" });
    await write("CHAIR-OAK-99");
    await write("CHAIR-OAK-99");
    const fourth = write("CHAIR-OAK-99");
    await expect(fourth).rejects.toBeInstanceOf(AgentToolError);
    await expect(fourth).rejects.toMatchObject({ code: "limit" });
    // The refused calls cost nothing: two copies were written.
    expect((await listUsage(made.org.id)).map((u) => u.feature)).toEqual(["copy", "copy"]);
    expect(() => tools.generate_image.input.parse({ sku: "X", aspectRatio: "7:3" })).toThrow();
  });

  it("drives the AI SDK tool loop with a real provider (Gemini stubbed)", async () => {
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    await saveProviderKey({ orgId: made.org.id, provider: "gemini", key: "AIza-test-000000000000000", models: ["gemini-2.5-flash"], createdBy: "t" });
    vi.stubEnv("IMAGINE_DEMO", "1"); // the demo catalog connector is only offered in demo mode
    const bodies: Record<string, unknown>[] = [];
    const sse = (parts: unknown[]) =>
      new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } })}\r\n\r\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? sse([{ functionCall: { name: "search_catalog", args: { query: "armchair" } } }]) : sse([{ text: "I found 2 armchairs." }]);
    });

    const { last } = await run({ actor: actorOf(made), goal: "Which armchairs do we sell?" });
    const saved = (last as Extract<AgentStreamEvent, { type: "done" }>).run;
    expect(saved.status).toBe("ok");
    const [search] = toolSteps(saved.steps);
    expect(search).toMatchObject({ tool: "search_catalog", status: "ok", label: "armchair" });
    expect(search.output?.tool === "search_catalog" && search.output.products.map((p) => p.sku)).toEqual(["CHAIR-BOUCLE-01", "CHAIR-OAK-99"]);
    expect(saved.steps.at(-1)).toEqual(expect.objectContaining({ kind: "text", text: "I found 2 armchairs." }));

    // The model got the tools and the system prompt, then the tool's result in the second step.
    const declared = (bodies[0].tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations.map((d) => d.name);
    expect(declared.sort()).toEqual(["generate_image", "search_catalog", "write_copy"]);
    expect(JSON.stringify(bodies[0].systemInstruction)).toContain(made.org.name);
    expect(JSON.stringify(bodies[1].contents)).toContain("CHAIR-OAK-99");
    expect(await getRun(made.org.id, made.user.id, saved.id)).toMatchObject({ status: "ok" });
    const [usage] = await listUsage(made.org.id);
    expect(usage).toMatchObject({ feature: "agent", provider: "gemini", model: "gemini-2.5-flash", ok: true });
  });

  it("closes runs a crash left running", async () => {
    const made = await makeOrg();
    const { createRun } = await import("@/lib/agent/runs");
    const stale = await createRun(made.org.id, made.user.id, "Old goal");
    await db.update(schema.agentRuns).set({ updatedAt: new Date(Date.now() - STALE_RUN_MS - 60_000).toISOString() }).where(eq(schema.agentRuns.id, stale.id));
    const fresh = await createRun(made.org.id, made.user.id, "New goal");
    expect(await releaseStaleRuns()).toBeGreaterThanOrEqual(1);
    expect(await getRun(made.org.id, made.user.id, stale.id)).toMatchObject({ status: "failed", error: "timed_out" });
    expect(await getRun(made.org.id, made.user.id, fresh.id)).toMatchObject({ status: "running" });
  });
});

describe("agent route and actions", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  it("streams a run for editors; refuses viewers and bad goals", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    asWorkspace(made, "viewer");
    expect((await post({ goal: "Find the sofa" })).status).toBe(403);
    asWorkspace(made, "editor");
    expect((await post({ goal: "  " })).status).toBe(400);
    const response = await post({ goal: "Find the grey sofa" });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AgentStreamEvent);
    expect(events[0].type).toBe("run");
    expect(events.at(-1)).toMatchObject({ type: "done", run: { status: "ok" } });
  });

  it("runs are private to their user and org; viewers and a read-only view can read but not run", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1");
    const made = await makeOrg();
    await connectDemoStore(made.org.id);
    const { runId } = await run({ actor: actorOf(made), goal: "Find the grey sofa" });

    const colleague = await insertUser({ name: "Colleague", email: uniqueEmail(), password: "test-password-1", createdBy: "t" });
    await ensureMembership({ orgId: made.org.id, userId: colleague.id, name: colleague.name, email: colleague.email, role: "editor", invitedBy: null });
    asWorkspace(made, "editor", colleague);
    expect((await getAgentState()).runs).toHaveLength(0);
    expect(await openAgentRun(runId!)).toBeNull();
    expect(await deleteAgentRun(runId!)).toEqual({ ok: false });

    const other = await makeOrg();
    asWorkspace(other, "admin", made.user);
    expect(await openAgentRun(runId!)).toBeNull();

    asWorkspace(made, "viewer");
    expect(await getAgentState()).toMatchObject({ canRun: false, runs: [{ id: runId }] });
    expect((await openAgentRun(runId!))?.status).toBe("ok");
    expect(await deleteAgentRun(runId!)).toEqual({ ok: false });
    asWorkspace(made, "admin", made.user, { viewAs: { expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    expect((await getAgentState()).canRun).toBe(false);

    asWorkspace(made);
    expect(await getAgentState()).toMatchObject({ canRun: true });
    expect(await deleteAgentRun(runId!)).toEqual({ ok: true });
    expect(await listRuns(made.org.id, made.user.id)).toHaveLength(0);
  });
});
