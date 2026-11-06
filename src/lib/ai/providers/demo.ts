import "server-only";
import path from "node:path";
import sharp from "sharp";
import { ProviderError } from "../errors";
import type { ImageProvider } from "../types";
import { composeLook } from "@/lib/image/compose-look";
import { measureSwatch } from "@/lib/image/swatch";
import { composeAplus } from "@/lib/image/compose-aplus";
import { findScene } from "@/lib/catalog-presets";

// Local-only provider so every flow can be exercised without API keys.
// Include "FAIL" in the SKU to exercise the failure state.
const LATENCY_MS = 2500;
const MAX_EDGE = { HD: 1200, "2K": 2048 } as const;

const sceneResults: Record<string, { url: string; width: number; height: number }> = {
  livingRoom: { url: "/demo/lifestyle-living-room.png", width: 1184, height: 864 },
  minimalistStudio: { url: "/scenes/minimalist-studio.png", width: 1344, height: 768 },
  luxuryLoft: { url: "/scenes/luxury-loft.png", width: 1344, height: 768 },
};

/** Other library scenes: the demo returns the scene's own photo. */
async function presetScene(scene: string) {
  const image = findScene(scene)?.image;
  if (!image) return null;
  const { width = 0, height = 0 } = await sharp(path.join(process.cwd(), "public", image)).metadata();
  return { url: image, width, height };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function failIfRequested(sku: string) {
  if (sku.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
}

export const demoProvider: ImageProvider = {
  id: "demo",

  // A library photo cropped to the requested shape. Include "FAIL" in the prompt for the failure state.
  async createImage(request) {
    await wait(LATENCY_MS);
    failIfRequested(request.prompt);
    const [w, h] = request.aspectRatio.split(":").map(Number);
    const edge = MAX_EDGE[request.resolution];
    const [width, height] = w >= h ? [edge, Math.round((edge * h) / w)] : [Math.round((edge * w) / h), edge];
    const data = await sharp(path.join(process.cwd(), "public", "scenes/minimalist-studio.png")).resize(width, height, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
    return { url: `data:image/webp;base64,${data.toString("base64")}`, width, height, provider: "demo", model: "demo-create-v1" };
  },

  async generateLifestyle(request) {
    await wait(LATENCY_MS);
    failIfRequested(request.sku);
    if (request.sceneUpload) {
      // The merchant's own background: paste the product cut-out onto it, bottom centre.
      const meta = await sharp(request.sceneUpload.bytes).metadata();
      const scale = Math.min(1, MAX_EDGE[request.resolution] / Math.max(meta.width ?? 1200, meta.height ?? 800));
      const [width, height] = [Math.round((meta.width ?? 1200) * scale), Math.round((meta.height ?? 800) * scale)];
      const draft = await composeLook({ background: request.sceneUpload, items: [{ image: request.product, x: 0.3, y: 0.4, w: 0.4, h: 0.5 }], width, height });
      const data = await sharp(draft).webp({ quality: 85 }).toBuffer();
      return { url: `data:image/webp;base64,${data.toString("base64")}`, width, height, provider: "demo", model: "demo-lifestyle-v1" };
    }
    const result = request.scene ? (sceneResults[request.scene] ?? (await presetScene(request.scene))) : null;
    return { ...(result ?? sceneResults.livingRoom), provider: "demo", model: "demo-lifestyle-v1" };
  },

  analyzeSwatch: measureSwatch,

  // Luminance-preserving tint of the uploaded product: a believable stand-in for a recolor model.
  async recolor(request) {
    await wait(LATENCY_MS);
    failIfRequested(request.sku);
    const edge = MAX_EDGE[request.resolution];
    const { data, info } = await sharp(request.product.bytes)
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .tint(request.hex)
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return {
      image: {
        url: `data:image/webp;base64,${data.toString("base64")}`,
        width: info.width,
        height: info.height,
        provider: "demo",
        model: "demo-recolor-v1",
      },
      preserved: ["shape", "stitching", "lighting", "texture"],
    };
  },

  async generateAplus(request) {
    await wait(LATENCY_MS);
    failIfRequested(request.sku);
    return { ...(await composeAplus(request)), provider: "demo", model: "demo-aplus-v1" };
  },

  async generateLook(request) {
    await wait(LATENCY_MS);
    const data = await sharp(await composeLook(request)).webp({ quality: 88 }).toBuffer();
    return { url: `data:image/webp;base64,${data.toString("base64")}`, width: request.width, height: request.height, provider: "demo", model: "demo-looks-v1" };
  },
};
