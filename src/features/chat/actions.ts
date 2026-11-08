"use server";

import { threadTitle } from "@/lib/chat/limits";
import { deleteThread, getThread, listMessages, listThreads, renameThread, type ChatMessage, type ChatThread } from "@/lib/chat/threads";
import { getWorkspace } from "@/lib/workspace";

// Threads are private to the user who started them (inside the current org). Sending a message is
// the /api/chat route (streamed); these read and tidy the history. Viewers can read their threads.

/** The user's threads, and whether they can send (viewers read only). */
export async function getChatState(): Promise<{ threads: ChatThread[]; canSend: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return { threads: await listThreads(workspace.orgId, workspace.user.id), canSend: workspace.role !== "viewer" };
}

export async function openChatThread(id: string): Promise<{ thread: ChatThread; messages: ChatMessage[] } | null> {
  const workspace = await getWorkspace();
  if (typeof id !== "string") return null;
  const thread = await getThread(workspace.orgId, workspace.user.id, id);
  return thread ? { thread, messages: await listMessages(workspace.orgId, thread.id) } : null;
}

export async function renameChatThread(id: string, title: string): Promise<{ ok: true; thread: ChatThread } | { ok: false; error: "invalid_input" | "not_found" }> {
  const workspace = await getWorkspace();
  const clean = typeof title === "string" ? threadTitle(title) : "";
  if (typeof id !== "string" || !clean) return { ok: false, error: "invalid_input" };
  const thread = await renameThread(workspace.orgId, workspace.user.id, id, clean);
  return thread ? { ok: true, thread } : { ok: false, error: "not_found" };
}

export async function deleteChatThread(id: string): Promise<{ ok: boolean }> {
  const workspace = await getWorkspace();
  return { ok: typeof id === "string" && (await deleteThread(workspace.orgId, workspace.user.id, id)) };
}
