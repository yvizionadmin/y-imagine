"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Film, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clipLength, EDITOR_CLIP_TYPES, MIN_CLIP_SECONDS, type EditClip } from "@/lib/editor/timeline";
import type { EditorMediaView, EditorSource } from "../types";
import { formatTime } from "./editor-preview";

/** A clip to add: the file and how long it runs (null when unknown until it loads). */
export type ClipPick = { assetId: string; name: string; seconds: number | null };

const round = (n: number) => Math.round(n * 10) / 10;

/** The length of a video file, read from its metadata in the browser; null until known. */
function useDuration(url: string) {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => setDuration(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.src = url;
    return () => {
      el.onloadedmetadata = null;
      el.removeAttribute("src");
      el.load();
    };
  }, [url]);
  return duration;
}

/**
 * The edit's clips in order, each with its cut (start and end inside the file), its place in the
 * order and a remove button. Selecting a clip moves the preview to it.
 */
export function ClipList({
  clips,
  urlFor,
  disabled,
  onChange,
  onSelect,
  onAdd,
}: {
  clips: EditClip[];
  urlFor: (assetId: string) => string;
  disabled: boolean;
  onChange: (clips: EditClip[]) => void;
  onSelect: (index: number) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("Editor");

  const move = (from: number, to: number) => {
    const next = clips.slice();
    const [clip] = next.splice(from, 1);
    next.splice(to, 0, clip);
    onChange(next);
  };

  return (
    <section aria-labelledby="editor-clips" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="editor-clips" className="text-sm font-bold">
          {t("clips.title")}
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={onAdd} disabled={disabled}>
          <Plus className="size-3.5" aria-hidden />
          {t("clips.add")}
        </Button>
      </div>
      {clips.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-background px-4 py-8 text-center text-xs text-muted-foreground hover:bg-muted/50 disabled:cursor-default"
        >
          <Film className="size-6" aria-hidden />
          {t("clips.empty")}
        </button>
      ) : (
        <ol className="flex flex-col gap-2">
          {clips.map((clip, i) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              index={i}
              count={clips.length}
              url={urlFor(clip.assetId)}
              disabled={disabled}
              onSelect={() => onSelect(i)}
              onChange={(next) => onChange(clips.map((c) => (c.id === clip.id ? next : c)))}
              onMove={(to) => move(i, to)}
              onRemove={() => onChange(clips.filter((c) => c.id !== clip.id))}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ClipRow({
  clip,
  index,
  count,
  url,
  disabled,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  clip: EditClip;
  index: number;
  count: number;
  url: string;
  disabled: boolean;
  onSelect: () => void;
  onChange: (clip: EditClip) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Editor");
  const duration = useDuration(url);
  const max = duration ?? Math.max(clip.end, 1);
  const label = clip.name || t("clips.clipN", { n: index + 1 });

  const setStart = (value: number) => {
    const start = round(Math.min(Math.max(0, value), clip.end - MIN_CLIP_SECONDS));
    if (Number.isFinite(start)) onChange({ ...clip, start });
  };
  const setEnd = (value: number) => {
    const end = round(Math.max(Math.min(max, value), clip.start + MIN_CLIP_SECONDS));
    if (Number.isFinite(end)) onChange({ ...clip, end });
  };

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border bg-background p-2.5" aria-label={t("clips.clipLabel", { n: index + 1, name: label })}>
      <button type="button" onClick={onSelect} className="shrink-0 overflow-hidden rounded-lg bg-black" aria-label={t("clips.show", { name: label })}>
        <video src={`${url}#t=${clip.start}`} muted preload="metadata" className="h-14 w-20 object-cover" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="truncate text-xs font-medium" dir="auto" title={label}>
          <span className="text-muted-foreground tabular-nums">{index + 1}. </span>
          {label}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1">
            {t("clips.start")}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={clip.start}
              disabled={disabled}
              onChange={(e) => setStart(Number(e.target.value))}
              className="h-7 w-16 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
              dir="ltr"
            />
          </label>
          <label className="flex items-center gap-1">
            {t("clips.end")}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={duration ?? undefined}
              step={0.1}
              value={clip.end}
              disabled={disabled}
              onChange={(e) => setEnd(Number(e.target.value))}
              className="h-7 w-16 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
              dir="ltr"
            />
          </label>
          <span className="tabular-nums" dir="ltr">
            {formatTime(clipLength(clip))}
            {duration ? ` / ${formatTime(duration)}` : ""}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("clips.moveUp", { name: label })} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("clips.moveDown", { name: label })} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("clips.remove", { name: label })} disabled={disabled} onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** Pick Studio videos or this project's uploads, or upload a new clip. */
export function AddClipDialog({
  open,
  onOpenChange,
  sources,
  uploads,
  onPick,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: EditorSource[] | null;
  uploads: EditorMediaView[];
  onPick: (clip: ClipPick) => void;
  onUpload: (file: File) => Promise<boolean>;
}) {
  const t = useTranslations("Editor");
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const ok = await onUpload(file);
    setUploading(false);
    if (ok) onOpenChange(false);
  }

  const items: (ClipPick & { url: string; key: string })[] = [
    ...uploads.map((m) => ({ key: `u-${m.assetId}`, assetId: m.assetId, name: m.name, seconds: m.seconds, url: m.url })),
    ...(sources ?? []).map((s) => ({ key: `s-${s.assetId}`, assetId: s.assetId, name: s.name, seconds: s.seconds, url: s.url })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("addClip.title")}</DialogTitle>
          <DialogDescription>{t("addClip.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={EDITOR_CLIP_TYPES.join(",")}
            className="sr-only"
            aria-label={t("addClip.upload")}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            {uploading ? t("addClip.uploading") : t("addClip.upload")}
          </Button>
          <span className="text-[11px] text-muted-foreground">{t("addClip.uploadHint")}</span>
        </div>
        {sources === null ? (
          <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" aria-hidden />
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-muted px-3 py-6 text-center text-xs text-muted-foreground">{t("addClip.none")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={t("addClip.listLabel")}>
            {items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex w-full flex-col gap-1 rounded-xl border bg-background p-1.5 text-start hover:border-primary"
                  aria-label={t("addClip.pick", { name: item.name || t("addClip.untitled") })}
                >
                  <video src={`${item.url}#t=0.5`} muted preload="metadata" className="aspect-video w-full rounded-lg bg-black object-cover" />
                  <span className="line-clamp-2 px-0.5 text-[11px]" dir="auto">
                    {item.name || t("addClip.untitled")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
