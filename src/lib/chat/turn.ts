import "server-only";
import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getTextProvider, type JobActor } from "@/lib/ai/registry";
import { getBrandKit, isEmptyBrandKit } from "@/lib/brand/brand-kit";
import { reportError } from "@/lib/observability/report";
import { historyFor, threadTitle } from "./limits";
import { chatSystemPrompt } from "./prompt";
import { addMessage, createThread, deleteMessage, deleteThread, getThread, listMessages, type ChatMessage, type ChatThread } from "./threads";

/** What the chat screen receives while a reply is written (one JSON object per line). */
export type ChatEvent =
  | { type: "thread"; thread: ChatThread; message: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; code: ProviderErrorCode | "not_found" };

export type ChatTurnInput = {
  actor: JobActor & { orgName: string };
  /** Null starts a new thread titled after the message. */
  threadId: string | null;
  text: string;
  /** The request's signal: the user stopped the reply or left. */
  signal?: AbortSignal;
};

/**
 * One exchange: saves the user's message, streams the assistant's reply through the org's text
 * provider (one "chat" job, charged by the registry) and saves the reply. When the reply fails,
 * the user's message (and a thread it started) is removed again, so the screen can put the text
 * back in the box and nothing half-done stays in the history. A stopped reply keeps what was written.
 * Callers must read the generator to the end (even after the client left) so the reply is saved.
 */
export async function* runChatTurn({ actor, threadId, text, signal }: ChatTurnInput): AsyncGenerator<ChatEvent> {
  const { orgId } = actor;
  const existing = threadId ? await getThread(orgId, actor.user.id, threadId) : null;
  if (threadId && !existing) {
    yield { type: "error", code: "not_found" };
    return;
  }
  const history = existing ? await listMessages(orgId, existing.id) : [];
  const thread = existing ?? (await createThread(orgId, actor.user.id, threadTitle(text)));
  const asked = await addMessage(orgId, thread.id, { role: "user", content: text });
  yield { type: "thread", thread, message: asked };

  let reply = "";
  let failed: ProviderErrorCode | null = null;
  try {
    const [provider, brand] = await Promise.all([getTextProvider(actor, "chat"), getBrandKit(orgId)]);
    const system = chatSystemPrompt({ orgName: actor.orgName, today: new Date().toISOString().slice(0, 10), brand: brand && !isEmptyBrandKit(brand) ? brand : null });
    const turns = historyFor([...history.map(({ role, content }) => ({ role, content })), { role: "user" as const, content: text }]);
    for await (const piece of provider.streamChat({ system, messages: turns, signal })) {
      reply += piece;
      yield { type: "delta", text: piece };
    }
    if (reply.trim()) {
      const status = signal?.aborted ? "stopped" : "ok";
      const saved = await addMessage(orgId, thread.id, { role: "assistant", content: reply, provider: provider.id, model: provider.model ?? null, status });
      yield { type: "done", message: saved };
    } else {
      failed = "generation_failed"; // stopped before a word was written (free), or an empty reply
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) reportError("chat reply failed", error, { orgId, feature: "chat" });
    failed = error instanceof ProviderError ? error.code : "generation_failed";
  }

  if (failed) {
    await deleteMessage(orgId, asked.id);
    if (!existing) await deleteThread(orgId, actor.user.id, thread.id);
    yield { type: "error", code: failed };
  }
}
