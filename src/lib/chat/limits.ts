import type { ChatTurn } from "@/lib/ai/types";

// Chat limits and pure helpers, shared by the server and the chat screen (client-safe).

/** Longest message a user can send. */
export const CHAT_MESSAGE_MAX = 4000;
/** Most recent messages sent to the model with a new one (older ones stay saved, not resent). */
export const CHAT_HISTORY_MESSAGES = 40;
/** Character budget for that history, so a long thread can't blow the model's context or the bill. */
export const CHAT_HISTORY_CHARS = 32_000;
/** Threads shown in the list. */
export const CHAT_THREADS_SHOWN = 50;
const TITLE_MAX = 60;

/** A thread's title: the first line of its first message, shortened. */
export function threadTitle(text: string) {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

/** A message as typed: trimmed, null when empty or too long. */
export function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim();
  return text && text.length <= CHAT_MESSAGE_MAX ? text : null;
}

/**
 * The newest turns that fit the budget, oldest first. Always starts with a user turn (models expect
 * it) and always keeps the last turn, even when it alone is over the character budget.
 */
export function historyFor(turns: ChatTurn[], maxMessages = CHAT_HISTORY_MESSAGES, maxChars = CHAT_HISTORY_CHARS): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < maxMessages; i--) {
    chars += turns[i].content.length;
    if (kept.length > 0 && chars > maxChars) break;
    kept.unshift(turns[i]);
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}
