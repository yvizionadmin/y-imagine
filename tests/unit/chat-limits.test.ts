import { describe, expect, it } from "vitest";
import { cleanMessage, CHAT_MESSAGE_MAX, historyFor, threadTitle } from "@/lib/chat/limits";
import { chatSystemPrompt } from "@/lib/chat/prompt";
import { EMPTY_BRAND_KIT } from "@/lib/brand/limits";
import type { ChatTurn } from "@/lib/ai/types";

const turn = (role: ChatTurn["role"], content: string): ChatTurn => ({ role, content });

describe("chat helpers", () => {
  it("titles a thread from the first line, shortened", () => {
    expect(threadTitle("  Hello   there\nsecond line")).toBe("Hello there");
    const long = threadTitle("a".repeat(100));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
    expect(threadTitle("اكتب وصفًا لكنبة")).toBe("اكتب وصفًا لكنبة");
  });

  it("cleans messages: trimmed, CRLF normalised, empty or too long refused", () => {
    expect(cleanMessage("  hi\r\nthere ")).toBe("hi\nthere");
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage(5)).toBeNull();
    expect(cleanMessage("x".repeat(CHAT_MESSAGE_MAX))).toHaveLength(CHAT_MESSAGE_MAX);
    expect(cleanMessage("x".repeat(CHAT_MESSAGE_MAX + 1))).toBeNull();
  });

  it("history keeps the newest turns in budget, starting with a user turn", () => {
    const turns = [turn("user", "a"), turn("assistant", "b"), turn("user", "c"), turn("assistant", "d"), turn("user", "e")];
    expect(historyFor(turns)).toEqual(turns);
    expect(historyFor(turns, 4).map((t) => t.content)).toEqual(["c", "d", "e"]); // "b" dropped: can't start with assistant
    expect(historyFor([turn("user", "old"), turn("assistant", "x".repeat(50)), turn("user", "new")], 40, 20).map((t) => t.content)).toEqual(["new"]);
    // The last message is always kept, even alone over budget.
    expect(historyFor([turn("user", "y".repeat(100))], 40, 10)).toHaveLength(1);
  });

  it("system prompt names the org and date, adds the brand kit only when given", () => {
    const plain = chatSystemPrompt({ orgName: "Oslo Home", today: "2026-11-08", brand: null });
    expect(plain).toContain("Oslo Home");
    expect(plain).toContain("2026-11-08");
    expect(plain).not.toContain("brand kit");
    const branded = chatSystemPrompt({ orgName: "Oslo Home", today: "2026-11-08", brand: { ...EMPTY_BRAND_KIT, voice: "Warm" } });
    expect(branded).toContain("Brand voice: Warm");
  });
});
