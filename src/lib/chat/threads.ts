import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ProviderId } from "@/lib/ai/types";
import { db, schema } from "@/lib/db";
import { CHAT_THREADS_SHOWN } from "./limits";

// Chat threads and messages. Tenant tables (db.forOrg); a thread also belongs to one user, and
// every read here takes that user, so nobody else in the org can open it.

const { chatThreads, chatMessages } = schema;

export type ChatThread = { id: string; title: string; createdAt: string; updatedAt: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider: ProviderId | null;
  model: string | null;
  status: "ok" | "stopped";
  createdAt: string;
};

const toThread = ({ id, title, createdAt, updatedAt }: typeof chatThreads.$inferSelect): ChatThread => ({ id, title, createdAt, updatedAt });
const toMessage = ({ id, role, content, provider, model, status, createdAt }: typeof chatMessages.$inferSelect): ChatMessage => ({
  id,
  role,
  content,
  provider: provider ?? null,
  model: model ?? null,
  status,
  createdAt,
});

export async function createThread(orgId: string, userId: string, title: string) {
  const [row] = await db.forOrg(orgId).insert(chatThreads, { id: randomUUID(), userId, title });
  return toThread(row);
}

/** The user's threads, most recently used first. */
export async function listThreads(orgId: string, userId: string, limit = CHAT_THREADS_SHOWN) {
  const rows = await db.forOrg(orgId).select(chatThreads, eq(chatThreads.userId, userId), { orderBy: [desc(chatThreads.updatedAt)], limit });
  return rows.map(toThread);
}

/** One of the user's threads, or null (missing, another user's, or another org's). */
export async function getThread(orgId: string, userId: string, id: string) {
  const row = await db.forOrg(orgId).first(chatThreads, and(eq(chatThreads.id, id), eq(chatThreads.userId, userId)));
  return row ? toThread(row) : null;
}

/** A thread's messages, oldest first. Callers check the thread belongs to the user first. */
export async function listMessages(orgId: string, threadId: string) {
  const rows = await db.forOrg(orgId).select(chatMessages, eq(chatMessages.threadId, threadId), { orderBy: [asc(chatMessages.createdAt), asc(chatMessages.id)] });
  return rows.map(toMessage);
}

/** Saves a message and moves the thread to the top of the list. */
export async function addMessage(
  orgId: string,
  threadId: string,
  message: { role: "user" | "assistant"; content: string; provider?: ProviderId | null; model?: string | null; status?: "ok" | "stopped" },
) {
  const scope = db.forOrg(orgId);
  const at = new Date().toISOString();
  const [row] = await scope.insert(chatMessages, { id: randomUUID(), threadId, ...message, createdAt: at });
  await scope.update(chatThreads, { updatedAt: at }, eq(chatThreads.id, threadId));
  return toMessage(row);
}

export async function deleteMessage(orgId: string, id: string) {
  await db.forOrg(orgId).delete(chatMessages, eq(chatMessages.id, id));
}

/** Deletes one of the user's threads with its messages. Returns whether it existed. */
export async function deleteThread(orgId: string, userId: string, id: string) {
  const rows = await db.forOrg(orgId).delete(chatThreads, and(eq(chatThreads.id, id), eq(chatThreads.userId, userId)));
  return rows.length > 0;
}

/** Renames one of the user's threads. Returns the thread, or null when it isn't theirs. */
export async function renameThread(orgId: string, userId: string, id: string, title: string) {
  const [row] = await db.forOrg(orgId).update(chatThreads, { title }, and(eq(chatThreads.id, id), eq(chatThreads.userId, userId)));
  return row ? toThread(row) : null;
}
