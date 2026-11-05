import type { CopyLanguage, ProductCopy } from "@/lib/ai/types";
import type { ReviewStatus } from "@/lib/copy/review-status";

// Plain-text and CSV versions of a product's copy, for clipboard and download.

export function copyAsText(copy: ProductCopy) {
  return [copy.title, "", ...copy.bullets.map((b) => `• ${b}`), "", copy.description, "", `SEO title: ${copy.metaTitle}`, `SEO description: ${copy.metaDescription}`, `Tags: ${copy.tags.join(", ")}`].join("\n");
}

const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;

type Product = { sku: string; productName: string; copy: Partial<Record<CopyLanguage, ProductCopy>>; review: ReviewStatus };

/**
 * One row per product and language, bullets in their own columns; UTF-8 BOM so Excel shows Arabic
 * correctly. The approval status is the last column, so existing column positions don't move.
 */
export function copiesAsCsv(products: Product[]) {
  const all = products.flatMap((p) => Object.values(p.copy));
  const bulletCount = Math.max(5, ...all.map((c) => c?.bullets.length ?? 0));
  const header = ["sku", "product_name", "language", "title", ...Array.from({ length: bulletCount }, (_, i) => `bullet_${i + 1}`), "description", "meta_title", "meta_description", "tags", "approval_status"];
  const rows = products.flatMap(({ sku, productName, copy, review }) =>
    (Object.entries(copy) as [CopyLanguage, ProductCopy][]).map(([language, c]) => [
      sku,
      productName,
      language,
      c.title,
      ...Array.from({ length: bulletCount }, (_, i) => c.bullets[i] ?? ""),
      c.description,
      c.metaTitle,
      c.metaDescription,
      c.tags.join(", "),
      review,
    ]),
  );
  return "\uFEFF" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export const copyAsCsv = (product: Product) => copiesAsCsv([product]);

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
