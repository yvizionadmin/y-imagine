"use server";

import type { ProviderErrorCode } from "@/lib/ai/errors";
import { audioProviderProblem, textProviderProblem, videoModelFor } from "@/lib/ai/registry";
import { videoCapabilities, videoModelName } from "@/lib/ai/video-models";
import { planAllows, planHasVideo } from "@/lib/credits";
import { getCharacter, listCharacters } from "@/lib/characters/characters";
import { getEdit, queueRender } from "@/lib/editor/edits";
import { dispatchEditRender } from "@/lib/editor/queue";
import {
  DIRECTOR_IDEA_MAX,
  directorEstimate,
  directorOptions,
  directorSettingsSchema,
  MAX_DIRECTORS_PER_ORG,
  type DirectorScene,
  type DirectorSettings,
  type DirectorSummary,
  type DirectorView,
} from "@/lib/director/limits";
import { countDirectors, deleteDirector, getDirector, insertDirector, listDirectors, resumeDirector, type DirectorProject } from "@/lib/director/projects";
import { dispatchDirector } from "@/lib/director/queue";
import { getPlatformSettings } from "@/lib/platform/settings";
import { assetUrl, deleteAsset } from "@/lib/storage/assets";
import { getVideoJobs } from "@/lib/video/jobs";
import { videoStorageFor } from "@/lib/video/storage";
import { getWorkspace, type Workspace } from "@/lib/workspace";

// AI Director (B11): one idea becomes a finished multi-scene video. The work runs in the background
// (src/lib/director/advance.ts); these start, read, retry and delete projects. Paid plans, like
// the video editor it builds on; members create, viewers and a read-only org view look.

export type DirectorError = ProviderErrorCode | "forbidden" | "invalid_input" | "not_found" | "not_enough_credits" | "storage_full" | "too_many_projects" | "busy";

const canEdit = (workspace: Workspace) => workspace.role !== "viewer" && !workspace.viewAs;
const WORKING = ["planning", "storyboard", "filming", "assembling"];

export type DirectorSetup = {
  allowed: boolean;
  canEdit: boolean;
  /** Why a project can't start now (no video or writing model, switched off…), or null. */
  problem: ProviderErrorCode | null;
  /** Why a voice-over can't be made (the rest still works without one), or null. */
  voiceProblem: ProviderErrorCode | null;
  model: string | null;
  options: ReturnType<typeof directorOptions> | null;
  /** What each part costs, for the estimate shown before starting. */
  pricing: { director: number; create: number; voice: number; video: { base: number; perSecond: number; resolution: Record<string, number> } };
  creditsRemaining: number;
  /** The team's saved characters, to feature one in every scene. */
  characters: { id: string; name: string; imageUrl: string | null }[];
};

export async function getDirectorSetup(): Promise<DirectorSetup> {
  const workspace = await getWorkspace({ read: true });
  const { creditRules, disabledFeatures } = await getPlatformSettings();
  const allowed = planHasVideo(workspace.plan) && planAllows(creditRules, workspace.plan, "director");
  const [video, writer, voice, characters] = await Promise.all([
    videoModelFor(workspace.orgId),
    textProviderProblem(workspace.orgId, "director"),
    audioProviderProblem(workspace.orgId, "voice"),
    listCharacters(workspace.orgId),
  ]);
  const off = (["director", "video", "create"] as const).find((f) => disabledFeatures.includes(f));
  const problem: ProviderErrorCode | null = off ? "feature_disabled" : !video.ok ? video.code : writer;
  return {
    allowed,
    canEdit: canEdit(workspace),
    problem,
    voiceProblem: disabledFeatures.includes("voice") ? "feature_disabled" : !planAllows(creditRules, workspace.plan, "voice") ? "not_in_plan" : voice,
    model: video.ok ? videoModelName(video.model) : null,
    options: video.ok ? directorOptions(videoCapabilities(video.model)) : null,
    pricing: { director: creditRules.featureCosts.director, create: creditRules.featureCosts.create, voice: creditRules.featureCosts.voice, video: creditRules.video },
    creditsRemaining: workspace.creditsRemaining,
    characters: characters.map((c) => ({ id: c.id, name: c.name, imageUrl: c.images[0] ? assetUrl(c.images[0].assetId) : null })),
  };
}

