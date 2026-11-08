import type { AplusFeature, AplusLayout, RecolorScope } from "@/lib/ai/types";
import { FEATURE_RANGE, TEXT_LIMITS } from "@/features/aplus/config";
import { parseCsv } from "@/lib/copy/batch-csv";
import type { AspectRatio, Resolution } from "@/lib/image-formats";

// Bulk image runs: shared settings and the pasted/uploaded product list. Used by the browser
// (live preview of what will run) and the server (the same parse decides what is queued).

export const IMAGE_BATCH_TOOLS = ["generate", "recolor", "aplus"] as const;
export type ImageBatchTool = (typeof IMAGE_BATCH_TOOLS)[number];

/** Image jobs are slow and use the org's own provider budget, so runs stay small. */
export const IMAGE_BATCH_MAX_ROWS = 50;

/** Which of a product's catalog images a run uses: 1 is the first. Stores keep their main photo first. */
export const CATALOG_IMAGE_POSITIONS = [1, 2, 3, 4, 5] as const;

/** The setting from a request: absent means the first image; anything out of range is refused (null). */
export function parseCatalogImage(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 1;
  const position = Number(value);
  return (CATALOG_IMAGE_POSITIONS as readonly number[]).includes(position) ? position : null;
}

/** The position a product can actually serve: its last image when it has fewer than asked for. 0 when it has none. */
export const usableImagePosition = (imageCount: number, wanted: number) => Math.min(imageCount, Math.max(1, wanted));

/** A+ titles taken from the catalog, for rows without their own. */
export const CATALOG_TITLE_LANGUAGES = ["en", "ar"] as const;
export type CatalogTitleLanguage = (typeof CATALOG_TITLE_LANGUAGES)[number];

/** The catalog name in the chosen language, or the main name when the product has no Arabic one. */
export const catalogTitle = (product: { name: string; nameAr?: string | null }, language: CatalogTitleLanguage | undefined) => (language === "ar" && product.nameAr?.trim()) || product.name;

/** Generate settings shared by every product of a run. Scene uploads aren't offered in bulk. */
export type GenerateBatchSettings = {
  category: string;
  /** Product type inside the category; absent on runs started before product types existed. */
  subcategory?: string | null;
  scene: string | null;
  customScene: string | null;
  style: string | null;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  instructions: string;
  /** History title for every image, written in the UI language when the run starts. */
  title: string;
  /** Absent on runs started before this existed: the first image. */
  catalogImage?: number;
};

/** Recolor: one swatch (stored as an asset when the run starts) applied to every product. */
export type RecolorBatchSettings = {
  category: string;
  subcategory: string | null;
  swatchAssetId: string;
  swatchMime: string;
  /** The swatch file's name, for History titles and settings. */
  swatchName: string;
  /** Target colour from swatch analysis, e.g. "#D8C8B5". */
  hex: string;
  scope: RecolorScope;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  notes: string;
  title: string;
  catalogImage?: number;
};

/** A+: layout, scene and format shared by the run; each product brings its own text (row data). */
export type AplusBatchSettings = {
  category: string;
  subcategory: string | null;
  layout: AplusLayout | null;
  scene: string | null;
  style: string | null;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  title: string;
  catalogImage?: number;
  /** Absent on runs started before this existed: the main name. */
  catalogTitle?: CatalogTitleLanguage;
};

export type ImageBatchSettings = GenerateBatchSettings | RecolorBatchSettings | AplusBatchSettings;

/** Per-product A+ text. An empty title is filled from the catalog name when the item runs (see `catalogTitle` in the settings). */
export type AplusRowData = { title: string; subtitle: string; features: AplusFeature[] };

export type ImageBatchRow = { sku: string; productSize: string; data?: AplusRowData | null };

export type ParsedImageRows = { rows: ImageBatchRow[]; skipped: { line: number; reason: "duplicate" | "invalid_sku" }[]; truncated: boolean };

