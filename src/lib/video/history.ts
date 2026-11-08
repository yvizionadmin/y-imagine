import "server-only";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { insertGeneration } from "@/lib/generations";
import { deleteAsset } from "@/lib/storage/assets";
import type { VideoJob } from "./jobs";

// Finished Studio videos also live in History (mode "video", no SKU, never uploaded to a store),
// so they can be found, downloaded and deleted with everything else.

const SHORT_EDGE = { "360p": 360, "480p": 480, "720p": 720, "1080p": 1080 } as Record<string, number>;

/** Pixel size for a resolution and aspect ratio ("720p" 16:9 → 1280×720). */
export function videoSize(resolution: string, aspectRatio: string) {
  const short = SHORT_EDGE[resolution] ?? 720;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!(w > 0 && h > 0)) return { width: short, height: short };
  return w >= h ? { width: Math.round((short * w) / h), height: short } : { width: short, height: Math.round((short * h) / w) };
}

export async function saveVideoToHistory(job: VideoJob, video: { assetId: string; mimeType: string; provider: string; model: string }) {
  const { width, height } = videoSize(job.settings.resolution, job.settings.aspectRatio);
  return insertGeneration({
    orgId: job.orgId,
    mode: "video",
    sku: "",
    title: job.prompt.slice(0, 120),
    assetId: video.assetId,
    mimeType: video.mimeType,
    width,
    height,
    settings: {
      prompt: job.prompt.slice(0, 2000),
      aspectRatio: job.settings.aspectRatio,
      seconds: String(job.settings.seconds),
      resolution: job.settings.resolution,
      camera: job.settings.camera,
      motion: job.settings.motion,
      lens: job.settings.lens ?? "auto",
      lighting: job.settings.lighting ?? "auto",
    },
    provider: video.provider,
    model: video.model,
    createdBy: job.createdBy,
    createdById: job.createdById,
  });
}

/** Removes the Studio cards of videos deleted from History (their clip is gone), and their start frames. */
export async function forgetVideoJobs(orgId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  const removed = await db.forOrg(orgId).delete(schema.videoJobs, inArray(schema.videoJobs.assetId, assetIds));
  await Promise.all(removed.flatMap((j) => (j.startFrameAssetId && j.startFrameMime ? [deleteAsset(orgId, j.startFrameAssetId, j.startFrameMime)] : [])));
}
