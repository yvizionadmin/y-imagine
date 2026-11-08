import { getImageProps } from "next/image";

/** The only widths served: a fixed list, so a request can't make the server render any size it likes. */
export const THUMBNAIL_WIDTHS = [96, 256, 640] as const;
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number];

/**
 * A small version of an image shown as a preview, for pages that would otherwise download every full-size PNG.
 * Stored assets are resized by /api/assets, public files by Next's image optimizer. Anything else, such as an image
 * on a merchant's store or a local preview, is returned as it is. Full-size views and downloads keep the plain URL.
 */
export function thumbnailUrl(url: string, width: ThumbnailWidth): string;
export function thumbnailUrl(url: string | null | undefined, width: ThumbnailWidth): string | undefined;
export function thumbnailUrl(url: string | null | undefined, width: ThumbnailWidth) {
  if (!url) return undefined;
  if (url.startsWith("/api/assets/")) return `${url}?w=${width}`;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  // The returned src is the 2x candidate, so ask for half.
  return getImageProps({ src: url, alt: "", width: width / 2, height: width / 2 }).props.src;
}
