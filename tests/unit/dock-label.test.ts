import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { chipLabel, shorten } from "@/lib/dock-label";

describe("chipLabel", () => {
  it("drops the old step numbers from section titles", () => {
    expect(chipLabel("2. Scene Settings")).toBe("Scene Settings");
    expect(chipLabel("4. Custom Instructions")).toBe("Custom Instructions");
    expect(chipLabel("٢. إعدادات المشهد")).toBe("إعدادات المشهد");
    expect(chipLabel("2. New Fabric Color *")).toBe("New Fabric Color");
  });

  it("leaves titles without a number alone", () => {
    expect(chipLabel("Shots")).toBe("Shots");
    expect(chipLabel("A+ Reference (Optional)")).toBe("A+ Reference (Optional)");
    expect(chipLabel("3D view")).toBe("3D view");
  });

  it("has the dock's labels in both languages", () => {
    for (const messages of [en, ar]) {
      for (const key of ["settings", "requiredSetting", "readySetting", "productTile", "swatchTile"] as const) {
        expect(messages.Workspace[key]).toBeTruthy();
      }
      expect(messages.Generate.shots.chipSummary).toContain("plural");
    }
  });
});

describe("shorten", () => {
  it("previews free text for a chip", () => {
    expect(shorten("")).toBeNull();
    expect(shorten("   \n ")).toBeNull();
    expect(shorten("  soft   morning\nlight ")).toBe("soft morning light");
    expect(shorten("soft morning window light, oak floor", 24)).toBe("soft morning window lig…");
  });
});
