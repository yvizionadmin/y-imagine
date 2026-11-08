import "server-only";
import { ProviderError } from "@/lib/ai/errors";
import { getVideoProvider } from "@/lib/ai/registry";
import type { CameraMove, LensPreset, LightingPreset, MotionLevel } from "@/lib/ai/types";
import { reportError } from "@/lib/observability/report";
import { readAsset, saveAsset } from "@/lib/storage/assets";
import { saveVideoToHistory } from "./history";
import { claimVideoJob, finishVideoJob } from "./jobs";

// Runs one Studio video job, from the worker (BullMQ) or in-process when there is no Redis. Only a
// `pending` job is claimed, so a retry or a second worker never runs it twice. The job's credits
// are reserved when the provider call starts and given back if it fails.

export type VideoJobOutcome = "done" | "failed" | "retry" | "skipped";

export async function runVideoJob(orgId: string, id: string): Promise<VideoJobOutcome> {
  const job = await claimVideoJob(orgId, id);
  if (!job) return "skipped";
  try {
    const startFrame =
      job.startFrameAssetId && job.startFrameMime
        ? { bytes: new Uint8Array(await readAsset(orgId, job.startFrameAssetId, job.startFrameMime)), mimeType: job.startFrameMime, name: "start-frame" }
        : null;
    const provider = await getVideoProvider({ orgId, user: { id: job.createdById, name: job.createdBy } }, job.credits);
    const video = await provider.generateVideo({
      prompt: job.prompt,
      aspectRatio: job.settings.aspectRatio,
      seconds: job.settings.seconds,
      resolution: job.settings.resolution,
      startFrame,
      camera: job.settings.camera as CameraMove,
      motion: job.settings.motion as MotionLevel,
      // Jobs queued before the cinema presets have neither.
      lens: (job.settings.lens ?? "auto") as LensPreset,
      lighting: (job.settings.lighting ?? "auto") as LightingPreset,
    });
    const assetId = await saveAsset(orgId, video.bytes, video.mimeType, "video");
    await finishVideoJob(orgId, id, { status: "ok", assetId, mimeType: video.mimeType, provider: video.provider, model: video.model });
    await saveVideoToHistory(job, { assetId, mimeType: video.mimeType, provider: video.provider, model: video.model });
    return "done";
  } catch (error) {
    // Rate limits pass: put the job back and let the queue try again later.
    if (error instanceof ProviderError && error.code === "rate_limited") {
      await finishVideoJob(orgId, id, { status: "pending" });
      return "retry";
    }
    if (!(error instanceof ProviderError)) reportError("video job crashed", error, { orgId, feature: "video" });
    await finishVideoJob(orgId, id, { status: "failed", error: error instanceof ProviderError ? error.code : "generation_failed" });
    return "failed";
  }
}
