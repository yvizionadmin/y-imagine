import "server-only";
import { randomUUID } from "node:crypto";
import { ProviderError } from "@/lib/ai/errors";
import { getTextProvider, type JobActor } from "@/lib/ai/registry";
import { reportError } from "@/lib/observability/report";
import { AGENT_MAX_STEPS, appendText, isAgentTool, type AgentStep, type AgentStreamEvent, type AgentToolOutput } from "./limits";
import { agentSystemPrompt } from "./prompt";
import { createRun, discardRun, finishRun, saveSteps } from "./runs";
import { agentTools, toolErrorCode } from "./tools";

export type AgentRunInput = {
  actor: JobActor & { orgName: string };
  goal: string;
  /** The request's signal: the user stopped the run or left. */
  signal?: AbortSignal;
};

/** The short line a tool step shows: the search words or the SKU. */
function labelOf(input: unknown) {
  const value = input && typeof input === "object" ? ((input as Record<string, unknown>).query ?? (input as Record<string, unknown>).sku) : null;
  return typeof value === "string" ? value.slice(0, 100) : "";
}

/**
 * One agent run: saves the goal, lets the org's text provider work through the tools (one "agent"
 * job for the run; each copy or image is its own job) and saves every step as it happens. A run
 * that fails before doing anything is removed, so the goal goes back in the box; one that did
 * something is kept as failed (its code in `error`). A stopped run keeps what was done. Callers must read the generator
 * to the end (even after the client left) so the run is saved.
 */
export async function* runAgent({ actor, goal, signal }: AgentRunInput): AsyncGenerator<AgentStreamEvent> {
  const { orgId } = actor;
  const run = await createRun(orgId, actor.user.id, goal);
  yield { type: "run", run };

  let steps: AgentStep[] = [];
  const setStep = (step: AgentStep) => {
    steps = steps.some((s) => s.id === step.id) ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step];
    return step;
  };
  const provider = await getTextProvider(actor, "agent");
  let failed: string | null = null;

  try {
    const events = provider.runAgent({
      system: agentSystemPrompt({ orgName: actor.orgName, today: new Date().toISOString().slice(0, 10) }),
      prompt: goal,
      tools: agentTools(actor, run.id),
      maxSteps: AGENT_MAX_STEPS,
      signal,
    });
    for await (const event of events) {
      if (event.type === "text") {
        const next = appendText(steps, event.text, randomUUID);
        steps = next.steps;
        yield { type: "text", stepId: next.stepId, text: event.text };
        continue;
      }
      if (!isAgentTool(event.name)) continue;
      if (event.type === "tool-call") {
        yield { type: "step", step: setStep({ id: event.id, kind: "tool", tool: event.name, status: "running", label: labelOf(event.input), output: null, error: null }) };
      } else {
        const current = steps.find((s) => s.id === event.id && s.kind === "tool");
        const base = current?.kind === "tool" ? current : { id: event.id, kind: "tool" as const, tool: event.name, status: "running" as const, label: "", output: null, error: null };
        if (event.type === "tool-result") {
          yield { type: "step", step: setStep({ ...base, status: "ok", output: event.output as AgentToolOutput }) };
        } else {
          const { code, expected } = toolErrorCode(event.error);
          if (!expected) reportError("agent tool failed", event.error, { orgId, feature: "agent", tool: event.name });
          yield { type: "step", step: setStep({ ...base, status: "failed", error: code }) };
        }
      }
      await saveSteps(orgId, run.id, steps);
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) reportError("agent run failed", error, { orgId, feature: "agent" });
    failed = error instanceof ProviderError ? error.code : "generation_failed";
  }

  // A tool still running when the run ended (stopped, or the model gave up) didn't finish.
  steps = steps.map((s) => (s.kind === "tool" && s.status === "running" ? { ...s, status: "failed", error: signal?.aborted ? "stopped" : "failed" } : s));
  const didSomething = steps.some((s) => s.kind === "tool");

  // Nothing done (refused before the first tool, or stopped at once): nothing is kept.
  if (!didSomething && (failed || (signal?.aborted && steps.length === 0))) {
    await discardRun(orgId, run.id);
    yield { type: "error", code: failed ?? "stopped" };
    return;
  }
  if (!failed && steps.length === 0 && !signal?.aborted) failed = "generation_failed";
  const status = signal?.aborted ? "stopped" : failed ? "failed" : "ok";
  const saved = await finishRun(orgId, run.id, { status, steps, error: failed, provider: provider.id, model: provider.model ?? null });
  // A kept run always ends with `done`; a failed one carries its code in `run.error`.
  if (saved) yield { type: "done", run: saved };
  else yield { type: "error", code: "timed_out" }; // closed by the stale-run sweep meanwhile
}
