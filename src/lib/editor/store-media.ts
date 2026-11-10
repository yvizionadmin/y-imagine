import "server-only";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveAsset } from "@/lib/storage/assets";
import { addEditMedia } from "./edits";
import { probeMedia } from "./ffmpeg";
import type { EditorMedia } from "./media";

/**
 * Opens a file with ffmpeg and, when it is real video (with a picture) or audio (with sound), saves it
 * as one of the project's files (asset kind editor-media). Returns null for anything else. Used by
 * uploads and by generated voice-overs and music. An FfmpegError (ffmpeg missing) is thrown.
 */
export async function storeEditorMedia(
  orgId: string,
  editId: string,
  input: { bytes: Uint8Array; mimeType: string; kind: EditorMedia["kind"]; name: string; source?: EditorMedia["source"] },
): Promise<EditorMedia | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "imagine-media-"));
  try {
    const local = path.join(dir, "media");
    await writeFile(local, input.bytes);
    const probe = await probeMedia(local);
    const usable = probe && probe.duration > 0 && (input.kind === "clip" ? probe.hasVideo : probe.hasAudio);
    if (!usable) return null;
    const assetId = await saveAsset(orgId, input.bytes, input.mimeType, "editor-media");
    const media: EditorMedia = {
      assetId,
      kind: input.kind,
      mimeType: input.mimeType,
      name: input.name.slice(0, 120),
      byteSize: input.bytes.byteLength,
      seconds: Math.round(probe.duration * 100) / 100,
      createdAt: new Date().toISOString(),
      ...(input.source ? { source: input.source } : {}),
    };
    await addEditMedia(orgId, editId, media);
    return media;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
