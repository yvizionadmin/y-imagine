"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImagePlus, Loader2, Lock, Sparkles, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { blockedReason } from "@/components/app/job-errors";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { CAMERA_MOVES, CREATE_ASPECT_RATIOS, MOTION_LEVELS, type CameraMove, type CreateAspectRatio, type MotionLevel } from "@/lib/ai/types";
import type { VideoAspectRatio, VideoCapabilities } from "@/lib/ai/video-models";
import { videoCost, type VideoResolution } from "@/lib/credits";
import { LATN } from "@/lib/format";
import { createImages, getStudioSetup, listStudioRecent, pollStudioVideos, startVideo } from "../actions";
import { parseMediaMode, PROMPT_MAX, STUDIO_MAX_IMAGES, STUDIO_MAX_REFERENCES, type MediaMode, type StudioItem, type StudioSetup } from "../types";
import { MediaModeSwitch } from "./media-mode-switch";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const POLL_MS = 4000;

type ImageOptions = { aspectRatio: CreateAspectRatio; resolution: "HD" | "2K"; count: number };
type VideoOptions = { seconds: number; aspectRatio: VideoAspectRatio; resolution: VideoResolution; camera: CameraMove; motion: MotionLevel };

/** Keeps each option inside what the org's video model supports. */
function fitVideo(options: VideoOptions, caps: VideoCapabilities): VideoOptions {
  const pick = <T,>(value: T, allowed: readonly T[], fallback: T) => (allowed.includes(value) ? value : allowed.includes(fallback) ? fallback : allowed[0]);
  return {
    ...options,
    seconds: pick(options.seconds, caps.durations, 8),
    aspectRatio: pick(options.aspectRatio, caps.aspectRatios, "9:16"),
    resolution: pick(options.resolution, caps.resolutions, "720p"),
  };
}

const isOpen = (item: StudioItem) => item.kind === "video" && (item.status === "pending" || item.status === "running");

/**
 * Studio home after sign-in: one prompt box, the Image | Video switch below it, the options of the
 * chosen mode, and recent results. The mode lives in `?mode=` so refresh, back and shared links keep it.
 */
