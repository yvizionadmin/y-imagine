"use client";

import { useRef, useState, type ReactNode } from "react";
import { Captions, Download, Loader2, Mic, Music, Plus, Sparkles, Trash2, Upload, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { blockedReason } from "@/components/app/job-errors";
import { useJobCost } from "@/features/credits/use-job-cost";
import { VOICE_STYLES, type VoiceStyle } from "@/lib/ai/types";
import {
  EDIT_ASPECT_RATIOS,
  EDIT_FITS,
  EDIT_RESOLUTIONS,
  EDITOR_AUDIO_TYPES,
  MAX_SUBTITLES,
  MUSIC_PROMPT_MAX,
  SUBTITLE_TEXT_MAX,
  VOICE_DIRECTION_MAX,
  VOICE_SCRIPT_MAX,
  timelineDuration,
  type EditSubtitle,
  type EditTimeline,
} from "@/lib/editor/timeline";
import type { AudioRequest } from "../actions";
import type { EditorMediaView, EditorProject } from "../types";

function Panel({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-2xl border bg-background p-4">
      <h2 id={id} className="flex items-center gap-2 text-sm font-bold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Choice<T extends string>({ label, value, options, labelFor, onChange }: { label: string; value: T; options: readonly T[]; labelFor: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              value === option ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background text-foreground hover:bg-muted",
            )}
          >
            {labelFor(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Subtitles on the finished video's timeline (seconds from its start). */
export function SubtitlesPanel({ timeline, playhead, onChange }: { timeline: EditTimeline; playhead: number; onChange: (subtitles: EditSubtitle[]) => void }) {
  const t = useTranslations("Editor");
  const total = timelineDuration(timeline);
  const subtitles = timeline.subtitles;
  const update = (id: string, patch: Partial<EditSubtitle>) => onChange(subtitles.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  function add() {
    const start = round(Math.min(playhead, Math.max(0, total - 0.5)));
    onChange([...subtitles, { id: crypto.randomUUID(), start, end: round(Math.min(start + 2, Math.max(total, start + 0.5))), text: "" }]);
  }

  return (
    <Panel id="editor-subtitles" icon={<Captions className="size-4" aria-hidden />} title={t("subtitles.title")}>
      {subtitles.length === 0 && <p className="text-xs text-muted-foreground">{t("subtitles.empty")}</p>}
      <ol className="flex flex-col gap-2">
        {subtitles.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-2">
            <textarea
              value={s.text}
              maxLength={SUBTITLE_TEXT_MAX}
              rows={2}
              dir="auto"
              aria-label={t("subtitles.text", { n: i + 1 })}
              placeholder={t("subtitles.placeholder")}
              onChange={(e) => update(s.id, { text: e.target.value })}
              className="w-full resize-none rounded-lg border bg-background px-2 py-1.5 text-xs"
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <label className="flex items-center gap-1">
                {t("subtitles.from")}
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={s.start}
                  dir="ltr"
                  onChange={(e) => {
                    const start = round(Math.max(0, Number(e.target.value)));
                    if (Number.isFinite(start)) update(s.id, { start, end: Math.max(s.end, round(start + 0.1)) });
                  }}
                  className="h-7 w-16 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
                />
              </label>
              <label className="flex items-center gap-1">
                {t("subtitles.to")}
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={s.end}
                  dir="ltr"
                  onChange={(e) => {
                    const end = round(Number(e.target.value));
                    if (Number.isFinite(end)) update(s.id, { end: Math.max(end, round(s.start + 0.1)) });
                  }}
                  className="h-7 w-16 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
                />
              </label>
              <Button type="button" size="icon-sm" variant="ghost" className="ms-auto" aria-label={t("subtitles.remove", { n: i + 1 })} onClick={() => onChange(subtitles.filter((x) => x.id !== s.id))}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="outline" onClick={add} disabled={subtitles.length >= MAX_SUBTITLES || total === 0}>
        <Plus className="size-3.5" aria-hidden />
        {t("subtitles.add")}
      </Button>
    </Panel>
  );
}

type Track = "music" | "voice";
type AudioProblem = string | null;

/** A project file's name as shown: generated ones say what they are. */
function useMediaLabel() {
  const t = useTranslations("Editor");
  return (m: Pick<EditorMediaView, "name" | "source">) => (m.source ? t(`sound.made.${m.source}`, { name: m.name }) : m.name);
}

/**
 * The clips' own sound, a music track under the whole video (looped) and a voice-over played once
 * from a set time. Each track can be uploaded, picked from the project's files, or generated (B12).
 */
export function SoundPanel({
  timeline,
  audioMedia,
  playhead,
  problems,
  onChange,
  onUpload,
  onGenerate,
}: {
  timeline: EditTimeline;
  audioMedia: EditorMediaView[];
  playhead: number;
  /** Why voice-over / music can't be generated now (a job error code), or null. */
  problems: { voice: AudioProblem; music: AudioProblem };
  onChange: (patch: Partial<Pick<EditTimeline, "audio" | "voice" | "clipVolume">>) => void;
  onUpload: (file: File, track: Track) => Promise<boolean>;
  onGenerate: (request: AudioRequest) => Promise<boolean>;
}) {
  const t = useTranslations("Editor");
  return (
    <Panel id="editor-sound" icon={<Music className="size-4" aria-hidden />} title={t("sound.title")}>
      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
        {t("sound.clipVolume", { value: Math.round(timeline.clipVolume * 100) })}
        <input type="range" min={0} max={100} value={Math.round(timeline.clipVolume * 100)} onChange={(e) => onChange({ clipVolume: Number(e.target.value) / 100 })} className="accent-primary" />
      </label>
      <TrackSection track="music" timeline={timeline} audioMedia={audioMedia} playhead={playhead} problem={problems.music} onChange={onChange} onUpload={onUpload} onGenerate={onGenerate} />
      <TrackSection track="voice" timeline={timeline} audioMedia={audioMedia} playhead={playhead} problem={problems.voice} onChange={onChange} onUpload={onUpload} onGenerate={onGenerate} />
    </Panel>
  );
}

function TrackSection({
  track,
  timeline,
  audioMedia,
  playhead,
  problem,
  onChange,
  onUpload,
  onGenerate,
}: {
  track: Track;
  timeline: EditTimeline;
  audioMedia: EditorMediaView[];
  playhead: number;
  problem: AudioProblem;
  onChange: (patch: Partial<Pick<EditTimeline, "audio" | "voice">>) => void;
  onUpload: (file: File, track: Track) => Promise<boolean>;
  onGenerate: (request: AudioRequest) => Promise<boolean>;
}) {
  const t = useTranslations("Editor");
  const label = useMediaLabel();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [making, setMaking] = useState(false);
  const total = timelineDuration(timeline);
  const current = track === "music" ? timeline.audio : timeline.voice;
  const currentMedia = current ? audioMedia.find((m) => m.assetId === current.assetId) : undefined;
  const id = `editor-${track}`;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    await onUpload(file, track);
    setUploading(false);
  }

  function use(m: EditorMediaView) {
    if (track === "music") onChange({ audio: { assetId: m.assetId, name: m.name, volume: 0.5 } });
    else onChange({ voice: { assetId: m.assetId, name: m.name, volume: 1, start: round(Math.min(playhead, Math.max(0, total - 0.5))) } });
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-t pt-3">
      <h3 id={id} className="flex items-center gap-1.5 text-xs font-bold">
        {track === "music" ? <Music className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
        {t(`sound.${track}.title`)}
      </h3>

      {current ? (
        <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs" dir="auto">
              {currentMedia ? label(currentMedia) : current.name || t(`sound.${track}.title`)}
            </span>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t(`sound.${track}.remove`)} onClick={() => onChange(track === "music" ? { audio: null } : { voice: null })}>
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            {t(`sound.${track}.volume`, { value: Math.round(current.volume * 100) })}
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(current.volume * 100)}
              onChange={(e) => {
                const volume = Number(e.target.value) / 100;
                if (track === "music" && timeline.audio) onChange({ audio: { ...timeline.audio, volume } });
                if (track === "voice" && timeline.voice) onChange({ voice: { ...timeline.voice, volume } });
              }}
              className="accent-primary"
            />
          </label>
          {track === "voice" && timeline.voice && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {t("sound.voice.start")}
              <input
                type="number"
                min={0}
                step={0.1}
                value={timeline.voice.start}
                dir="ltr"
                onChange={(e) => {
                  const start = round(Math.max(0, Number(e.target.value)));
                  if (Number.isFinite(start) && timeline.voice) onChange({ voice: { ...timeline.voice, start } });
                }}
                className="h-7 w-16 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
              />
            </label>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t(`sound.${track}.none`)}</p>
      )}

      {!current && audioMedia.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t(`sound.${track}.files`)}>
          {audioMedia.map((m) => (
            <li key={m.assetId}>
              <button type="button" onClick={() => use(m)} className="w-full truncate rounded-lg border px-2 py-1.5 text-start text-xs hover:bg-muted" dir="auto">
                {t("sound.use", { name: label(m) })}
              </button>
            </li>
          ))}
        </ul>
      )}

      {making ? (
        <GenerateForm track={track} problem={problem} onCancel={() => setMaking(false)} onGenerate={async (request) => (await onGenerate(request)) && (setMaking(false), true)} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setMaking(true)}>
            <Sparkles className="size-3.5" aria-hidden />
            {t(`sound.${track}.generate`)}
          </Button>
          <input
            ref={input}
            type="file"
            accept={[...EDITOR_AUDIO_TYPES, "audio/x-m4a", "audio/x-wav", ".mp3,.m4a,.wav"].join(",")}
            className="sr-only"
            aria-label={t(`sound.${track}.upload`)}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant="ghost" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            {t("sound.uploadShort")}
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t(`sound.${track}.hint`)}</p>
    </section>
  );
}

/** Writes the request for a generated voice-over (script, voice, direction) or music (a description). */
function GenerateForm({ track, problem, onCancel, onGenerate }: { track: Track; problem: AudioProblem; onCancel: () => void; onGenerate: (request: AudioRequest) => Promise<boolean> }) {
  const t = useTranslations("Editor");
  const tw = useTranslations("Workspace");
  const cost = useJobCost(track);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<VoiceStyle>("warm");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const max = track === "voice" ? VOICE_SCRIPT_MAX : MUSIC_PROMPT_MAX;
  const blocked = problem ? blockedReason(problem) : null;

  async function submit() {
    if (!text.trim() || busy || problem) return;
    setBusy(true);
    const ok = await onGenerate(track === "voice" ? { kind: "voice", text, voice, direction } : { kind: "music", prompt: text });
    setBusy(false);
    if (ok) setText("");
  }

  return (
    <form
      aria-label={t(`sound.${track}.generate`)}
      className="flex flex-col gap-2 rounded-xl border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {problem && (
        <p role="note" className="rounded-lg bg-muted px-2 py-1.5 text-[11px]">
          {blocked ? tw(`blocked.${blocked}.title`) : t.has(`errors.${problem}`) ? t(`errors.${problem}`) : t("errors.generic")}
        </p>
      )}
      <textarea
        value={text}
        maxLength={max}
        rows={track === "voice" ? 4 : 2}
        dir="auto"
        autoFocus
        aria-label={t(`sound.${track}.prompt`)}
        placeholder={t(`sound.${track}.placeholder`)}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-none rounded-lg border bg-background px-2 py-1.5 text-xs"
      />
      {track === "voice" && (
        <>
          <Choice label={t("sound.voice.style")} value={voice} options={VOICE_STYLES} labelFor={(v) => t(`sound.voice.styles.${v}`)} onChange={setVoice} />
          <input
            value={direction}
            maxLength={VOICE_DIRECTION_MAX}
            dir="auto"
            aria-label={t("sound.voice.direction")}
            placeholder={t("sound.voice.directionPlaceholder")}
            onChange={(e) => setDirection(e.target.value)}
            className="h-8 w-full rounded-lg border bg-background px-2 text-xs"
          />
        </>
      )}
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={busy || !text.trim() || problem !== null}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          {busy ? t("sound.generating") : t("sound.make")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("sound.cancel")}
        </Button>
        <span className="ms-auto text-[11px] text-muted-foreground">{t("sound.cost", { count: cost })}</span>
      </div>
    </form>
  );
}

