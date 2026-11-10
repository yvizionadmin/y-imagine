"use server";

import { planHasVideo } from "@/lib/credits";
import {
  countEdits,
  countOpenRenders,
  getEdit,
  insertEdit,
  listEdits,
  MAX_OPEN_RENDERS,
  queueRender,
  removeEdits,
  saveEdit,
  type VideoEdit,
} from "@/lib/editor/edits";
import { MAX_EDITS_PER_ORG } from "@/lib/editor/media";
import { dispatchEditRender } from "@/lib/editor/queue";
import { EDIT_NAME_MAX, EMPTY_TIMELINE, parseTimeline, type EditTimeline } from "@/lib/editor/timeline";
import { listRecentGenerations } from "@/lib/generations";
import { assetUrl, getAssetRecord, isAudioMime, isVideoMime } from "@/lib/storage/assets";
import { videoStorageFor } from "@/lib/video/storage";
import { getWorkspace, type Workspace } from "@/lib/workspace";
import type { EditorError, EditorProject, EditorProjectSummary, EditorSetup, EditorSource } from "./types";

// Video editor (B10): projects cut the org's videos together with subtitles and a music / voice-over
// track, and export one MP4 rendered by FFmpeg in the worker (src/lib/editor). Paid plans (same as
// Studio video); members edit, viewers look. Uploads go through /api/editor/uploads (larger bodies).
// Not an AI job: no credits, but uploads and exports count toward the plan's video storage.

const ID = /^[0-9a-f-]{36}$/;

const canEdit = (workspace: Workspace) => workspace.role !== "viewer" && !workspace.viewAs;

const cleanName = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, EDIT_NAME_MAX) : "");

function toProject(edit: VideoEdit): EditorProject {
  return {
    id: edit.id,
    name: edit.name,
    // Saved timelines are checked on the way in; a bad one opens empty rather than breaking the page.
    timeline: parseTimeline(edit.timeline) ?? EMPTY_TIMELINE,
    media: edit.media.map((m) => ({ ...m, url: assetUrl(m.assetId) })),
    status: edit.status,
    error: edit.error,
    output: edit.outputAssetId ? { url: assetUrl(edit.outputAssetId), seconds: edit.outputSeconds, renderedAt: edit.renderedAt } : null,
    updatedAt: edit.updatedAt,
  };
}

export async function getEditorSetup(): Promise<EditorSetup> {
  const workspace = await getWorkspace({ read: true });
  return { allowed: planHasVideo(workspace.plan), canEdit: canEdit(workspace), storage: await videoStorageFor(workspace.orgId, workspace.plan) };
}

export async function listEditorProjects(): Promise<EditorProjectSummary[]> {
  const workspace = await getWorkspace({ read: true });
  return (await listEdits(workspace.orgId)).map((e) => ({ id: e.id, name: e.name, status: e.status, clips: e.timeline.clips?.length ?? 0, updatedAt: e.updatedAt }));
}

export async function getEditorProject(id: string): Promise<EditorProject | null> {
  const workspace = await getWorkspace({ read: true });
  const edit = await getEdit(workspace.orgId, String(id));
  return edit ? toProject(edit) : null;
}

/** Finished Studio videos (History), newest first, to add as clips. */
export async function listEditorSources(): Promise<EditorSource[]> {
  const workspace = await getWorkspace({ read: true });
  const videos = await listRecentGenerations(workspace.orgId, "video", 60);
  return videos.map((g) => ({
    assetId: g.assetId,
    name: g.title,
    url: assetUrl(g.assetId),
    seconds: Number(g.settings.seconds) || null,
    createdAt: g.createdAt,
  }));
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: EditorError };

async function editorWorkspace(): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: EditorError }> {
  const workspace = await getWorkspace();
  if (!canEdit(workspace)) return { ok: false, error: "forbidden" };
  if (!planHasVideo(workspace.plan)) return { ok: false, error: "not_in_plan" };
  return { ok: true, workspace };
}

