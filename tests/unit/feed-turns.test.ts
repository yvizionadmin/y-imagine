import { describe, expect, it } from "vitest";
import { feedTurns, promptOf } from "@/lib/feed-turns";

const item = (id: string, sku: string, minute: number, instructions: string | null = null) => ({
  id,
  sku,
  createdAt: new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString(),
  settings: { instructions },
});

describe("feedTurns", () => {
  it("groups one job's results (same SKU and prompt, minutes apart) into a turn", () => {
    const turns = feedTurns([item("a", "SOFA-1", 0, "warm light"), item("b", "SOFA-1", 1, "warm light"), item("c", "SOFA-1", 2, "cool light"), item("d", "CHAIR-2", 3)]);
    expect(turns.map((t) => t.map((i) => i.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("starts a new turn after a long gap", () => {
    expect(feedTurns([item("a", "SOFA-1", 0), item("b", "SOFA-1", 30)]).length).toBe(2);
    expect(feedTurns([])).toEqual([]);
  });

  it("reads the prompt from instructions, notes or a described scene", () => {
    expect(promptOf({ ...item("a", "S", 0), settings: { notes: "keep legs" } })).toBe("keep legs");
    expect(promptOf({ ...item("a", "S", 0), settings: { customScene: "beach" } })).toBe("beach");
    expect(promptOf(item("a", "S", 0))).toBe("");
  });
});
