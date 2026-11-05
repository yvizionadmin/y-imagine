import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { categoryPresets, findSubcategory, subcategoryImage } from "@/lib/catalog-presets";

describe("category subcategories", () => {
  it("every category lists product types, each labelled in English and Arabic and with a picker photo", () => {
    for (const c of categoryPresets) {
      expect(c.subcategories.length, c.key).toBeGreaterThan(0);
      expect(new Set(c.subcategories).size, c.key).toBe(c.subcategories.length);
      for (const s of c.subcategories) {
        expect(en.Presets.subcategories[s as keyof typeof en.Presets.subcategories], s).toBeTruthy();
        expect(ar.Presets.subcategories[s as keyof typeof ar.Presets.subcategories], s).toBeTruthy();
        expect(existsSync(join("public", subcategoryImage(s))), s).toBe(true);
      }
    }
  });

  it("finds a product type only inside its own category", () => {
    expect(findSubcategory("furniture", "sofas")).toBe("sofas");
    expect(findSubcategory("furniture", "faucets")).toBeNull();
    expect(findSubcategory("furniture", null)).toBeNull();
    expect(findSubcategory("notACategory", "sofas")).toBeNull();
  });
});
