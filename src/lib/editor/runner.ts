import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reportError } from "@/lib/observability/report";
import { deleteAsset, getAssetRecord, isAudioMime, isVideoMime, readAsset, saveAsset } from "@/lib/storage/assets";
import { claimRender, finishRender } from "./edits";
import { FfmpegError, fontsDir, probeMedia, runFfmpeg } from "./ffmpeg";
import { buildAss, buildRenderArgs, type PlannedClip } from "./render-plan";
import { MIN_CLIP_SECONDS, parseTimeline } from "./timeline";

// Renders one editor export, from the worker (BullMQ) or in-process when there is no Redis. Only a
// `pending` project is claimed, so a retry or a second worker never renders it twice. The media is
// copied to a temp folder (ffmpeg reads files), rendered to one MP4 and saved as an asset; the
// folder is always removed. Not an AI job, so no credits.

export type RenderOutcome = "done" | "failed" | "skipped";
export type RenderError = "invalid_input" | "media_missing" | "render_unavailable" | "render_failed" | "timed_out";

const CLIP_KINDS = ["video", "editor-media"];

class RenderFailure extends Error {
  constructor(readonly code: RenderError) {
    super(code);
  }
}

export async function runEditRender(orgId: string, id: string): Promise<RenderOutcome> {
  const edit = await claimRender(orgId, id);
  if (!edit) return "skipped";
  const dir = await mkdtemp(path.join(tmpdir(), "imagine-edit-"));
  try {
    const timeline = parseTimeline(edit.timeline);
    if (!timeline?.clips.length) throw new RenderFailure("invalid_input");

    // One local copy per file, even when a clip is used twice.
    const files = new Map<string, { file: string; hasAudio: boolean; duration: number }>();
    const fetch = async (assetId: string, allowed: (mime: string, kind: string) => boolean) => {
      const known = files.get(assetId);
      if (known) return known;
      const record = await getAssetRecord(orgId, assetId);
      if (!record || !allowed(record.mimeType, record.kind)) throw new RenderFailure("media_missing");
      const file = path.join(dir, `${files.size}${path.extname(record.mimeType.replace("/", ".")) || ""}`);
      await writeFile(file, new Uint8Array(await readAsset(orgId, assetId, record.mimeType)));
      const probe = await probeMedia(file);
      if (!probe) throw new RenderFailure("media_missing");
      const entry = { file, hasAudio: probe.hasAudio, duration: probe.duration };
      files.set(assetId, entry);
      return entry;
    };

    const clips: PlannedClip[] = [];
    for (const clip of timeline.clips) {
      const media = await fetch(clip.assetId, (mime, kind) => isVideoMime(mime) && CLIP_KINDS.includes(kind));
      // The browser's idea of the length can be a little off; cut at the file's real end.
      const end = Math.min(clip.end, media.duration);
      if (end - clip.start < MIN_CLIP_SECONDS / 2) throw new RenderFailure("invalid_input");
      clips.push({ file: media.file, start: clip.start, end, hasAudio: media.hasAudio });
    }
    const track = timeline.audio ? await fetch(timeline.audio.assetId, (mime, kind) => isAudioMime(mime) && kind === "editor-media") : null;
    const audio = track && timeline.audio ? { file: track.file, volume: timeline.audio.volume, duration: track.duration } : null;
    const spoken = timeline.voice ? await fetch(timeline.voice.assetId, (mime, kind) => isAudioMime(mime) && kind === "editor-media") : null;
    const voice = spoken && timeline.voice ? { file: spoken.file, volume: timeline.voice.volume, start: timeline.voice.start } : null;

    // Subtitle times follow the clips as rendered (a cut end can shorten the video slightly).
    const ass = buildAss({ ...timeline, clips });
    const subtitlesFile = ass ? path.join(dir, "subtitles.ass") : null;
    if (ass && subtitlesFile) await writeFile(subtitlesFile, ass, "utf8");

    const output = path.join(dir, "export.mp4");
    await runFfmpeg(buildRenderArgs({ timeline, clips, audio, voice, subtitlesFile, fontsDir: fontsDir(), output }), { timeoutMs: 10 * 60_000 });
    const bytes = new Uint8Array(await readFile(output));
    const assetId = await saveAsset(orgId, bytes, "video/mp4", "edit-render");
    const seconds = clips.reduce((sum, c) => sum + (c.end - c.start), 0);
    const saved = await finishRender(orgId, id, { status: "ok", outputAssetId: assetId, outputMime: "video/mp4", outputSeconds: Math.round(seconds * 100) / 100 });
    if (!saved) {
      // The stale sweep closed this render meanwhile: keep the project as it is, drop the file.
      await deleteAsset(orgId, assetId, "video/mp4");
      return "failed";
    }
    // The previous export is replaced.
    if (edit.outputAssetId && edit.outputMime) await deleteAsset(orgId, edit.outputAssetId, edit.outputMime).catch(() => undefined);
    return "done";
  } catch (error) {
    const code: RenderError =
      error instanceof RenderFailure
        ? error.code
        : error instanceof FfmpegError
          ? error.code === "not_installed"
            ? "render_unavailable"
            : error.code === "timed_out"
              ? "timed_out"
              : "render_failed"
          : "render_failed";
    if (!(error instanceof RenderFailure)) reportError("video edit render failed", error, { orgId, feature: "video-editor" });
    await finishRender(orgId, id, { status: "failed", error: code });
    return "failed";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
