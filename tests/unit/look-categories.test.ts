import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { categoryBackgrounds, LOOK_STYLES, lookStyles, sceneBackgroundId } from "@/features/looks/config";
import { categoryPresets } from "@/lib/catalog-presets";

describe("look categories", () => {
  it("keeps the room styles for furniture and uses each other category's preset styles", () => {
    expect(lookStyles("furniture")).toEqual(LOOK_STYLES);
    expect(lookStyles("fashion")).toEqual(categoryPresets.find((c) => c.key === "fashion")!.styles);
  });

  it("labels every category's styles in both locales", () => {
    for (const c of categoryPresets) {
      for (const style of lookStyles(c.key)) {
        expect(en.Looks.styles, `en ${style}`).toHaveProperty(style);
        expect(ar.Looks.styles, `ar ${style}`).toHaveProperty(style);
      }
    }
  });

  it("offers the org's backgrounds for the category, else the category's preset scenes", () => {
    const own = [
      { id: "a", category: "furniture", active: true },
      { id: "b", category: "furniture", active: false },
      { id: "c", category: "fashion", active: false },
    ];
    expect(categoryBackgrounds("furniture", own)).toEqual({ own: [own[0]], scenes: [] });
    // Only an inactive fashion background: the presets stand in.
    const fashion = categoryBackgrounds("fashion", own);
    expect(fashion.own).toEqual([]);
    expect(fashion.scenes.map((s) => s.key)).toEqual(["studioBackdrop", "urbanStreet", "editorialSet"]);
    expect(sceneBackgroundId("urbanStreet")).toBe("scene:urbanStreet");
  });
});
