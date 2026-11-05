import "server-only";
import sharp from "sharp";
import type { LookRequest } from "@/lib/ai/types";
import { cutOutProduct } from "./cutout";

/** Places each cut-out product where the merchant arranged it on the room backdrop (PNG). */
export async function composeLook(request: Pick<LookRequest, "background" | "items" | "width" | "height">) {
  const { width, height } = request;
  const layers = [];
  for (const item of request.items) {
    const product = await cutOutProduct(item.image.bytes, Math.max(1, Math.round(item.w * width)), Math.max(1, Math.round(item.h * height)));
    const boxW = item.w * width;
    const boxH = item.h * height;
    layers.push({
      input: product.buffer,
      left: Math.round(item.x * width + (boxW - product.width) / 2),
      top: Math.round(item.y * height + (boxH - product.height)),
    });
  }
  return sharp(request.background.bytes)
    .resize(width, height, { fit: "cover" })
    .composite(layers.filter((l) => l.left > -width && l.top > -height))
    .png()
    .toBuffer();
}
