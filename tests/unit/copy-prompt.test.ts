import { describe, expect, it } from "vitest";
import { brandSection, copyPrompt, copySchema, tidyCopy } from "@/lib/ai/copy-prompt";
import { EMPTY_BRAND_KIT } from "@/lib/brand/limits";
import type { CopyRequest } from "@/lib/ai/types";

const request = (patch: Partial<CopyRequest> = {}): CopyRequest => ({
  sku: "SOFA-1", productName: "Oslo Sofa", category: "homeAppliances", details: "Oak legs\nLinen covers", keywords: ["linen sofa"],
  tone: "luxury", length: "long", channel: "amazon", languages: ["en", "ar"], image: null, ...patch,
});
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

describe("copy prompt", () => {
  it("carries the facts, channel rules, tone, length and both language briefs", () => {
    const prompt = copyPrompt(request(), words);
    expect(prompt).toContain("Product: Oslo Sofa, category: home appliances");
    expect(prompt).toContain("The SKU SOFA-1 is the merchant's internal stock code: never put it in the copy.");
    expect(prompt).toContain("Oak legs\nLinen covers");
    expect(prompt).toContain("Amazon");
    expect(prompt).toContain("Tone: luxury");
    expect(prompt).toContain("about 220 words");
    expect(prompt).toContain("linen sofa");
    expect(prompt).toMatch(/Never invent specifications/);
    expect(prompt).toMatch(/Arabic \(ar\).*not as a translation/);
    expect(prompt).not.toMatch(/photo is attached/);
  });

  it("only briefs the requested languages and mentions an attached photo", () => {
    const prompt = copyPrompt(request({ languages: ["ar"], image: { bytes: new Uint8Array(), mimeType: "image/png", name: "p" } }), words);
    expect(prompt).not.toContain("English (en)");
    expect(prompt).toContain("photo is attached");
  });

  it("adds only the filled-in brand kit fields, as style guidance after the tone", () => {
    const brand = { ...EMPTY_BRAND_KIT, name: "Northwind Home", avoidWords: ["cheap", "best ever"], rules: "No exclamation marks" };
    const prompt = copyPrompt(request({ brand }), words);
    expect(prompt).toContain("Brand: Northwind Home.");
    expect(prompt).toContain("Never use these words or their translations in any language: cheap, best ever.");
    expect(prompt).toContain("House style rules:\nNo exclamation marks");
    expect(prompt).toMatch(/style guidance only: it never adds product facts/);
    expect(prompt.indexOf("Tone: luxury")).toBeLessThan(prompt.indexOf("Brand: Northwind"));
    expect(prompt).not.toMatch(/Brand voice:|Written for:|About the brand:/);
    expect(copyPrompt(request(), words)).not.toContain("brand kit");
    expect(brandSection(EMPTY_BRAND_KIT)).toBe("");
  });

  it("schema asks for exactly the requested languages", () => {
    expect(Object.keys(copySchema(["ar"]).shape)).toEqual(["ar"]);
    expect(copySchema(["en", "ar"]).safeParse({ en: {} }).success).toBe(false);
  });

  it("tidies model output: markdown, quotes, caps, duplicate tags", () => {
    const tidy = tidyCopy({
      title: '"**Oslo Sofa**"',
      bullets: ["- **Soft** linen", "", ...Array.from({ length: 9 }, (_, i) => `b${i}`)],
      description: "## Heading\nText",
      metaTitle: "x".repeat(100),
      metaDescription: "y".repeat(300),
      tags: ["#Sofa", "sofa", "Linen "],
    });
    expect(tidy.title).toBe("Oslo Sofa");
    expect(tidy.bullets[0]).toBe("Soft linen");
    expect(tidy.bullets).toHaveLength(7);
    expect(tidy.description).toBe("Heading\nText");
    expect(tidy.metaTitle.length).toBe(70);
    expect(tidy.metaDescription.length).toBe(170);
    expect(tidy.tags).toEqual(["sofa", "linen"]);
  });
});