const HEADER = /^\s*"?sku"?\s*(,|$)/i;
const SKU = /^[\p{L}\p{N}][\p{L}\p{N}._\-/ ]{0,63}$/u;

/** One product per line: `sku` or `sku,product size` (a `sku,…` header line is skipped; quotes allowed). */
export function parseImageRows(text: string, productSizeMax: number): ParsedImageRows {
  const rows: ImageBatchRow[] = [];
  const skipped: ParsedImageRows["skipped"] = [];
  const seen = new Set<string>();
  let truncated = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim() || (index === 0 && HEADER.test(raw))) return;
    const [first, ...rest] = raw.split(",");
    const sku = first.trim().replace(/^"|"$/g, "").trim();
    const productSize = rest.join(",").trim().replace(/^"|"$/g, "").trim().slice(0, productSizeMax);
    if (!SKU.test(sku)) return void skipped.push({ line: index + 1, reason: "invalid_sku" });
    if (seen.has(sku.toLowerCase())) return void skipped.push({ line: index + 1, reason: "duplicate" });
    if (rows.length >= IMAGE_BATCH_MAX_ROWS) return void (truncated = true);
    seen.add(sku.toLowerCase());
    rows.push({ sku, productSize });
  });
  return { rows, skipped, truncated };
}

export type AplusRowProblem = { row: number; reason: "duplicate" | "invalid_sku" | "missing_features" | "too_long" };
export type ParsedAplusRows = { rows: ImageBatchRow[]; skipped: AplusRowProblem[]; truncated: boolean };

const normal = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * A+ CSV with a header row: `sku, title, subtitle, feature_1, feature_1_text, … feature_4, feature_4_text`
 * (`feature_N_title` / `feature_N_description` also accepted). Each product needs 2 to 4 features.
 */
export function parseAplusRows(text: string): ParsedAplusRows {
  const [header, ...body] = parseCsv(text);
  const rows: ImageBatchRow[] = [];
  const skipped: AplusRowProblem[] = [];
  let truncated = false;
  if (!header) return { rows, skipped, truncated };
  const cols = header.map(normal);
  const at = (names: string[]) => cols.findIndex((c) => names.includes(c));
  const sku = at(["sku"]);
  const title = at(["title", "headline"]);
  const subtitle = at(["subtitle", "tagline"]);
  const features = Array.from({ length: FEATURE_RANGE.max }, (_, i) => ({
    title: at([`feature_${i + 1}`, `feature_${i + 1}_title`]),
    text: at([`feature_${i + 1}_text`, `feature_${i + 1}_description`]),
  }));
  if (sku < 0) return { rows, skipped: body.map((_, i) => ({ row: i + 1, reason: "invalid_sku" as const })), truncated };
  const seen = new Set<string>();
  body.forEach((cells, index) => {
    const row = index + 1;
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const id = cell(sku);
    const data: AplusRowData = {
      title: cell(title),
      subtitle: cell(subtitle),
      features: features.map((f) => ({ title: cell(f.title), description: cell(f.text) })).filter((f) => f.title && f.description),
    };
    if (!SKU.test(id)) return void skipped.push({ row, reason: "invalid_sku" });
    if (seen.has(id.toLowerCase())) return void skipped.push({ row, reason: "duplicate" });
    if (data.features.length < FEATURE_RANGE.min) return void skipped.push({ row, reason: "missing_features" });
    const long =
      data.title.length > TEXT_LIMITS.title ||
      data.subtitle.length > TEXT_LIMITS.subtitle ||
      data.features.some((f) => f.title.length > TEXT_LIMITS.featureTitle || f.description.length > TEXT_LIMITS.featureDescription);
    if (long) return void skipped.push({ row, reason: "too_long" });
    if (rows.length >= IMAGE_BATCH_MAX_ROWS) return void (truncated = true);
    seen.add(id.toLowerCase());
    rows.push({ sku: id, productSize: "", data });
  });
  return { rows, skipped, truncated };
}
