import { planHasVideo } from "@/lib/credits";
import { getEdit } from "@/lib/editor/edits";
import { FfmpegError } from "@/lib/editor/ffmpeg";
import { MAX_MEDIA_PER_EDIT } from "@/lib/editor/media";
import { storeEditorMedia } from "@/lib/editor/store-media";
import { canonicalAudioType, EDITOR_AUDIO_MAX_BYTES, EDITOR_AUDIO_TYPES, EDITOR_CLIP_MAX_BYTES, EDITOR_CLIP_TYPES } from "@/lib/editor/timeline";
import { reportError } from "@/lib/observability/report";
import { hit, LIMITS } from "@/lib/rate-limit";
import { assetUrl } from "@/lib/storage/assets";
import { videoStorageFor } from "@/lib/video/storage";
import { getWorkspace } from "@/lib/workspace";

// Uploads a clip or a music / voice-over track into a video editor project. A route (not a Server
// Action) because clips are larger than the action body limit. Each file is opened with ffmpeg first,
// so only real video (with a picture) or audio is stored; it then belongs to the project.

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer" || workspace.viewAs) return json({ ok: false, error: "forbidden" }, 403);
  if (!planHasVideo(workspace.plan)) return json({ ok: false, error: "not_in_plan" }, 403);
  if (!(await hit("editor-upload", workspace.user.id, LIMITS.editorUploadsPerUser)).ok) return json({ ok: false, error: "rate_limited" }, 429);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  const edit = await getEdit(workspace.orgId, String(form?.get("editId") ?? ""));
  if (!edit) return json({ ok: false, error: "not_found" }, 404);
  if (!(file instanceof File) || file.size === 0 || (kind !== "clip" && kind !== "audio")) return json({ ok: false, error: "invalid_input" }, 400);

  const mimeType = kind === "audio" ? canonicalAudioType(file.type) : file.type;
  const types: readonly string[] = kind === "audio" ? EDITOR_AUDIO_TYPES : EDITOR_CLIP_TYPES;
  const max = kind === "audio" ? EDITOR_AUDIO_MAX_BYTES : EDITOR_CLIP_MAX_BYTES;
  if (!types.includes(mimeType)) return json({ ok: false, error: "invalid_input" }, 400);
  if (file.size > max) return json({ ok: false, error: "too_large" }, 413);
  if (edit.media.length >= MAX_MEDIA_PER_EDIT) return json({ ok: false, error: "too_many_files" }, 400);
  const storage = await videoStorageFor(workspace.orgId, workspace.plan);
  if (storage.used + file.size > storage.limit) return json({ ok: false, error: "storage_full" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const media = await storeEditorMedia(workspace.orgId, edit.id, { bytes, mimeType, kind, name: file.name });
    if (!media) return json({ ok: false, error: "invalid_input" }, 400);
    return json({ ok: true, media: { ...media, url: assetUrl(media.assetId) } });
  } catch (error) {
    if (error instanceof FfmpegError && error.code === "not_installed") {
      reportError("editor upload: ffmpeg missing", error, { orgId: workspace.orgId });
      return json({ ok: false, error: "unavailable" }, 503);
    }
    reportError("editor upload failed", error, { orgId: workspace.orgId });
    return json({ ok: false, error: "invalid_input" }, 400);
  }
}
