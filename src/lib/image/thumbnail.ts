import sharp from "sharp";
import { THUMBNAIL_WIDTHS, type ThumbnailWidth } from "./thumbnail-url";

const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

/** The requested thumbnail width, or null when this asset should be served as it is (videos, unknown sizes). */
export function thumbnailWidth(requested: string | null, mimeType: string): ThumbnailWidth | null {
  const width = THUMBNAIL_WIDTHS.find((w) => String(w) === requested);
  return width && RESIZABLE.has(mimeType) ? width : null;
}

/** A WebP no wider than `width` that keeps transparency and never scales a small image up. */
export function makeThumbnail(bytes: Buffer | Uint8Array, width: ThumbnailWidth) {
  return sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
}