/** Export size and framing, the export button and the finished MP4. */
export function ExportPanel({
  project,
  name,
  timeline,
  canEdit,
  exporting,
  onChange,
  onExport,
}: {
  project: EditorProject;
  /** The name as typed (the download is named after it). */
  name: string;
  timeline: EditTimeline;
  canEdit: boolean;
  exporting: boolean;
  onChange: (patch: Partial<Pick<EditTimeline, "aspectRatio" | "resolution" | "fit">>) => void;
  onExport: () => void;
}) {
  const t = useTranslations("Editor");
  const rendering = project.status === "pending" || project.status === "running";
  const fileName = `${(name.trim() || project.name || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "video"}.mp4`;

  return (
    <Panel id="editor-export" icon={<Video className="size-4" aria-hidden />} title={t("export.title")}>
      <fieldset disabled={!canEdit || rendering} className="flex flex-col gap-3">
        <Choice label={t("export.size")} value={timeline.aspectRatio} options={EDIT_ASPECT_RATIOS} labelFor={(v) => t(`export.ratios.${v.replace(":", "x")}`)} onChange={(aspectRatio) => onChange({ aspectRatio })} />
        <Choice label={t("export.resolution")} value={timeline.resolution} options={EDIT_RESOLUTIONS} labelFor={(v) => v} onChange={(resolution) => onChange({ resolution })} />
        <Choice label={t("export.fit")} value={timeline.fit} options={EDIT_FITS} labelFor={(v) => t(`export.fits.${v}`)} onChange={(fit) => onChange({ fit })} />
      </fieldset>
      {canEdit && (
        <Button type="button" onClick={onExport} disabled={exporting || rendering || timeline.clips.length === 0}>
          {exporting || rendering ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Video className="size-4" aria-hidden />}
          {rendering ? t("export.rendering") : t("export.button")}
        </Button>
      )}
      {rendering && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {t("export.renderingHint")}
        </p>
      )}
      {project.status === "failed" && (
        <p role="alert" className="text-xs text-danger">
          {t(`export.errors.${["media_missing", "render_unavailable", "timed_out", "invalid_input"].includes(project.error ?? "") ? project.error : "render_failed"}`)}
        </p>
      )}
      {project.output && !rendering && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{t("export.latest")}</p>
          <video src={project.output.url} controls playsInline preload="metadata" aria-label={t("export.result")} className="max-h-72 w-full rounded-lg bg-black" />
          <a
            href={project.output.url}
            download={fileName}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            {t("export.download")}
          </a>
        </div>
      )}
    </Panel>
  );
}
