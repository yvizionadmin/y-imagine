import { describe, expect, it } from "vitest";
import { introPosition } from "@/features/marketing/components/before-after";
import { breadcrumbs, faqPage, homeGraph, jsonLdString } from "@/features/marketing/structured-data";

const base = "https://imagine.example";

describe("structured data", () => {
  it("describes the brand, the site and the app with its free plan, and nothing it can't back up", () => {
    const graph = homeGraph({ base, locale: "ar", brand: "Imagine AI", description: "Product content", email: "hi@imagine.example" })["@graph"] as Record<string, unknown>[];
    expect(graph.map((t) => t["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(graph[0]).toMatchObject({ name: "Imagine AI", url: base, email: "hi@imagine.example" });
    expect(graph[1]).toMatchObject({ url: `${base}/ar`, inLanguage: "ar" });
    expect(graph[2]).toMatchObject({ offers: { price: "0", priceCurrency: "AED" }, operatingSystem: "Web" });
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|review/i);
  });

  it("leaves out the email when there is none", () => {
    const graph = homeGraph({ base, locale: "en", brand: "Imagine AI", description: "x", email: null })["@graph"] as Record<string, unknown>[];
    expect(graph[0]).not.toHaveProperty("email");
  });

  it("numbers the breadcrumb trail with full URLs", () => {
    expect(breadcrumbs(base, [{ name: "Home", path: "/en" }, { name: "Pricing", path: "/en/pricing" }]).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${base}/en` },
      { "@type": "ListItem", position: 2, name: "Pricing", item: `${base}/en/pricing` },
    ]);
  });

  it("turns the pricing questions into an FAQ page", () => {
    expect(faqPage([{ q: "Can I cancel?", a: "Yes." }]).mainEntity).toEqual([{ "@type": "Question", name: "Can I cancel?", acceptedAnswer: { "@type": "Answer", text: "Yes." } }]);
  });

  it("can't close its own script tag", () => {
    const text = jsonLdString(faqPage([{ q: "</script><script>alert(1)</script>", a: "a" }]));
    expect(text).not.toContain("<");
    expect(JSON.parse(text).mainEntity[0].name).toBe("</script><script>alert(1)</script>");
  });
});

describe("before/after intro sweep", () => {
  it("starts and ends in the middle, and reaches both sides on the way", () => {
    expect(introPosition(0)).toBe(50);
    expect(introPosition(1)).toBe(50);
    expect(introPosition(1 / 3)).toBeCloseTo(82);
    expect(introPosition(2 / 3)).toBeCloseTo(18);
  });

  it("stays inside the frame for any time, even out of range", () => {
    for (let t = -0.5; t <= 1.5; t += 0.01) {
      const pos = introPosition(t);
      expect(pos).toBeGreaterThanOrEqual(18);
      expect(pos).toBeLessThanOrEqual(82);
    }
  });
});
