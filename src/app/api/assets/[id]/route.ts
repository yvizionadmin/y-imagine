import { makeThumbnail, thumbnailWidth } from "@/lib/image/thumbnail";
import { reportError } from "@/lib/observability/report";
import { getAsset } from "@/lib/storage/assets";
import { parseRange } from "@/lib/storage/range";
import { getWorkspace } from "@/lib/workspace";

// Serves an asset (image or Studio video) only to members of the org that owns it. Byte ranges are
// supported so browsers can play and seek videos (Safari requires them).
export async function GET(request: Request, { params }: RouteContext<"/api/assets/[id]">) {
  const { id } = await params;
  const workspace = await getWorkspace();
  const asset = await getAsset(workspace.orgId, id);
  if (!asset) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(asset.bytes);
  const headers: Record<string, string> = {
    "content-type": asset.mimeType,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };

  // `?w=` serves a small preview. If it can't be made, the original still shows.
  const width = thumbnailWidth(new URL(request.url).searchParams.get("w"), asset.mimeType);
  if (width) {
    try {
      const thumbnail = new Uint8Array(await makeThumbnail(asset.bytes, width));
      return new Response(thumbnail, { headers: { ...headers, "accept-ranges": "none", "content-type": "image/webp", "content-length": String(thumbnail.length) } });
    } catch (error) {
      reportError("asset thumbnail failed", error, { orgId: workspace.orgId, assetId: id });
    }
  }

  const range = parseRange(request.headers.get("range"), bytes.length);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
  if (range) {
    const [start, end] = range;
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(bytes, { headers: { ...headers, "content-length": String(bytes.length) } });
}
