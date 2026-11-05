import { getAsset } from "@/lib/storage/assets";
import { getWorkspace } from "@/lib/workspace";

// Serves an image only to members of the org that owns it.
export async function GET(_request: Request, { params }: RouteContext<"/api/assets/[id]">) {
  const { id } = await params;
  const workspace = await getWorkspace();
  const asset = await getAsset(workspace.orgId, id);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "content-type": asset.mimeType,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
