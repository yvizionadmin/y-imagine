import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { GUIDED_PAGES } from "@/lib/tool-guides";

// U6: one-time tool guides and the setup checklist. Every guide sits on a real page and reads in both languages.

describe("tool guides", () => {
  it("each guide is for a page that exists", () => {
    for (const href of Object.keys(GUIDED_PAGES)) expect(existsSync(path.join(process.cwd(), "src/app/[locale]/(app)", href, "page.tsx")), href).toBe(true);
  });
  it("each has a title and three steps in English and Arabic", () => {
    for (const messages of [en, ar]) {
      const guides = messages.Shell.guides as unknown as Record<string, Record<string, string>>;
      for (const guide of Object.values(GUIDED_PAGES)) for (const k of ["title", "s1", "s2", "s3"]) expect(guides[guide]?.[k], `${guide}.${k}`).toBeTruthy();
    }
  });
  it("the checklist has every step in both languages", () => {
    for (const messages of [en, ar])
      for (const step of ["key", "image", "store", "team"]) expect(Object.keys((messages.Studio.setup.steps as Record<string, object>)[step])).toEqual(["title", "body", "action"]);
  });
});
