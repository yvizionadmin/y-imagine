// Bulk Copy input: a CSV (or a plain list of SKUs, one per line) turned into batch rows. Pure, so
// the panel previews exactly what the server will accept. Rows with only a SKU are filled from the
// org's catalog when they run.

export const BATCH_MAX_ROWS = 200;
const LIMITS = { sku: 64, productName: 200, details: 3000, keyword: 60, keywords: 15 } as const;

export type ParsedRow = { sku: string; productName: string; category: string | null; details: string; keywords: string[] };
export type RowProblem = { line: number; reason: "missing_sku" | "duplicate" | "too_long" };
export type ParsedBatch = { rows: ParsedRow[]; problems: RowProblem[]; truncated: boolean; header: boolean };

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    out.push(row);
    row = [];
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length) endRow();
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

const COLUMNS: Record<keyof ParsedRow, string[]> = {
  sku: ["sku"],
  productName: ["name", "product_name", "product name", "productname", "title"],
  category: ["category"],
  details: ["details", "description", "features"],
  keywords: ["keywords", "tags"],
};
// Without a header row: SKU, name, details, keywords (any trailing columns can be left out).
const POSITIONAL: (keyof ParsedRow)[] = ["sku", "productName", "details", "keywords"];

export function parseBatchInput(text: string, categories: readonly string[]): ParsedBatch {
  const table = parseCsv(text);
  const first = table[0]?.map((c) => c.trim().toLowerCase()) ?? [];
  const header = first.includes("sku");
  const index = new Map<keyof ParsedRow, number>();
  if (header) {
    for (const [key, names] of Object.entries(COLUMNS) as [keyof ParsedRow, string[]][]) {
      const at = first.findIndex((c) => names.includes(c));
      if (at >= 0) index.set(key, at);
    }
  } else POSITIONAL.forEach((key, i) => index.set(key, i));

  const rows: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const lineOffset = header ? 2 : 1;
  for (const [i, cells] of (header ? table.slice(1) : table).entries()) {
    const get = (key: keyof ParsedRow) => (index.has(key) ? (cells[index.get(key)!] ?? "").trim() : "");
    const line = i + lineOffset;
    const sku = get("sku");
    if (!sku) {
      problems.push({ line, reason: "missing_sku" });
      continue;
    }
    if (sku.length > LIMITS.sku || get("productName").length > LIMITS.productName || get("details").length > LIMITS.details) {
      problems.push({ line, reason: "too_long" });
      continue;
    }
    if (seen.has(sku.toLowerCase())) {
      problems.push({ line, reason: "duplicate" });
      continue;
    }
    if (rows.length === BATCH_MAX_ROWS) {
      truncated = true;
      break;
    }
    seen.add(sku.toLowerCase());
    const category = get("category").toLowerCase();
    rows.push({
      sku,
      productName: get("productName"),
      category: categories.includes(category) ? category : null,
      details: get("details"),
      keywords: [...new Set(get("keywords").split(/[,;|]/).map((k) => k.trim().slice(0, LIMITS.keyword)).filter(Boolean))].slice(0, LIMITS.keywords),
    });
  }
  return { rows, problems, truncated, header };
}

export const BATCH_TEMPLATE_CSV = "﻿sku,name,category,details,keywords\r\nSOFA-2041,Oslo 3-Seater Sofa,furniture,\"Linen blend, oak legs, 220 cm wide\",\"sofa; living room\"\r\nLAMP-118,,,,\r\n";
