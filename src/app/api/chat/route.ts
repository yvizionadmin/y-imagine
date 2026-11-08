import { cleanMessage } from "@/lib/chat/limits";
import { runChatTurn, type ChatEvent } from "@/lib/chat/turn";
import { reportError } from "@/lib/observability/report";
import { getWorkspace } from "@/lib/workspace";

// Sends one chat message and streams the reply as NDJSON (one ChatEvent per line). A route handler
// rather than a server action because the reply is streamed. Stopping (the client aborts the fetch)
// aborts request.signal, which stops the provider; the part already written is saved.
export async function POST(request: Request) {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; threadId?: unknown } | null;
  const text = cleanMessage(body?.text);
  const threadId = body?.threadId ?? null;
  if (!text || (threadId !== null && (typeof threadId !== "string" || threadId.length > 64))) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const events = runChatTurn({
    actor: { orgId: workspace.orgId, orgName: workspace.orgName, user: { id: workspace.user.id, name: workspace.user.name } },
    threadId,
    text,
    signal: request.signal,
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client left; keep reading so the reply is still saved
        }
      };
      try {
        for await (const event of events) send(event);
      } catch (error) {
        reportError("chat stream failed", error, { orgId: workspace.orgId, feature: "chat" });
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
