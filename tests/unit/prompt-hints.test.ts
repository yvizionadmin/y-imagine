import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { categoryPresets } from "@/lib/catalog-presets";
import { appendPhrase, promptTips, unusedChips } from "@/lib/prompt-hints";

describe("prompt tips", () => {
  it("flags requests to draw text or change the product, in English and Arabic", () => {
    expect(promptTips("add our logo and write SALE on the wall")).toEqual(["text"]);
    expect(promptTips("make the sofa bigger")).toEqual(["productChange"]);
    expect(promptTips("remove the legs, add a drawer")).toEqual(["productChange"]);
    expect(promptTips("أضف الشعار على الجدار")).toEqual(["text"]);
    expect(promptTips("اجعل الكنبة أكبر")).toEqual(["productChange"]);
  });

  it("doesn't flag ordinary scene wording", () => {
    expect(promptTips("warm evening light, textured linen throw, eye-level shot")).toEqual([]);
    // "نص" inside a longer word (منصة = platform) is not a request for text.
    expect(promptTips("منصة خشبية في حديقة مشمسة")).toEqual([]);
    expect(promptTips("")).toEqual([]);
  });

  it("asks for more detail only for short scene descriptions, and flags long ones", () => {
    expect(promptTips("nice room", { checkShort: true })).toEqual(["tooShort"]);
    expect(promptTips("nice room")).toEqual([]);
    expect(promptTips(Array(61).fill("word").join(" "))).toContain("tooLong");
  });
});

describe("suggestion chips", () => {
  it("appends as comma-separated details and respects the length limit", () => {
    expect(appendPhrase("", "warm evening light", 100)).toBe("warm evening light");
    expect(appendPhrase("sunny patio", "warm evening light", 100)).toBe("sunny patio, warm evening light");
    expect(appendPhrase("sunny patio.", "warm light", 100)).toBe("sunny patio. warm light");
    expect(appendPhrase("غرفة جميلة", "ضوء مسائي دافئ", 100)).toBe("غرفة جميلة، ضوء مسائي دافئ");
    expect(appendPhrase("x".repeat(95), "warm light", 100)).toBeNull();
  });

  it("hides chips already in the text", () => {
    expect(unusedChips(["Warm evening light", "eye-level, wide shot"], "patio, warm evening light")).toEqual(["eye-level, wide shot"]);
  });

  it("every category and recolor kind has phrases in both languages", () => {
    for (const messages of [en, ar]) {
      const hints = messages.PromptHints;
      for (const c of categoryPresets) {
        expect(hints.scenes[c.key as keyof typeof hints.scenes]?.length, c.key).toBeGreaterThan(0);
        expect(hints.recolor[c.recolorKind]?.length, c.recolorKind).toBeGreaterThan(0);
      }
      expect(hints.details.length).toBeGreaterThan(0);
    }
  });
});
