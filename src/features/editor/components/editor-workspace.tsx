"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clapperboard, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { EDIT_NAME_MAX, MAX_CLIPS, MAX_EDIT_SECONDS, MIN_CLIP_SECONDS, timelineDuration, type EditTimeline } from "@/lib/editor/timeline";
import {
  createEditorProject,
  deleteEditorProject,
  exportEditorProject,
  generateEditorAudio,
  getEditorProject,
  getEditorSetup,
  listEditorProjects,
  listEditorSources,
  saveEditorProject,
  type AudioRequest,
} from "../actions";
import type { EditorError, EditorMediaView, EditorProject, EditorProjectSummary, EditorSetup, EditorSource } from "../types";
import { AddClipDialog, ClipList, type ClipPick } from "./clip-list";
import { EditorPreview, formatTime } from "./editor-preview";
import { ExportPanel, SoundPanel, SubtitlesPanel } from "./editor-panels";

const SAVE_DELAY_MS = 700;
const POLL_MS = 3000;

type SaveState = "saved" | "saving" | "error";

/** What is saved: subtitles still being typed (no text yet) are left out until they have some. */
function savable(timeline: EditTimeline): EditTimeline {
  return { ...timeline, subtitles: timeline.subtitles.filter((s) => s.text.trim() && s.end > s.start) };
}

function setProjectParam(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set("project", id);
  else params.delete("project");
  params.delete("clip");
  window.history.replaceState(null, "", params.size ? `?${params}` : window.location.pathname);
}

/**
 * Video editor (B10, no Figma frame; the settings-card style of the other non-dock pages): a project
 * cuts the org's Studio videos and uploaded clips together, with subtitles and a music or voice-over
 * track, previewed in the browser and exported as one MP4 by the worker. Changes save as you go.
 * `?project=` opens a project; `?clip=` (from a Studio video) starts a new one with that clip.
 */
