import sharp from "sharp";
import {
  RESIZE_INPUT_TYPES,
  RESIZE_MAX_BYTES,
  RESIZE_QUALITY,
  isResizeFit,
  isResizeFormat,
  isResizeSide,
} from "@/features/resize/presets";
import { getWorkspace } from "@/lib/workspace";
import { reportError } from "@/lib/observability/report";

const FIT = { crop: "cover", pad: "contain", stretch: "fill" } as const;
const MIME = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png" } as const;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// Resizes one image per request and returns the bytes (binary, so no server-action body cap or
// base64 overhead). Runs inline locally; on Railway large batches move to the BullMQ worker.
export async function POST(request: Request) {
  const workspace = await getWorkspace();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const width = Number(form?.get("width"));
  const height = Number(form?.get("height"));
  const fit = String(form?.get("fit") ?? "");
  const format = String(form?.get("format") ?? "");
  const quality = Number(form?.get("quality") ?? RESIZE_QUALITY.default);

  if (!(file instanceof File) || file.size === 0) return new Response("invalid_input", { status: 400 });
  if (file.size > RESIZE_MAX_BYTES) return new Response("too_large", { status: 413 });
  if (
    !(RESIZE_INPUT_TYPES as readonly string[]).includes(file.type) ||
    !isResizeSide(width) ||
    !isResizeSide(height) ||
    !isResizeFit(fit) ||
    !isResizeFormat(format) ||
    !Number.isInteger(quality) ||
    quality < RESIZE_QUALITY.min ||
    quality > RESIZE_QUALITY.max
  ) {
    return new Response("invalid_input", { status: 400 });
  }

  const target = format === "original" ? (Object.keys(MIME) as (keyof typeof MIME)[]).find((k) => MIME[k] === file.type)! : format;

  try {
    // rotate() applies EXIF orientation, matching what the browser preview shows.
    let pipeline = sharp(new Uint8Array(await file.arrayBuffer()), { limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width, height, fit: FIT[fit], background: WHITE, position: "centre" });
    if (target === "jpeg") pipeline = pipeline.flatten({ background: WHITE }).jpeg({ quality, mozjpeg: true });
    else if (target === "webp") pipeline = pipeline.webp({ quality });
    else pipeline = pipeline.png({ compressionLevel: 8 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": MIME[target],
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-image-width": String(info.width),
        "x-image-height": String(info.height),
      },
    });
  } catch (error) {
    reportError("resize failed", error, { orgId: workspace.orgId, type: file.type, size: file.size });
    return new Response("unreadable", { status: 422 });
  }
}
