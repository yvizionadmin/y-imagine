import { describe, expect, it } from "vitest";
import { BATCH_MAX_ROWS, BATCH_TEMPLATE_CSV, parseBatchInput, parseCsv } from "@/lib/copy/batch-csv";

const CATEGORIES = ["furniture", "electronics"];

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF, a BOM and blank lines", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\nd,"multi\nline",\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["d", "multi\nline", ""],
    ]);
  });
});

describe("parseBatchInput", () => {
  it("reads named columns in any order, with aliases", () => {
    const { rows, header, problems } = parseBatchInput("Product Name,SKU,Tags,Category,Description\nOslo Sofa,SOFA-1,\"sofa; linen|sofa\",Furniture,Oak legs", CATEGORIES);
    expect(header).toBe(true);
    expect(problems).toEqual([]);
    expect(rows).toEqual([{ sku: "SOFA-1", productName: "Oslo Sofa", category: "furniture", details: "Oak legs", keywords: ["sofa", "linen"] }]);
  });

  it("treats a headerless list as SKU, name, details, keywords; SKU-only lines are fine", () => {
    const { rows } = parseBatchInput("LAMP-1\nSOFA-2,Oslo Sofa,Linen", CATEGORIES);
    expect(rows.map((r) => [r.sku, r.productName, r.details])).toEqual([
      ["LAMP-1", "", ""],
      ["SOFA-2", "Oslo Sofa", "Linen"],
    ]);
  });

  it("skips rows without a SKU, duplicates (case-insensitive) and over-long values, with line numbers", () => {
    const { rows, problems } = parseBatchInput(`sku,name\n,No sku\nA-1,One\na-1,Again\n${"X".repeat(65)},Long`, CATEGORIES);
    expect(rows.map((r) => r.sku)).toEqual(["A-1"]);
    expect(problems).toEqual([
      { line: 2, reason: "missing_sku" },
      { line: 4, reason: "duplicate" },
      { line: 5, reason: "too_long" },
    ]);
  });

  it("drops unknown categories and caps the run size", () => {
    const many = Array.from({ length: BATCH_MAX_ROWS + 5 }, (_, i) => `SKU-${i},Name,toys`).join("\n");
    const parsed = parseBatchInput(`sku,name,category\n${many}`, CATEGORIES);
    expect(parsed.rows).toHaveLength(BATCH_MAX_ROWS);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows[0].category).toBeNull();
  });

  it("the downloadable template parses", () => {
    expect(parseBatchInput(BATCH_TEMPLATE_CSV, CATEGORIES).rows.map((r) => r.sku)).toEqual(["SOFA-2041", "LAMP-118"]);
  });
});
