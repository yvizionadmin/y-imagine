import { cleanGoal, type AgentStreamEvent } from "@/lib/agent/limits";
import { runAgent } from "@/lib/agent/run";
import { reportError } from "@/lib/observability/report";
import { hit, LIMITS } from "@/lib/rate-limit";
import { getWorkspace } from "@/lib/workspace";

// Starts one agent run and streams it as NDJSON (one AgentStreamEvent per line). A route handler
// rather than a server action because the run is streamed. Stopping (the client aborts the fetch)
// aborts request.signal, which stops the model; what was done is kept.
export async function POST(request: Request) {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { goal?: unknown } | null;
  const goal = cleanGoal(body?.goal);
  if (!goal) return Response.json({ error: "invalid_input" }, { status: 400 });
  if (!(await hit("agent-runs", workspace.user.id, LIMITS.agentRunsPerUser)).ok) return Response.json({ error: "rate_limited" }, { status: 429 });

  const events = runAgent({
    actor: { orgId: workspace.orgId, orgName: workspace.orgName, user: { id: workspace.user.id, name: workspace.user.name } },
    goal,
    signal: request.signal,
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AgentStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client left; keep reading so the run is still saved
        }
      };
      try {
        for await (const event of events) send(event);
      } catch (error) {
        reportError("agent stream failed", error, { orgId: workspace.orgId, feature: "agent" });
        send({ type: "error", code: "generation_failed" });
      }
      if (open) {
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
