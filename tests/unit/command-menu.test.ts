import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { DESTINATIONS, matchDestinations, navItems, searchAdminItems } from "@/components/app/nav-items";

// U1: the top bar's ⌘K search. It only navigates, so it must list real pages, labelled in both languages.

const all = [...DESTINATIONS, ...searchAdminItems];
const page = (href: string) => {
  const dir = href.startsWith("/admin") ? "(admin)" : "(app)";
  return path.join(process.cwd(), "src/app/[locale]", dir, href, "page.tsx");
};

describe("command menu destinations", () => {
  it("each one opens a page that exists, once", () => {
    for (const d of all) expect(existsSync(page(d.href)), d.href).toBe(true);
    expect(new Set(all.map((d) => d.key)).size).toBe(all.length);
    expect(new Set(all.map((d) => d.href)).size).toBe(all.length);
  });

  it("covers every rail tool", () => {
    const hrefs = new Set(all.map((d) => d.href));
    for (const item of navItems) expect(hrefs.has(item.href), item.href).toBe(true);
  });

  it("has a name and a description in English and Arabic", () => {
    for (const messages of [en, ar]) {
      const items = messages.Shell.search.items as Record<string, { title: string; hint: string }>;
      for (const d of all) {
        expect(items[d.key]?.title, d.key).toBeTruthy();
        expect(items[d.key]?.hint, d.key).toBeTruthy();
      }
    }
  });
});

describe("matchDestinations", () => {
  const items = [
    { key: "a", label: "Recolor product", hint: "New colors and fabrics" },
    { key: "b", label: "Bulk recolor", hint: "Recolor many products at once" },
    { key: "c", label: "Video editor", hint: "Trim, merge, subtitles" },
  ];
  it("lists everything for an empty query", () => {
    expect(matchDestinations(items, "  ")).toEqual(items);
  });
  it("matches every word, in the name or description, ignoring case", () => {
    expect(matchDestinations(items, "RECOLOR").map((i) => i.key)).toEqual(["a", "b"]);
    expect(matchDestinations(items, "bulk recolor").map((i) => i.key)).toEqual(["b"]);
    expect(matchDestinations(items, "subtitles").map((i) => i.key)).toEqual(["c"]);
    expect(matchDestinations(items, "music video")).toEqual([]);
  });
  it("matches Arabic names", () => {
    expect(matchDestinations([{ label: "محرر الفيديو", hint: "قصّ ودمج" }], "الفيديو")).toHaveLength(1);
  });
});
