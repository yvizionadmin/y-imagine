import { describe, expect, it } from "vitest";
import { animateHref, assetIdOf } from "@/lib/image/animate-href";
import { estimatedProgress } from "@/lib/progress";

// U3: "Animate" opens the Studio with a stored image as the start frame; the creating overlay shows an estimate.

const id = "0b6f3c1e-2a4d-4c8e-9f10-1234567890ab";

describe("animateHref", () => {
  it("accepts the org's stored images, relative or absolute", () => {
    expect(assetIdOf(`/api/assets/${id}`)).toBe(id);
    expect(assetIdOf(`http://localhost:3000/api/assets/${id}?w=640`)).toBe(id);
    expect(animateHref(`/api/assets/${id}`)).toBe(`/home?mode=video&frame=${id}`);
  });
  it("refuses anything else: other paths, ids, data URLs", () => {
    for (const src of ["/api/assets/../secret", `/api/assets/${id}/x`, "/api/assets/not-an-id", "data:image/png;base64,AAAA", "https://example.com/a.png", ""]) {
      expect(animateHref(src), src).toBeNull();
    }
  });
});

describe("estimatedProgress", () => {
  it("starts at zero, passes half around the typical time, and never reaches done", () => {
    expect(estimatedProgress(0, 30)).toBe(0);
    expect(estimatedProgress(30, 30)).toBeGreaterThan(50);
    expect(estimatedProgress(10_000, 30)).toBe(90);
    expect(estimatedProgress(-5, 30)).toBe(0);
  });
  it("only moves forward", () => {
    let last = -1;
    for (let s = 0; s < 200; s += 5) {
      const next = estimatedProgress(s, 30);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });
});