export function EditorWorkspace() {
  const t = useTranslations("Editor");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [setup, setSetup] = useState<EditorSetup | null>(null);
  const [projects, setProjects] = useState<EditorProjectSummary[] | null>(null);
  const [project, setProject] = useState<EditorProject | null>(null);
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState<EditTimeline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<EditorSource[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<{ clip: number; nonce: number } | null>(null);
  const saveSeq = useRef(0);
  const started = useRef(false);

  const canEdit = !!setup?.canEdit && !!setup.allowed;

  const open = useCallback((next: EditorProject) => {
    setProject(next);
    setName(next.name);
    setTimeline(next.timeline);
    setDirty(false);
    setSaveState("saved");
    setPlayhead(0);
    setSeek(null);
    setProjectParam(next.id);
  }, []);

  const refreshList = useCallback(() => listEditorProjects().then(setProjects), []);

  // First load: the setup, the projects, then the project in the address (or a new one for ?clip=).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const wanted = searchParams.get("project");
    const clip = searchParams.get("clip");
    void (async () => {
      const [nextSetup, list] = await Promise.all([getEditorSetup(), listEditorProjects()]);
      setSetup(nextSetup);
      setProjects(list);
      if (clip && nextSetup.allowed && nextSetup.canEdit) {
        const created = await createEditorProject({ name: t("untitled"), clipAssetId: clip });
        if (created.ok) {
          open(created.project);
          void refreshList();
          return;
        }
        setError(created.error);
      }
      const id = wanted && list.some((p) => p.id === wanted) ? wanted : list[0]?.id;
      if (id) {
        const loaded = await getEditorProject(id);
        if (loaded) open(loaded);
      }
    })();
  }, [searchParams, open, refreshList, t]);

  // Save as you go: a moment after the last change. Only the latest save's answer counts.
  useEffect(() => {
    if (!dirty || !project || !timeline || !canEdit) return;
    const timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save reads the current state
  }, [dirty, name, timeline]);

  async function save() {
    if (!project || !timeline) return true;
    const seq = ++saveSeq.current;
    setSaveState("saving");
    const result = await saveEditorProject(project.id, { name: name.trim() || t("untitled"), timeline: savable(timeline) }).catch(() => ({ ok: false as const, error: "invalid_input" as EditorError }));
    if (seq !== saveSeq.current) return result.ok;
    if (result.ok) {
      setDirty(false);
      setSaveState("saved");
      setProject((current) => (current && current.id === result.project.id ? { ...current, name: result.project.name, updatedAt: result.project.updatedAt } : current));
      setProjects((list) => list?.map((p) => (p.id === project.id ? { ...p, name: result.project.name, clips: result.project.timeline.clips.length } : p)) ?? list);
    } else {
      setSaveState("error");
    }
    return result.ok;
  }

  // Follow an export until it is done.
  const rendering = project?.status === "pending" || project?.status === "running";
  useEffect(() => {
    if (!rendering || !project) return;
    const timer = setInterval(async () => {
      const next = await getEditorProject(project.id).catch(() => null);
      if (next && next.status !== "pending" && next.status !== "running") {
        setProject((current) => (current && current.id === next.id ? { ...current, status: next.status, error: next.error, output: next.output } : current));
        setProjects((list) => list?.map((p) => (p.id === next.id ? { ...p, status: next.status } : p)) ?? list);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [rendering, project]);

  function change(patch: Partial<EditTimeline>) {
    setTimeline((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  async function newProject() {
    setBusy(true);
    setError(null);
    const created = await createEditorProject({ name: t("untitled") });
    setBusy(false);
    if (!created.ok) return setError(created.error);
    open(created.project);
    void refreshList();
  }

  async function switchTo(id: string) {
    if (dirty) await save();
    const loaded = await getEditorProject(id);
    if (loaded) open(loaded);
  }

  async function remove() {
    if (!project || !window.confirm(t("deleteConfirm", { name: project.name }))) return;
    setBusy(true);
    const result = await deleteEditorProject(project.id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const list = await listEditorProjects();
    setProjects(list);
    const next = list[0] ? await getEditorProject(list[0].id) : null;
    if (next) open(next);
    else {
      setProject(null);
      setTimeline(null);
      setProjectParam(null);
    }
  }

  function openAdd() {
    setAdding(true);
    if (sources === null) void listEditorSources().then(setSources);
  }

  /** Adds a clip at the end, cut to what still fits in the longest export. */
  function addClip(pick: ClipPick, seconds: number | null) {
    if (!timeline) return;
    const room = MAX_EDIT_SECONDS - timelineDuration(timeline);
    if (timeline.clips.length >= MAX_CLIPS || room < MIN_CLIP_SECONDS) return setError("too_long");
    const end = Math.round(Math.min(seconds ?? pick.seconds ?? 5, room) * 10) / 10;
    change({ clips: [...timeline.clips, { id: crypto.randomUUID(), assetId: pick.assetId, name: pick.name.slice(0, 120), start: 0, end }] });
    setAdding(false);
  }

  async function upload(file: File, kind: "clip" | "audio", track: "music" | "voice" = "music") {
    if (!project) return false;
    setError(null);
    const form = new FormData();
    form.set("editId", project.id);
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch("/api/editor/uploads", { method: "POST", body: form }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { ok: boolean; error?: string; media?: EditorMediaView } | null;
    if (!body?.ok || !body.media) {
      setError(body?.error ?? "upload_failed");
      return false;
    }
    const media = body.media;
    setProject((current) => (current ? { ...current, media: [...current.media, media] } : current));
    if (kind === "clip") addClip({ assetId: media.assetId, name: media.name, seconds: media.seconds }, media.seconds);
    else putOnTrack(media, track);
    return true;
  }

  /** Puts a project sound on the music track (under the whole video) or as the voice-over (from the playhead). */
  function putOnTrack(media: EditorMediaView, track: "music" | "voice") {
    if (!timeline) return;
    if (track === "music") change({ audio: { assetId: media.assetId, name: media.name, volume: 0.5 } });
    else {
      const total = timelineDuration(timeline);
      change({ voice: { assetId: media.assetId, name: media.name, volume: 1, start: Math.round(Math.min(playhead, Math.max(0, total - 0.5)) * 10) / 10 } });
    }
  }

  /** Generates a voice-over or music track (one job, charged) and uses it right away. */
  async function generate(request: AudioRequest) {
    if (!project) return false;
    setError(null);
    const result = await generateEditorAudio(project.id, request);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    const media = result.media;
    setProject((current) => (current ? { ...current, media: [...current.media, media] } : current));
    putOnTrack(media, request.kind === "voice" ? "voice" : "music");
    router.refresh(); // the credit badge
    return true;
  }

  async function exportVideo() {
    if (!project) return;
    setExporting(true);
    setError(null);
    // The export renders what is saved, so save the latest changes first.
    if (dirty && !(await save())) {
      setExporting(false);
      return setError("save_failed");
    }
    const result = await exportEditorProject(project.id);
    setExporting(false);
    if (!result.ok) return setError(result.error);
    setProject((current) => (current ? { ...current, status: result.project.status, error: null } : current));
  }

  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of project?.media ?? []) map.set(m.assetId, m.url);
    return map;
  }, [project?.media]);
  const urlFor = useCallback((assetId: string) => urls.get(assetId) ?? `/api/assets/${assetId}`, [urls]);

  if (!setup || projects === null) {
    return <Loader2 className="mx-auto mt-24 size-6 animate-spin text-muted-foreground" aria-label={t("loading")} />;
  }

  return (
    // The app shell doesn't scroll; this page scrolls itself (like Analytics).
    <div className="w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            setup.allowed && (
              <div className="flex flex-wrap items-center gap-2">
                {projects.length > 0 && (
                  <select
                    aria-label={t("projects")}
                    value={project?.id ?? ""}
                    onChange={(e) => void switchTo(e.target.value)}
                    className="h-8 max-w-56 rounded-lg border bg-background px-2 text-xs"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {canEdit && (
                  <Button type="button" size="sm" onClick={() => void newProject()} disabled={busy}>
                    <Plus className="size-3.5" aria-hidden />
                    {t("newProject")}
                  </Button>
                )}
              </div>
            )
          }
        />

        {!setup.allowed ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-background px-6 py-12 text-center">
            <Lock className="size-6 text-muted-foreground" aria-hidden />
            <p className="max-w-md text-sm">{t("locked")}</p>
            <Link href="/settings/billing" className="text-sm font-medium text-primary hover:underline">
              {t("upgrade")}
            </Link>
          </div>
        ) : !project || !timeline ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-background px-6 py-12 text-center">
            <Clapperboard className="size-7 text-muted-foreground" aria-hidden />
            <p className="max-w-md text-sm text-muted-foreground">{canEdit ? t("empty") : t("emptyReadOnly")}</p>
            {canEdit && (
              <Button type="button" onClick={() => void newProject()} disabled={busy}>
                <Plus className="size-4" aria-hidden />
                {t("newProject")}
              </Button>
            )}
          </div>
        ) : (
          <>
            {!canEdit && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={t("name")}
                value={name}
                maxLength={EDIT_NAME_MAX}
                disabled={!canEdit}
                dir="auto"
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm font-medium sm:w-auto sm:max-w-sm sm:flex-1"
              />
              {canEdit && (
                <span role="status" className="text-[11px] text-muted-foreground">
                  {saveState === "saving" || dirty ? t("saving") : saveState === "error" ? t("saveError") : t("saved")}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                {formatTime(timelineDuration(timeline))} / {formatTime(MAX_EDIT_SECONDS)}
              </span>
              {canEdit && (
                <Button type="button" size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => void remove()} disabled={busy || rendering}>
                  <Trash2 className="size-3.5" aria-hidden />
                  {t("delete")}
                </Button>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
              </p>
            )}

            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                <EditorPreview
                  timeline={timeline}
                  urlFor={urlFor}
                  audioUrl={timeline.audio ? urlFor(timeline.audio.assetId) : null}
                  voiceUrl={timeline.voice ? urlFor(timeline.voice.assetId) : null}
                  seek={seek}
                  onTime={setPlayhead}
                />
                <ClipList
                  clips={timeline.clips}
                  urlFor={urlFor}
                  disabled={!canEdit}
                  onChange={(clips) => change({ clips })}
                  onSelect={(clip) => setSeek({ clip, nonce: Date.now() })}
                  onAdd={openAdd}
                />
              </div>
              <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
                <fieldset disabled={!canEdit} className="contents">
                  <SubtitlesPanel timeline={timeline} playhead={playhead} onChange={(subtitles) => change({ subtitles })} />
                  <SoundPanel
                    timeline={timeline}
                    audioMedia={project.media.filter((m) => m.kind === "audio")}
                    playhead={playhead}
                    problems={setup.audio}
                    onChange={change}
                    onUpload={(file, track) => upload(file, "audio", track)}
                    onGenerate={generate}
                  />
                </fieldset>
                <ExportPanel project={project} name={name} timeline={timeline} canEdit={canEdit} exporting={exporting} onChange={change} onExport={() => void exportVideo()} />
              </div>
            </div>

            <AddClipDialog
              open={adding}
              onOpenChange={setAdding}
              sources={sources}
              uploads={project.media.filter((m) => m.kind === "clip")}
              onPick={(pick) => addClip(pick, null)}
              onUpload={(file) => upload(file, "clip")}
            />
          </>
        )}
      </div>
    </div>
  );
}