async function toView(p: DirectorProject): Promise<DirectorView> {
  const jobs = new Map((await getVideoJobs(p.orgId, p.scenes.flatMap((s) => (s.videoJobId ? [s.videoJobId] : [])))).map((j) => [j.id, j.status]));
  const edit = p.editId ? await getEdit(p.orgId, p.editId) : null;
  return {
    id: p.id,
    idea: p.idea,
    title: p.title,
    settings: p.settings,
    status: p.status,
    failedStep: p.failedStep ?? null,
    error: p.error ?? null,
    scenes: p.scenes.map((s) => ({
      ...s,
      imageUrl: s.imageAssetId ? assetUrl(s.imageAssetId) : null,
      videoUrl: s.videoAssetId ? assetUrl(s.videoAssetId) : null,
      videoStatus: s.videoAssetId ? "ok" : s.videoJobId ? (jobs.get(s.videoJobId) ?? "pending") : "waiting",
    })),
    editId: p.editId ?? null,
    output: edit?.status === "ok" && edit.outputAssetId ? { url: assetUrl(edit.outputAssetId), seconds: edit.outputSeconds } : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function listDirectorProjects(): Promise<DirectorSummary[]> {
  const workspace = await getWorkspace({ read: true });
  return (await listDirectors(workspace.orgId)).map((p) => ({ id: p.id, title: p.title, idea: p.idea, status: p.status, updatedAt: p.updatedAt }));
}

export async function getDirectorProject(id: string): Promise<DirectorView | null> {
  const workspace = await getWorkspace({ read: true });
  const project = await getDirector(workspace.orgId, String(id));
  return project ? toView(project) : null;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: DirectorError };

async function directorWorkspace(): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: DirectorError }> {
  const workspace = await getWorkspace();
  if (!canEdit(workspace)) return { ok: false, error: "forbidden" };
  if (!planHasVideo(workspace.plan)) return { ok: false, error: "not_in_plan" };
  return { ok: true, workspace };
}

/**
 * Starts a project: checks the idea and settings against the org's video model, the credits the
 * whole video will use, storage and the project limit, then queues the first step.
 */
export async function createDirectorProject(input: { idea: string; settings: DirectorSettings; characterId?: string | null }): Promise<Result<{ project: DirectorView }>> {
  const gate = await directorWorkspace();
  if (!gate.ok) return gate;
  const { workspace } = gate;
  const idea = typeof input?.idea === "string" ? input.idea.trim() : "";
  const parsed = directorSettingsSchema.safeParse(input?.settings);
  if (!idea || idea.length > DIRECTOR_IDEA_MAX || !parsed.success) return { ok: false, error: "invalid_input" };
  // The character is kept on the project as it is now (name and look), so later edits don't change a video in progress.
  const characterId = typeof input?.characterId === "string" && input.characterId ? input.characterId : null;
  const character = characterId ? await getCharacter(workspace.orgId, characterId) : null;
  if (characterId && !character) return { ok: false, error: "invalid_input" };
  const settings: DirectorSettings = { ...parsed.data, character: character ? { id: character.id, name: character.name, description: character.description } : null };

  const setup = await getDirectorSetup();
  if (!setup.allowed) return { ok: false, error: "not_in_plan" };
  if (setup.problem) return { ok: false, error: setup.problem };
  if (settings.voiceOver && setup.voiceProblem) return { ok: false, error: setup.voiceProblem };
  const options = setup.options!;
  const fits =
    options.startFrame &&
    (options.aspectRatios as readonly string[]).includes(settings.aspectRatio) &&
    options.durations.includes(settings.seconds) &&
    (options.resolutions as readonly string[]).includes(settings.resolution);
  if (!fits) return { ok: false, error: "invalid_input" };

  const { creditRules } = await getPlatformSettings();
  if (directorEstimate(creditRules, settings).total > workspace.creditsRemaining) return { ok: false, error: "not_enough_credits" };
  if ((await videoStorageFor(workspace.orgId, workspace.plan)).full) return { ok: false, error: "storage_full" };
  if ((await countDirectors(workspace.orgId)) >= MAX_DIRECTORS_PER_ORG) return { ok: false, error: "too_many_projects" };

  const project = await insertDirector({ orgId: workspace.orgId, idea, settings, createdBy: workspace.user.name, createdById: workspace.user.id });
  await dispatchDirector(workspace.orgId, project.id);
  return { ok: true, project: await toView(project) };
}

/** A failed project goes again from the step it stopped in; the scenes that failed start over. */
export async function retryDirectorProject(id: string): Promise<Result<{ project: DirectorView }>> {
  const gate = await directorWorkspace();
  if (!gate.ok) return gate;
  const { orgId } = gate.workspace;
  const project = await getDirector(orgId, String(id));
  if (!project) return { ok: false, error: "not_found" };
  if (project.status !== "failed") return { ok: false, error: "busy" };
  const step = project.failedStep ?? "planning";
  const scenes: DirectorScene[] = project.scenes.map((s) => (s.error && !s.videoAssetId ? { ...s, videoJobId: null, error: null } : s));
  // A failed final render is queued again.
  if (step === "assembling" && project.editId) {
    const edit = await getEdit(orgId, project.editId);
    if (edit?.status === "failed" && (await queueRender(orgId, edit.id))) await dispatchEditRender(orgId, edit.id);
  }
  const resumed = await resumeDirector(orgId, project.id, step, scenes);
  if (!resumed) return { ok: false, error: "busy" };
  await dispatchDirector(orgId, project.id);
  return { ok: true, project: await toView(resumed) };
}

/** Deletes a project and its storyboard images. Its scene videos stay in History and its video in the editor. */
export async function deleteDirectorProject(id: string): Promise<Result<object>> {
  const gate = await directorWorkspace();
  if (!gate.ok) return gate;
  const { orgId } = gate.workspace;
  const project = await getDirector(orgId, String(id));
  if (!project) return { ok: false, error: "not_found" };
  if (WORKING.includes(project.status)) return { ok: false, error: "busy" };
  await deleteDirector(orgId, project.id);
  for (const scene of project.scenes) {
    if (scene.imageAssetId && scene.imageMime) await deleteAsset(orgId, scene.imageAssetId, scene.imageMime).catch(() => undefined);
  }
  return { ok: true };
}