export function StudioHome() {
  const t = useTranslations("Studio");
  const tw = useTranslations("Workspace");
  const format = useFormatter();
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = parseMediaMode(searchParams.get("mode"));

  const [setup, setSetup] = useState<StudioSetup | null>(null);
  const [recent, setRecent] = useState<StudioItem[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [startFrame, setStartFrame] = useState<File | null>(null);
  const [image, setImage] = useState<ImageOptions>({ aspectRatio: "1:1", resolution: "HD", count: 1 });
  const [video, setVideo] = useState<VideoOptions>({ seconds: 8, aspectRatio: "9:16", resolution: "720p", camera: "static", motion: "medium" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStudioSetup().then((s) => {
      setSetup(s);
      setVideo((v) => fitVideo(v, s.videoCaps));
    });
    listStudioRecent().then(setRecent);
  }, []);

  // Videos render in the background: re-check the open ones until they finish.
  const openIds = useMemo(() => (recent ?? []).filter(isOpen).map((i) => i.id), [recent]);
  useEffect(() => {
    if (!openIds.length) return;
    const timer = setInterval(async () => {
      const fresh = await pollStudioVideos(openIds);
      const byId = new Map(fresh.map((i) => [i.id, i]));
      setRecent((r) => (r ?? []).map((i) => byId.get(i.id) ?? i));
      if (fresh.some((i) => !isOpen(i))) {
        // A finished video used credits: refresh the badge and what's left.
        setNotice(null);
        router.refresh();
        getStudioSetup().then(setSetup);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [openIds, router]);

  const setMode = useCallback(
    (next: MediaMode) => {
      const params = new URLSearchParams(searchParams);
      if (next === "image") params.delete("mode");
      else params.set("mode", next);
      const query = params.toString();
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
      setError(null);
      setNotice(null);
    },
    [searchParams],
  );

  const n = (v: number) => format.number(v, LATN);
  const cost = setup ? (mode === "image" ? setup.imageCost * image.count : videoCost(setup, { seconds: video.seconds, resolution: video.resolution })) : null;
  const videoLocked = setup !== null && !setup.videoAllowed;
  const modeReady = !!setup && (mode === "image" ? setup.imageAllowed : setup.videoAllowed && !setup.videoDisabled && setup.videoProblem === null);
  const canSubmit = !!setup && setup.canCreate && prompt.trim().length > 0 && !pending && modeReady && cost !== null && cost <= setup.creditsRemaining;

  function addFiles(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => IMAGE_TYPES.split(",").includes(f.type) && f.size <= MAX_FILE_BYTES);
    if (mode === "video") setStartFrame(files[0] ?? startFrame);
    else setReferences((current) => [...current, ...files].slice(0, STUDIO_MAX_REFERENCES));
  }

  function failure(code: string) {
    const blocked = blockedReason(code);
    if (blocked) return tw(`blocked.${blocked}.title`);
    if (code === "forbidden" || code === "invalid_input" || code === "too_many_jobs") return t(`errors.${code}`);
    if (code === "not_enough_credits") return t("notEnoughCredits", { count: cost ?? 0 });
    return t("errors.failed");
  }

  function submitVideo() {
    const form = new FormData();
    form.set("prompt", prompt.trim());
    form.set("aspectRatio", video.aspectRatio);
    form.set("seconds", String(video.seconds));
    form.set("resolution", video.resolution);
    form.set("camera", video.camera);
    form.set("motion", video.motion);
    if (startFrame) form.set("startFrame", startFrame);
    startTransition(async () => {
      const result = await startVideo(form);
      if (!result.ok) return setError(failure(result.error));
      setRecent((r) => [result.item, ...(r ?? [])]);
      setNotice(t("videoQueued"));
    });
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    setNotice(null);
    if (mode === "video") return submitVideo();
    const form = new FormData();
    form.set("prompt", prompt.trim());
    form.set("aspectRatio", image.aspectRatio);
    form.set("resolution", image.resolution);
    form.set("count", String(image.count));
    for (const file of references) form.append("reference", file);
    startTransition(async () => {
      const result = await createImages(form);
      if (!result.ok) return setError(failure(result.error));
      setRecent((r) => [...result.items, ...(r ?? [])]);
      if (result.failed) setNotice(t("partial", { made: result.items.length, failed: result.failed }));
      setSetup((s) => (s ? { ...s, creditsRemaining: Math.max(0, s.creditsRemaining - s.imageCost * result.items.length) } : s));
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-4 pt-12 pb-8 sm:px-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        {/* Prompt */}
        <div className="w-full rounded-2xl border bg-background p-3 shadow-sm focus-within:border-ring">
          <label htmlFor="studio-prompt" className="sr-only">
            {t("promptLabel")}
          </label>
          <textarea
            id="studio-prompt"
            rows={3}
            maxLength={PROMPT_MAX}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={t(mode === "image" ? "promptImage" : "promptVideo")}
            className="w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {(mode === "image" ? references : startFrame ? [startFrame] : []).map((file, i) => (
                <Thumb
                  key={`${file.name}-${i}`}
                  file={file}
                  label={t("removeReference")}
                  onRemove={() => (mode === "image" ? setReferences((r) => r.filter((_, j) => j !== i)) : setStartFrame(null))}
                />
              ))}
              {(mode === "image" ? references.length < STUDIO_MAX_REFERENCES : !startFrame) && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  <ImagePlus className="size-4" aria-hidden />
                  {t(mode === "image" ? "addReference" : "addStartFrame")}
                </button>
              )}
              <input ref={fileInput} type="file" accept={IMAGE_TYPES} multiple={mode === "image"} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
            </div>
            <div className="flex items-center gap-3">
              {cost !== null && <span className="text-xs text-muted-foreground tabular-nums">{t("cost", { count: cost, display: n(cost) })}</span>}
              <Button onClick={submit} disabled={!canSubmit} className="h-10 gap-2 px-5 text-[13px] font-bold">
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                {t(pending ? "generating" : "generate")}
              </Button>
            </div>
          </div>
        </div>

        {/* Image | Video switch, right below the prompt */}
        <MediaModeSwitch mode={mode} onChange={setMode} videoLocked={videoLocked} />

        {mode === "image" ? (
          <OptionRow>
            <ChipGroup label={t("aspectRatio")} options={CREATE_ASPECT_RATIOS} value={image.aspectRatio} onChange={(aspectRatio) => setImage({ ...image, aspectRatio })} ltr />
            <ChipGroup label={t("resolution")} options={["HD", "2K"] as const} value={image.resolution} onChange={(resolution) => setImage({ ...image, resolution })} ltr />
            <ChipGroup
              label={t("count")}
              options={Array.from({ length: STUDIO_MAX_IMAGES }, (_, i) => String(i + 1))}
              value={String(image.count)}
              onChange={(count) => setImage({ ...image, count: Number(count) })}
              ltr
            />
          </OptionRow>
        ) : (
          <>
            <OptionRow>
              <ChipGroup
                label={t("duration")}
                options={(setup?.videoCaps.durations ?? [video.seconds]).map(String)}
                value={String(video.seconds)}
                onChange={(s) => setVideo({ ...video, seconds: Number(s) })}
                render={(s) => t("seconds", { count: Number(s) })}
              />
              <ChipGroup label={t("aspectRatio")} options={setup?.videoCaps.aspectRatios ?? [video.aspectRatio]} value={video.aspectRatio} onChange={(aspectRatio) => setVideo({ ...video, aspectRatio })} ltr />
              <ChipGroup label={t("resolution")} options={setup?.videoCaps.resolutions ?? [video.resolution]} value={video.resolution} onChange={(resolution) => setVideo({ ...video, resolution })} ltr />
              <ChipGroup label={t("motion")} options={MOTION_LEVELS} value={video.motion} onChange={(motion) => setVideo({ ...video, motion })} render={(m) => t(`motionLevels.${m}`)} />
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">{t("camera")}</span>
                <select
                  value={video.camera}
                  onChange={(e) => setVideo({ ...video, camera: e.target.value as CameraMove })}
                  className="h-8 rounded-lg border bg-background px-2 text-xs font-semibold outline-none focus-visible:border-ring"
                >
                  {CAMERA_MOVES.map((c) => (
                    <option key={c} value={c}>
                      {t(`cameraMoves.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
            </OptionRow>
            <p className="-mt-1 text-[11px] text-muted-foreground">{t(setup?.videoCaps.audio ? "promptDirectionAudio" : "promptDirection")}</p>
            {videoLocked ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <span className="flex items-start gap-2 text-[13px]">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="flex flex-col">
                    <span className="font-bold">{t("videoLockedTitle")}</span>
                    <span>{t("videoLockedBody")}</span>
                  </span>
                </span>
                <Link href="/settings/billing" className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
                  {t("upgrade")}
                </Link>
              </div>
            ) : setup?.videoDisabled ? (
              <p className="w-full rounded-xl bg-muted px-4 py-3 text-center text-xs text-muted-foreground">{tw("blocked.disabled.title")}</p>
            ) : setup?.videoProblem ? (
              <p className="w-full rounded-xl bg-muted px-4 py-3 text-center text-xs text-muted-foreground">
                {t("videoNeedsKey")}{" "}
                <Link href="/settings/api-keys" className="font-semibold text-primary hover:underline">
                  {t("addKey")}
                </Link>
              </p>
            ) : null}
          </>
        )}

        {setup && !setup.canCreate && <p className="text-xs text-muted-foreground">{t("viewerNote")}</p>}
        {setup && setup.canCreate && mode === "image" && !setup.imageAllowed && <p className="text-xs text-danger">{tw("blocked.plan.title")}</p>}
        {setup && modeReady && cost !== null && cost > setup.creditsRemaining && <p className="text-xs text-danger">{t("notEnoughCredits", { count: cost })}</p>}
        {error && (
          <p role="alert" className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {notice}
          </p>
        )}
      </section>

      <Recent items={recent} pending={pending && mode === "image" ? image.count : 0} />
    </div>
  );
}

function OptionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-wrap items-end justify-center gap-x-6 gap-y-4">{children}</div>;
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  ltr,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render?: (value: T) => string;
  ltr?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            dir={ltr ? "ltr" : undefined}
            className={cn("rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground", option === value && "bg-background text-foreground shadow-xs")}
          >
            {render ? render(option) : option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thumb({ file, label, onRemove }: { file: File; label: string; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <span className="relative size-9 overflow-hidden rounded-lg border">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an unsent file */}
      <img src={url} alt="" className="size-full object-cover" />
      <button type="button" onClick={onRemove} aria-label={label} className="absolute -top-0.5 -end-0.5 rounded-full bg-foreground/80 p-0.5 text-background">
        <X className="size-2.5" aria-hidden />
      </button>
    </span>
  );
}

function Recent({ items, pending }: { items: StudioItem[] | null; pending: number }) {
  const t = useTranslations("Studio");
  if (items === null) return <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" aria-hidden />;
  if (!items.length && !pending) return <p className="pb-12 text-center text-xs text-muted-foreground">{t("emptyRecent")}</p>;
  return (
    <section aria-labelledby="studio-recent" className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="studio-recent" className="text-sm font-bold">
          {t("recent")}
        </h2>
        <Link href="/history" className="text-xs font-semibold text-primary hover:underline">
          {t("viewHistory")}
        </Link>
      </div>
      <ul className="columns-2 gap-3 sm:columns-3 lg:columns-4">
        {Array.from({ length: pending }, (_, i) => (
          <li key={`pending-${i}`} className="mb-3 flex aspect-square break-inside-avoid items-center justify-center rounded-xl bg-muted">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </li>
        ))}
        {items.map((item) =>
          item.kind === "video" ? (
            <VideoCard key={item.id} item={item} />
          ) : (
            <li key={item.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border bg-muted">
              <a href={item.url ?? undefined} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- org asset served by /api/assets */}
                <img src={item.url ?? undefined} alt={item.prompt} width={item.width} height={item.height} loading="lazy" className="h-auto w-full" />
              </a>
              <p className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {item.prompt}
              </p>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function VideoCard({ item }: { item: StudioItem }) {
  const t = useTranslations("Studio");
  const tw = useTranslations("Workspace");
  const blocked = item.error ? blockedReason(item.error) : null;
  return (
    <li className="mb-3 break-inside-avoid overflow-hidden rounded-xl border bg-background">
      <div className="relative bg-muted" style={{ aspectRatio: `${item.width} / ${item.height}` }}>
        {item.status === "ok" && item.url ? (
          <video src={item.url} controls playsInline preload="metadata" aria-label={item.prompt} className="absolute inset-0 size-full bg-black object-contain" />
        ) : item.status === "failed" ? (
          <div role="status" className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-danger">
            <span className="font-semibold">{t("videoFailed")}</span>
            <span className="text-muted-foreground">{blocked ? tw(`blocked.${blocked}.title`) : item.error === "timed_out" ? t("videoTimedOut") : t("videoFailedHint")}</span>
          </div>
        ) : (
          <div role="status" className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span>{t(item.status === "running" ? "videoRunning" : "videoPending")}</span>
          </div>
        )}
      </div>
      <p className="flex items-center justify-between gap-2 p-2 text-[11px]">
        <span className="line-clamp-1 text-muted-foreground">{item.prompt}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-semibold" dir="ltr">
          {item.aspectRatio} · {item.seconds}s
        </span>
      </p>
    </li>
  );
}
