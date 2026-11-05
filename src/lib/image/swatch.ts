import "server-only";
import sharp from "sharp";
import type { ImageInput, SwatchAnalysis } from "@/lib/ai/types";

const toHex = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Dominant colour and finish of a swatch photo, measured directly (no model call, no credit).
 * Every provider uses this: a pixel measurement is more exact than a vision model's guess at a hex.
 */
export async function measureSwatch(swatch: ImageInput): Promise<SwatchAnalysis> {
  const flat = sharp(swatch.bytes).flatten({ background: "#ffffff" }).resize(64, 64, { fit: "cover" });
  const { dominant } = await sharp(swatch.bytes).resize(64, 64, { fit: "cover" }).stats();
  const grey = await flat.greyscale().stats();
  return {
    hex: `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`.toUpperCase(),
    finish: grey.channels[0].stdev > 18 ? "textured" : "matte",
  };
}
