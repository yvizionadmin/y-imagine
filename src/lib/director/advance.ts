import "server-only";
import { randomUUID } from "node:crypto";
import { ProviderError } from "@/lib/ai/errors";
import { getAudioProvider, getImageProvider, getTextProvider, videoModelFor, type JobActor } from "@/lib/ai/registry";
import { fitsCapabilities, videoCapabilities } from "@/lib/ai/video-models";
import { getBrandKit, isEmptyBrandKit } from "@/lib/brand/brand-kit";
import { videoCost } from "@/lib/credits";
import { getEdit, insertEdit, queueRender, saveEdit } from "@/lib/editor/edits";
import { dispatchEditRender } from "@/lib/editor/queue";
import { storeEditorMedia } from "@/lib/editor/store-media";
import { EMPTY_TIMELINE, type EditTimeline } from "@/lib/editor/timeline";
import { reportError } from "@/lib/observability/report";
import { getPlatformSettings } from "@/lib/platform/settings";
import { saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { countOpenVideoJobs, getVideoJobs, insertVideoJob, MAX_OPEN_VIDEO_JOBS } from "@/lib/video/jobs";
import { dispatchVideoJob } from "@/lib/video/queue";
import type { DirectorScene, DirectorStep } from "./limits";
import { getDirector, lockDirector, saveScenes, unlockDirector, updateDirector, type DirectorProject } from "./projects";

// Moves an AI Director project forward as far as it can go now, then stops: planning → storyboard →
// filming → assembling → done. Safe to call any number of times (from the queue, when a scene video
// finishes, when the final render finishes): one caller at a time holds the project's lock, each
// step only does what is missing, and waiting on video jobs or the render just returns. Every model
// call is a job of its own tool (script, image, video, voice), charged through the registry.

/** `busy`: another caller holds the project; `retry`: a rate limit, try again shortly. Both are called again. */
export type AdvanceOutcome = "done" | "waiting" | "failed" | "busy" | "retry" | "skipped";

class StepFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const actorOf = (p: DirectorProject): JobActor => ({ orgId: p.orgId, user: { id: p.createdById, name: p.createdBy } });

/** The finished video's editor project: scene clips back to back, narration as subtitles. */
function assemblyTimeline(p: DirectorProject): EditTimeline {
  const { settings } = p;
  return {
    ...EMPTY_TIMELINE,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    fit: "cover",
    clips: p.scenes.map((s, i) => ({ id: s.id, assetId: s.videoAssetId!, name: `Scene ${i + 1}`, start: 0, end: settings.seconds })),
    subtitles: settings.subtitles
      ? p.scenes.flatMap((s, i) => (s.narration ? [{ id: `sub-${s.id}`, start: i * settings.seconds, end: (i + 1) * settings.seconds - 0.1, text: s.narration.slice(0, 120) }] : []))
      : [],
    clipVolume: settings.voiceOver ? 0.3 : 1,
  };
}

async function plan(p: DirectorProject) {
  const brand = await getBrandKit(p.orgId);
  const provider = await getTextProvider(actorOf(p), "director");
  const { plan: script } = await provider.planVideo({
    idea: p.idea,
    scenes: p.settings.scenes,
    secondsPerScene: p.settings.seconds,
    aspectRatio: p.settings.aspectRatio,
    language: p.settings.language,
    brand: brand && !isEmptyBrandKit(brand) ? brand : null,
  });
  const scenes: DirectorScene[] = script.scenes.map((s) => ({ id: randomUUID(), ...s, imageAssetId: null, imageMime: null, videoJobId: null, videoAssetId: null, videoMime: null, error: null }));
  await updateDirector(p.orgId, p.id, { title: script.title, scenes, status: "storyboard" });
}

/** One storyboard image per scene (Studio text-to-image), saved as the scene video's first frame. */
async function storyboard(p: DirectorProject) {
  const scenes = [...p.scenes];
  for (const [i, scene] of scenes.entries()) {
    if (scene.imageAssetId) continue;
    const provider = await getImageProvider(actorOf(p), "create");
    const image = await provider.createImage({ prompt: scene.visual, aspectRatio: p.settings.aspectRatio, resolution: "HD", references: [] });
    const decoded = await decodeImage(image.url);
    if (!decoded) throw new StepFailure("generation_failed");
    const assetId = await saveAsset(p.orgId, decoded.bytes, decoded.mimeType, "video-frame");
    scenes[i] = { ...scene, imageAssetId: assetId, imageMime: decoded.mimeType, error: null };
    await saveScenes(p.orgId, p.id, scenes);
  }
  await updateDirector(p.orgId, p.id, { status: "filming" });
}

/**
 * Starts a Studio video job per scene (its storyboard image as the first frame), no more than the
 * org's open-job limit at a time, and collects the finished clips. Returns true when all are done.
 */
async function film(p: DirectorProject): Promise<boolean> {
  const scenes = [...p.scenes];
  const jobs = new Map((await getVideoJobs(p.orgId, scenes.flatMap((s) => (s.videoJobId ? [s.videoJobId] : [])))).map((j) => [j.id, j]));
  for (const [i, scene] of scenes.entries()) {
    const job = scene.videoJobId ? jobs.get(scene.videoJobId) : undefined;
    if (job?.status === "ok" && job.assetId) scenes[i] = { ...scene, videoAssetId: job.assetId, videoMime: job.mimeType };
    if (job?.status === "failed") {
      scenes[i] = { ...scene, error: job.error ?? "generation_failed" };
      await saveScenes(p.orgId, p.id, scenes);
      throw new StepFailure(job.error ?? "generation_failed");
    }
  }

  const waiting = scenes.filter((s) => !s.videoJobId);
  if (waiting.length) {
    const model = await videoModelFor(p.orgId);
    if (!model.ok) throw new StepFailure(model.code);
    const { settings } = p;
    const fits = fitsCapabilities(videoCapabilities(model.model), { aspectRatio: settings.aspectRatio, seconds: settings.seconds, resolution: settings.resolution, hasStartFrame: true });
    if (!fits) throw new StepFailure("unsupported");
    const credits = videoCost((await getPlatformSettings()).creditRules, { seconds: settings.seconds, resolution: settings.resolution });
    let open = await countOpenVideoJobs(p.orgId);
    for (const scene of waiting) {
      if (open >= MAX_OPEN_VIDEO_JOBS) break;
      const job = await insertVideoJob({
        orgId: p.orgId,
        prompt: scene.visual,
        settings: { aspectRatio: settings.aspectRatio, seconds: settings.seconds, resolution: settings.resolution, camera: scene.camera, motion: "medium", lens: "auto", lighting: "auto", directorId: p.id },
        startFrameAssetId: scene.imageAssetId,
        startFrameMime: scene.imageMime,
        // The first frame is the Director's own AI storyboard image, not an upload of a real person.
        consentedAt: null,
        credits,
        createdBy: p.createdBy,
        createdById: p.createdById,
      });
      const i = scenes.findIndex((s) => s.id === scene.id);
      scenes[i] = { ...scene, videoJobId: job.id, error: null };
      await saveScenes(p.orgId, p.id, scenes);
      await dispatchVideoJob(p.orgId, job.id);
      open += 1;
    }
  }
  await saveScenes(p.orgId, p.id, scenes);
  if (scenes.every((s) => s.videoAssetId)) {
    await updateDirector(p.orgId, p.id, { status: "assembling" });
    return true;
  }
  return false;
}

/** Builds the editor project, adds the voice-over, renders it. Returns true once the MP4 is ready. */
async function assemble(p: DirectorProject): Promise<boolean> {
  let edit = p.editId ? await getEdit(p.orgId, p.editId) : null;
  if (!edit) {
    edit = await insertEdit({ orgId: p.orgId, name: (p.title || p.idea).slice(0, 80), timeline: assemblyTimeline(p), createdBy: p.createdBy, createdById: p.createdById });
    await updateDirector(p.orgId, p.id, { editId: edit.id });
  }

  const narration = p.scenes.map((s) => s.narration).filter(Boolean).join(" ");
  if (p.settings.voiceOver && narration && !p.voiceAssetId) {
    const provider = await getAudioProvider(actorOf(p), "voice");
    const audio = await provider.speak({ text: narration.slice(0, 1000), voice: p.settings.voice, direction: "Clear, warm commercial voice-over, paced to the video." });
    const media = await storeEditorMedia(p.orgId, edit.id, { bytes: audio.bytes, mimeType: audio.mimeType, kind: "audio", name: (p.title || "Narration").slice(0, 48), source: "voice" });
    if (!media) throw new StepFailure("generation_failed");
    const timeline = { ...(edit.timeline as EditTimeline), voice: { assetId: media.assetId, name: media.name, volume: 1, start: 0 } };
    await saveEdit(p.orgId, edit.id, { name: edit.name, timeline });
    await updateDirector(p.orgId, p.id, { voiceAssetId: media.assetId });
    edit = (await getEdit(p.orgId, edit.id))!;
  }

  if (edit.status === "ok" && edit.outputAssetId) {
    await updateDirector(p.orgId, p.id, { status: "done" });
    return true;
  }
  if (edit.status === "failed") throw new StepFailure(edit.error ?? "render_failed");
  if (edit.status === "draft" && (await queueRender(p.orgId, edit.id))) await dispatchEditRender(p.orgId, edit.id);
  return false;
}

export async function advanceDirector(orgId: string, id: string): Promise<AdvanceOutcome> {
  if (!(await lockDirector(orgId, id))) return "busy";
  let step: DirectorStep | null = null;
  try {
    for (let guard = 0; guard < 6; guard++) {
      const p = await getDirector(orgId, id);
      if (!p || p.status === "failed") return "skipped";
      if (p.status === "done") return "done";
      step = p.status;
      if (p.status === "planning") await plan(p);
      else if (p.status === "storyboard") await storyboard(p);
      else if (p.status === "filming") {
        if (!(await film(p))) return "waiting";
      } else if (p.status === "assembling") {
        return (await assemble(p)) ? "done" : "waiting";
      }
    }
    return "waiting";
  } catch (error) {
    // Over the job rate limit: nothing is lost, the step runs again shortly.
    if (error instanceof ProviderError && error.code === "rate_limited") return "retry";
    const code = error instanceof StepFailure ? error.code : error instanceof ProviderError ? error.code : "generation_failed";
    if (!(error instanceof StepFailure) && !(error instanceof ProviderError)) reportError("director step failed", error, { orgId, feature: "director", step: step ?? "unknown" });
    await updateDirector(orgId, id, { status: "failed", failedStep: step, error: code });
    return "failed";
  } finally {
    await unlockDirector(orgId, id);
  }
}
