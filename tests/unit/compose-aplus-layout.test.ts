import { describe, expect, it } from "vitest";
import type { AplusRequest } from "@/lib/ai/types";
import { aplusHeroSize, composeAplus } from "@/lib/image/compose-aplus";

// A+ layout: the feature row fits its text, and the photo takes the rest of the card.

const feature = (title = "Solid oak", description = "A frame built for daily use") => ({ title, description });
const input = (over: Partial<AplusRequest> = {}) => ({ resolution: "HD" as const, aspectRatio: "1:1", reference: { kind: "library" as const, layout: "bento" as const }, features: [feature(), feature()], ...over });

describe("A+ hero size", () => {
  it("gives short features a larger photo than the old fixed 58%", () => {
    const { height } = aplusHeroSize(input());
    expect(height).toBeGreaterThan(1200 * (280 / 480));
    expect(height).toBeLessThan(1200);
  });

  it("gives more room to longer text", () => {
    const long = feature("Removable washable covers", "Every cover comes off and goes in the wash, keeping the chair fresh for years of daily family use");
    expect(aplusHeroSize(input({ features: [long, long, long, long] })).height).toBeLessThan(aplusHeroSize(input()).height);
  });

  it("never gives the row more than the design's share, so wide cards keep their photo", () => {
    const long = feature("Removable washable covers", "Every cover comes off and goes in the wash, keeping the chair fresh for years of daily family use");
    const wide = input({ aspectRatio: "16:9", features: [long, long, long, long] });
    const H = Math.round((1200 * 9) / 16);
    expect(aplusHeroSize(wide).height).toBeGreaterThanOrEqual(H - Math.round(H * (200 / 480)));
  });

  it("copes with no features", () => {
    expect(aplusHeroSize(input({ features: [] })).height).toBeLessThan(1200);
  });

  it("still renders every layout at the exact card size, in both languages", async () => {
    for (const layout of ["bento", "gallery"] as const) {
      for (const copy of [{ title: "Oak Chair", features: [feature(), feature()] }, { title: "كرسي بلوط", features: [feature("هيكل بلوط", "خشب بلوط صلب"), feature("مقعد مريح", "تنجيد ناعم")] }]) {
        const request = { sku: "S", product: { bytes: new Uint8Array(), mimeType: "image/png", name: "p" }, category: "furniture", scene: null, style: null, subtitle: "", ...input({ reference: { kind: "library", layout } }), ...copy } as AplusRequest;
        const hero = aplusHeroSize(request);
        const sharp = (await import("sharp")).default;
        const ai = await sharp({ create: { width: hero.width, height: hero.height, channels: 3, background: "#cccccc" } }).png().toBuffer();
        const out = await composeAplus(request, new Uint8Array(ai));
        expect(out).toMatchObject({ width: 1200, height: 1200 });
      }
    }
  });
});
