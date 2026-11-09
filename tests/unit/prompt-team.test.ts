import { describe, expect, it } from "vitest";
import { promptPhrases, teamPhrases, type TeamPromptRow } from "@/lib/prompt-team";

const row = (text: string | null, extra: Partial<TeamPromptRow> = {}): TeamPromptRow => ({
  text,
  category: "furniture",
  createdAt: "2026-11-01T10:00:00Z",
  uploaded: false,
  approved: false,
  ...extra,
});

describe("promptPhrases", () => {
  it("splits at commas, full stops and Arabic punctuation, keeping chip-sized phrases once", () => {
    expect(promptPhrases("Soft morning light, warm oak floor. Soft  morning light; rug")).toEqual(["Soft morning light", "warm oak floor"]);
    expect(promptPhrases("إضاءة صباحية ناعمة، أرضية خشبية دافئة")).toEqual(["إضاءة صباحية ناعمة", "أرضية خشبية دافئة"]);
  });

  it("drops single words, long sentences and wording the tips warn about", () => {
    const long = "a very long phrase with far too many words to be a chip at all";
    expect(promptPhrases(`rug, ${long}, add the SALE text, make the sofa bigger, linen curtains drawn`)).toEqual(["linen curtains drawn"]);
  });
});

describe("teamPhrases", () => {
  it("needs a phrase in two different prompts; one bulk run repeating a prompt counts once", () => {
    const bulk = Array.from({ length: 20 }, () => row("terracotta pots on the floor, low camera angle"));
    expect(teamPhrases(bulk, { category: "furniture" })).toEqual([]);
    expect(teamPhrases([...bulk, row("low camera angle, marble side table")], { category: "furniture" })).toEqual(["low camera angle"]);
  });

  it("an approved or uploaded result is enough on its own; approved 3, uploaded 2, ties to the newest", () => {
    const rows = [row("plain grey wall"), row("plain grey wall, shadow on the left"), row("golden hour glow", { approved: true }), row("linen throw on the arm", { uploaded: true, createdAt: "2026-11-04T00:00:00Z" })];
    expect(teamPhrases(rows, { category: "furniture" })).toEqual(["golden hour glow", "linen throw on the arm", "plain grey wall"]);
  });

  it("puts the chosen category first, then score, then the newest", () => {
    const rows = [
      row("beach sand backdrop", { category: "outdoor", approved: true }),
      row("dark slate floor", { uploaded: true, createdAt: "2026-11-02T00:00:00Z" }),
      row("white studio sweep", { uploaded: true, createdAt: "2026-11-05T00:00:00Z" }),
    ];
    expect(teamPhrases(rows, { category: "furniture" })).toEqual(["white studio sweep", "dark slate floor", "beach sand backdrop"]);
    expect(teamPhrases(rows, { category: "furniture", limit: 1 })).toEqual(["white studio sweep"]);
  });

  it("shows the most recent wording of a phrase and ignores empty prompts", () => {
    const rows = [row(null), row("  "), row("Warm evening glow", { createdAt: "2026-11-01T00:00:00Z" }), row("warm evening GLOW, rug", { createdAt: "2026-11-03T00:00:00Z" })];
    expect(teamPhrases(rows, { category: "furniture" })).toEqual(["warm evening GLOW"]);
  });
});