/** A new project, optionally starting with one Studio video (e.g. "Edit" on a Studio result). */
export async function createEditorProject(input: { name?: string; clipAssetId?: string | null }): Promise<Result<{ project: EditorProject }>> {
  const gate = await editorWorkspace();
  if (!gate.ok) return gate;
  const { workspace } = gate;
  if ((await countEdits(workspace.orgId)) >= MAX_EDITS_PER_ORG) return { ok: false, error: "too_many_projects" };
  const timeline: EditTimeline = { ...EMPTY_TIMELINE, clips: [] };
  const clipAssetId = typeof input?.clipAssetId === "string" ? input.clipAssetId : null;
  if (clipAssetId) {
    const source = (await listRecentGenerations(workspace.orgId, "video", 200)).find((g) => g.assetId === clipAssetId);
    if (!source) return { ok: false, error: "invalid_input" };
    const seconds = Number(source.settings.seconds) || 5;
    timeline.clips.push({ id: crypto.randomUUID(), assetId: source.assetId, name: source.title.slice(0, 120), start: 0, end: seconds });
    const ratio = source.settings.aspectRatio;
    if (ratio === "9:16" || ratio === "16:9" || ratio === "1:1") timeline.aspectRatio = ratio;
  }
  const edit = await insertEdit({
    orgId: workspace.orgId,
    name: cleanName(input?.name) || "Untitled video",
    timeline,
    createdBy: workspace.user.name,
    createdById: workspace.user.id,
  });
  return { ok: true, project: toProject(edit) };
}

/**
 * Checks that every file the timeline uses is this org's: clips are its Studio videos or this
 * project's uploaded clips, and the track is one of this project's uploaded sounds.
 */
async function mediaBelongs(orgId: string, edit: VideoEdit, timeline: EditTimeline) {
  const own = new Map(edit.media.map((m) => [m.assetId, m.kind]));
  for (const assetId of new Set(timeline.clips.map((c) => c.assetId))) {
    if (own.get(assetId) === "clip") continue;
    const record = await getAssetRecord(orgId, assetId);
    if (!record || record.kind !== "video" || !isVideoMime(record.mimeType)) return false;
  }
  if (timeline.audio) {
    if (own.get(timeline.audio.assetId) !== "audio") return false;
    const record = await getAssetRecord(orgId, timeline.audio.assetId);
    if (!record || !isAudioMime(record.mimeType)) return false;
  }
  return true;
}

export async function saveEditorProject(id: string, input: { name: string; timeline: unknown }): Promise<Result<{ project: EditorProject }>> {
  const gate = await editorWorkspace();
  if (!gate.ok) return gate;
  const { workspace } = gate;
  const edit = await getEdit(workspace.orgId, String(id));
  if (!edit) return { ok: false, error: "not_found" };
  const name = cleanName(input?.name);
  const timeline = parseTimeline(input?.timeline);
  if (!name || !timeline || !(await mediaBelongs(workspace.orgId, edit, timeline))) return { ok: false, error: "invalid_input" };
  const saved = await saveEdit(workspace.orgId, edit.id, { name, timeline });
  return saved ? { ok: true, project: toProject(saved) } : { ok: false, error: "not_found" };
}

export async function deleteEditorProject(id: string): Promise<Result<object>> {
  const gate = await editorWorkspace();
  if (!gate.ok) return gate;
  const edit = await getEdit(gate.workspace.orgId, String(id));
  if (!edit) return { ok: false, error: "not_found" };
  // A render in progress would write its file after the project is gone.
  if (edit.status === "pending" || edit.status === "running") return { ok: false, error: "busy" };
  await removeEdits(gate.workspace.orgId, [edit]);
  return { ok: true };
}

/** Queues an MP4 export of the saved timeline; the page polls the project until it is done. */
export async function exportEditorProject(id: string): Promise<Result<{ project: EditorProject }>> {
  const gate = await editorWorkspace();
  if (!gate.ok) return gate;
  const { workspace } = gate;
  if (!ID.test(String(id))) return { ok: false, error: "not_found" };
  const edit = await getEdit(workspace.orgId, String(id));
  if (!edit) return { ok: false, error: "not_found" };
  const timeline = parseTimeline(edit.timeline);
  if (!timeline?.clips.length) return { ok: false, error: "invalid_input" };
  if (edit.status === "pending" || edit.status === "running") return { ok: false, error: "busy" };
  if ((await videoStorageFor(workspace.orgId, workspace.plan)).full) return { ok: false, error: "storage_full" };
  if ((await countOpenRenders(workspace.orgId)) >= MAX_OPEN_RENDERS) return { ok: false, error: "too_many_renders" };
  const queued = await queueRender(workspace.orgId, edit.id);
  if (!queued) return { ok: false, error: "busy" };
  await dispatchEditRender(workspace.orgId, edit.id);
  return { ok: true, project: toProject(queued) };
}
