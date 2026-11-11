"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Aperture, ArrowUp, CornerDownLeft, Film, ChevronDown, Clapperboard, Clock, Cpu, ImagePlus, Images, Loader2, Lock, Plus, Sparkles, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { blockedReason } from "@/components/app/job-errors";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { CAMERA_MOVES, CREATE_ASPECT_RATIOS, LENS_PRESETS, LIGHTING_PRESETS, MOTION_LEVELS, type CameraMove, type CreateAspectRatio, type LensPreset, type LightingPreset, type MotionLevel } from "@/lib/ai/types";
import type { VideoAspectRatio, VideoCapabilities } from "@/lib/ai/video-models";
import { videoCost, type VideoResolution } from "@/lib/credits";
import { LATN } from "@/lib/format";
import { createImages, getStudioSetup, listStudioRecent, pollStudioVideos, startVideo } from "../actions";
import { parseMediaMode, PROMPT_MAX, STUDIO_MAX_IMAGES, STUDIO_MAX_REFERENCES, type MediaMode, type StudioItem, type StudioSetup } from "../types";
import { ContinueRow, ToolCards } from "./home-sections";
import { MediaModeSwitch } from "./media-mode-switch";
import { animateHref } from "@/lib/image/animate-href";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import { jobsChanged } from "@/lib/jobs-events";
import { LoadingSkeleton } from "@/components/ui/skeleton";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const POLL_MS = 4000;

type ImageOptions = { aspectRatio: CreateAspectRatio; resolution: "HD" | "2K"; count: number };
type VideoOptions = { seconds: number; aspectRatio: VideoAspectRatio; resolution: VideoResolution; camera: CameraMove; motion: MotionLevel; lens: LensPreset; lighting: LightingPreset };

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
 * Studio home after sign-in: a hero with the Image | Video tabs, one prompt card (references at the
 * start, the mode's options as chips, cost and send at the bottom), shortcuts to the other tools,
 * and recent results. The mode lives in `?mode=` so refresh, back and shared links keep it.
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
  /** Rights and likeness consent for the start frame; asked again for every new frame. */
  const [consent, setConsent] = useState(false);
  const [image, setImage] = useState<ImageOptions>({ aspectRatio: "1:1", resolution: "HD", count: 1 });
  const [video, setVideo] = useState<VideoOptions>({ seconds: 8, aspectRatio: "9:16", resolution: "720p", camera: "static", motion: "medium", lens: "auto", lighting: "auto" });
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

  // "Animate" from a result (`?mode=video&frame=<asset id>`): that stored image becomes the start frame.
  // Keyed on the id, not on load: the page stays mounted between visits.
  const frameId = searchParams.get("frame");
  useEffect(() => {
    if (!frameId || !/^[0-9a-f-]{36}$/.test(frameId)) return;
    let cancelled = false;
    fetch(`/api/assets/${frameId}`)
      .then((res) => (res.ok ? res.blob() : null))
      .catch(() => null)
      .then((blob) => {
        if (cancelled) return;
        const params = new URLSearchParams(window.location.search);
        params.delete("frame");
        window.history.replaceState(null, "", params.size ? `?${params}` : window.location.pathname);
        if (!blob || !IMAGE_TYPES.split(",").includes(blob.type) || blob.size > MAX_FILE_BYTES) return setError(t("frameFailed"));
        setStartFrame(new File([blob], `frame.${blob.type.split("/")[1]}`, { type: blob.type }));
        setConsent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [frameId, t]);

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

  /** Puts a past result's prompt back in the box, in its mode, ready to change and run again. */
  const reusePrompt = (item: StudioItem) => {
    setPrompt(item.prompt.slice(0, PROMPT_MAX));
    setMode(item.kind);
    requestAnimationFrame(() => {
      const box = document.getElementById("studio-prompt");
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      box?.focus({ preventScroll: true });
    });
  };

  const n = (v: number) => format.number(v, LATN);
  const gb = (bytes: number) => format.number(bytes / 1024 ** 3, { ...LATN, style: "unit", unit: "gigabyte", maximumFractionDigits: bytes < 1024 ** 3 ? 2 : 1 });
  const storageFull = mode === "video" && !!setup?.videoStorage.full;
  const needsConsent = mode === "video" && startFrame !== null && !consent;
  const cost = setup ? (mode === "image" ? setup.imageCost * image.count : videoCost(setup, { seconds: video.seconds, resolution: video.resolution })) : null;
  const videoLocked = setup !== null && !setup.videoAllowed;
  const modeReady = !!setup && (mode === "image" ? setup.imageAllowed : setup.videoAllowed && !setup.videoDisabled && setup.videoProblem === null);
  const canSubmit = !!setup && setup.canCreate && prompt.trim().length > 0 && !pending && modeReady && cost !== null && cost <= setup.creditsRemaining && !storageFull && !needsConsent;

  function addFiles(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => IMAGE_TYPES.split(",").includes(f.type) && f.size <= MAX_FILE_BYTES);
    if (mode === "video" && files[0]) {
      setStartFrame(files[0]);
      setConsent(false);
    }
    else setReferences((current) => [...current, ...files].slice(0, STUDIO_MAX_REFERENCES));
  }

  function failure(code: string) {
    const blocked = blockedReason(code);
    if (blocked) return tw(`blocked.${blocked}.title`);
    if (["forbidden", "invalid_input", "too_many_jobs", "consent_required", "storage_full"].includes(code)) return t(`errors.${code}`);
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
    form.set("lens", video.lens);
    form.set("lighting", video.lighting);
    if (startFrame) {
      form.set("startFrame", startFrame);
      if (consent) form.set("likenessConsent", "yes");
    }
    startTransition(async () => {
      const result = await startVideo(form);
      jobsChanged();
      if (!result.ok) {
        if (result.error === "storage_full") getStudioSetup().then(setSetup);
        return setError(failure(result.error));
      }
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

  const sources = mode === "image" ? references : startFrame ? [startFrame] : [];
  const canAddSource = mode === "image" ? references.length < STUDIO_MAX_REFERENCES : !startFrame;
  const removeSource = (i: number) => {
    if (mode === "image") return setReferences((r) => r.filter((_, j) => j !== i));
    setStartFrame(null);
    setConsent(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="p-2 sm:p-4">
        <div className="relative isolate overflow-hidden rounded-3xl border bg-linear-to-b from-primary/10 via-primary/5 to-muted/40 px-4 pt-10 pb-8 sm:px-8 sm:pt-14">
          <div aria-hidden className="pointer-events-none absolute -top-32 start-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl rtl:translate-x-1/2" />
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6">
            <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              {t.rich("title", { em: (chunks) => <em className="font-serif font-bold italic rtl:font-sans rtl:not-italic rtl:text-primary">{chunks}</em> })}
            </h1>

            <MediaModeSwitch mode={mode} onChange={setMode} videoLocked={videoLocked} />

            {/* Prompt card */}
            <div className="w-full rounded-2xl border bg-background/90 p-3 shadow-sm backdrop-blur focus-within:border-ring sm:p-4">
              <div className="flex gap-3 sm:gap-4">
                <SourceStack
                  files={sources}
                  canAdd={canAddSource}
                  addLabel={t(mode === "image" ? "addReference" : "addStartFrame")}
                  removeLabel={t("removeReference")}
                  onAdd={() => fileInput.current?.click()}
                  onRemove={removeSource}
                />
                <input ref={fileInput} type="file" accept={IMAGE_TYPES} multiple={mode === "image"} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
                <label htmlFor="studio-prompt" className="sr-only">
                  {t("promptLabel")}
                </label>
                <textarea
                  id="studio-prompt"
                  rows={4}
                  maxLength={PROMPT_MAX}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  placeholder={t(mode === "image" ? "promptImage" : "promptVideo")}
                  className="field-sizing-content max-h-72 min-h-24 min-w-0 flex-1 resize-none bg-transparent pt-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {mode === "image" ? (
                    <>
                      <OptionChip icon={<RatioIcon ratio={image.aspectRatio} />} label={t("aspectRatio")} value={`${image.aspectRatio} · ${image.resolution}`}>
                        <ChipGroup label={t("aspectRatio")} options={CREATE_ASPECT_RATIOS} value={image.aspectRatio} onChange={(aspectRatio) => setImage({ ...image, aspectRatio })} ltr />
                        <ChipGroup label={t("resolution")} options={["HD", "2K"] as const} value={image.resolution} onChange={(resolution) => setImage({ ...image, resolution })} ltr />
                      </OptionChip>
                      <OptionChip icon={<Images className="size-3.5" aria-hidden />} label={t("count")} value={n(image.count)}>
                        <ChipGroup
                          label={t("count")}
                          options={Array.from({ length: STUDIO_MAX_IMAGES }, (_, i) => String(i + 1))}
                          value={String(image.count)}
                          onChange={(count) => setImage({ ...image, count: Number(count) })}
                          ltr
                        />
                      </OptionChip>
                    </>
                  ) : (
                    <>
                      <OptionChip icon={<RatioIcon ratio={video.aspectRatio} />} label={t("aspectRatio")} value={`${video.aspectRatio} · ${video.resolution}`}>
                        <ChipGroup label={t("aspectRatio")} options={setup?.videoCaps.aspectRatios ?? [video.aspectRatio]} value={video.aspectRatio} onChange={(aspectRatio) => setVideo({ ...video, aspectRatio })} ltr />
                        <ChipGroup label={t("resolution")} options={setup?.videoCaps.resolutions ?? [video.resolution]} value={video.resolution} onChange={(resolution) => setVideo({ ...video, resolution })} ltr />
                      </OptionChip>
                      <OptionChip icon={<Clock className="size-3.5" aria-hidden />} label={t("duration")} value={t("seconds", { count: video.seconds })}>
                        <ChipGroup
                          label={t("duration")}
                          options={(setup?.videoCaps.durations ?? [video.seconds]).map(String)}
                          value={String(video.seconds)}
                          onChange={(s) => setVideo({ ...video, seconds: Number(s) })}
                          render={(s) => t("seconds", { count: Number(s) })}
                        />
                      </OptionChip>
                      <OptionChip icon={<Clapperboard className="size-3.5" aria-hidden />} label={t("camera")} value={`${t(`cameraMoves.${video.camera}`)} · ${t(`motionLevels.${video.motion}`)}`}>
                        <ChipGroup label={t("motion")} options={MOTION_LEVELS} value={video.motion} onChange={(motion) => setVideo({ ...video, motion })} render={(m) => t(`motionLevels.${m}`)} />
                        <ChipGroup label={t("camera")} options={CAMERA_MOVES} value={video.camera} onChange={(camera) => setVideo({ ...video, camera })} render={(c) => t(`cameraMoves.${c}`)} wrap />
                        <p className="max-w-64 text-[11px] text-muted-foreground">{t(setup?.videoCaps.audio ? "promptDirectionAudio" : "promptDirection")}</p>
                        {setup?.videoModel && setup.videoCaps.nativeCamera.includes(video.camera) && (
                          <p className="max-w-64 text-[11px] text-muted-foreground">{t("cameraNative", { model: setup.videoModel, move: t(`cameraMoves.${video.camera}`) })}</p>
                        )}
                      </OptionChip>
                      <OptionChip icon={<Aperture className="size-3.5" aria-hidden />} label={t("look")} value={`${t(`lensPresets.${video.lens}`)} · ${t(`lightingPresets.${video.lighting}`)}`}>
                        <ChipGroup label={t("lens")} options={LENS_PRESETS} value={video.lens} onChange={(lens) => setVideo({ ...video, lens })} render={(l) => t(`lensPresets.${l}`)} wrap />
                        <ChipGroup label={t("lighting")} options={LIGHTING_PRESETS} value={video.lighting} onChange={(lighting) => setVideo({ ...video, lighting })} render={(l) => t(`lightingPresets.${l}`)} wrap />
                        <p className="max-w-64 text-[11px] text-muted-foreground">{t("lookHint")}</p>
                      </OptionChip>
                      {setup?.videoModel && (
                        <OptionChip icon={<Cpu className="size-3.5" aria-hidden />} label={t("videoModel")} value={setup.videoModel}>
                          <p className="max-w-64 text-[11px] text-muted-foreground">{t("videoModelNote", { model: setup.videoModel })}</p>
                          {setup.canManageModels && (
                            <Link href="/settings/api-keys" className="text-xs font-semibold text-primary hover:underline">
                              {t("changeModel")}
                            </Link>
                          )}
                        </OptionChip>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2.5 ms-auto">
                  {cost !== null && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground tabular-nums">
                      <Sparkles className="size-3.5" aria-hidden />
                      <span aria-hidden>{n(cost)}</span>
                      <span className="sr-only">{t("cost", { count: cost, display: n(cost) })}</span>
                    </span>
                  )}
                  <Button
                    onClick={submit}
                    disabled={!canSubmit}
                    size="icon"
                    aria-label={t(pending ? "generating" : "generate")}
                    title={t(pending ? "generating" : "generate")}
                    className="size-9 rounded-full"
                  >
                    {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp className="size-4.5" aria-hidden />}
                  </Button>
                </div>
              </div>
            </div>

            {mode === "video" && startFrame && (
              <label className="flex w-full items-start gap-2.5 rounded-xl border bg-background/80 px-3.5 py-3 text-[13px] leading-snug">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>{t("consent")}</span>
              </label>
            )}

            {mode === "video" &&
              (videoLocked ? (
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
              ) : null)}

            {setup && mode === "video" && setup.videoAllowed && (
              <p className={cn("text-xs", setup.videoStorage.full ? "font-semibold text-danger" : "text-muted-foreground")}>
                {setup.videoStorage.full ? (
                  <>
                    {t("storageFull")}{" "}
                    <Link href="/history" className="text-primary hover:underline">
                      {t("viewHistory")}
                    </Link>
                  </>
                ) : (
                  t("storage", { used: gb(setup.videoStorage.used), limit: gb(setup.videoStorage.limit), days: setup.videoStorage.retentionDays })
                )}
              </p>
            )}
            {setup?.videoCleanup && (
              <p role="status" className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t("cleanupDue", {
                  count: setup.videoCleanup.count,
                  date: format.dateTime(new Date(setup.videoCleanup.date), { ...LATN, dateStyle: "long" }),
                  days: setup.videoStorage.retentionDays,
                })}{" "}
                <Link href="/history" className="font-semibold underline">
                  {t("viewHistory")}
                </Link>
              </p>
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

          </div>
        </div>
      </section>

      <ContinueRow />
      <Recent items={recent} pending={pending && mode === "image" ? image.count : 0} onReuse={reusePrompt} />
      <ToolCards />
    </div>
  );
}


/** A setting shown as a compact chip in the prompt bar; its choices open in a popover. */
function OptionChip({ icon, label, value, children }: { icon: React.ReactNode; label: string; value: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: ${value}`}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-muted/70 px-2.5 text-xs font-semibold text-foreground/80 outline-none hover:bg-muted focus-visible:border-ring data-popup-open:border-border data-popup-open:bg-muted"
      >
        {icon}
        <span dir="auto">{value}</span>
        <ChevronDown className="size-3 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-3">{children}</PopoverContent>
    </Popover>
  );
}

/** Outline of the frame for an aspect ratio such as "16:9". */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 12 / Math.max(w, h);
  return (
    <span aria-hidden className="flex size-3.5 items-center justify-center">
      <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(5, w * scale), height: Math.max(5, h * scale) }} />
    </span>
  );
}

/** References (image) or the start frame (video) as a small tilted stack at the start of the prompt. */
function SourceStack({
  files,
  canAdd,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
}: {
  files: File[];
  canAdd: boolean;
  addLabel: string;
  removeLabel: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-2 pt-1">
      {files.map((file, i) => (
        <Thumb key={`${file.name}-${i}`} file={file} label={removeLabel} onRemove={() => onRemove(i)} tilt={i % 2 ? 4 : -4} />
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          title={addLabel}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed bg-muted/40 text-muted-foreground transition hover:border-primary/50 hover:text-primary",
            files.length ? "size-9" : "h-14 w-12 -rotate-6 hover:rotate-0",
          )}
        >
          {files.length ? <Plus className="size-4" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          <span className={cn("text-[9px] font-semibold leading-none", files.length && "sr-only")}>{addLabel}</span>
        </button>
      )}
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  ltr,
  wrap,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render?: (value: T) => string;
  ltr?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className={cn("flex gap-0.5 rounded-lg bg-muted p-0.5", wrap && "grid max-w-64 grid-cols-3")}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            dir={ltr ? "ltr" : undefined}
            className={cn("rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground", option === value && "bg-background text-foreground shadow-xs")}
          >
            {render ? render(option) : option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thumb({ file, label, onRemove, tilt = 0 }: { file: File; label: string; onRemove: () => void; tilt?: number }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <span className="relative h-14 w-12 rounded-lg border-2 border-background shadow-md transition hover:rotate-0" style={{ rotate: `${tilt}deg` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an unsent file */}
      <img src={url} alt="" className="size-full rounded-md object-cover" />
      <button type="button" onClick={onRemove} aria-label={label} className="absolute -top-1.5 -end-1.5 rounded-full bg-foreground/80 p-0.5 text-background">
        <X className="size-2.5" aria-hidden />
      </button>
    </span>
  );
}

function Recent({ items, pending, onReuse }: { items: StudioItem[] | null; pending: number; onReuse: (item: StudioItem) => void }) {
  const t = useTranslations("Studio");
  if (items === null) return <LoadingSkeleton variant="cards" count={4} className="mx-auto max-w-6xl px-4 pb-12 sm:px-8" />;
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
            <VideoCard key={item.id} item={item} onReuse={() => onReuse(item)} />
          ) : (
            <li key={item.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border bg-muted">
              <a href={item.url ?? undefined} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- org asset served by /api/assets */}
                <img src={thumbnailUrl(item.url, 640)} alt={item.prompt} width={item.width} height={item.height} loading="lazy" className="h-auto w-full" />
              </a>
              <p className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {item.prompt}
              </p>
              <div className="absolute top-2 end-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <AnimateLink src={item.url} />
                <ReuseButton onClick={() => onReuse(item)} />
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function AnimateLink({ src }: { src: string | null }) {
  const t = useTranslations("Workspace.viewer");
  const href = src ? animateHref(src) : null;
  if (!href) return null;
  return (
    <Link href={href} className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/85">
      <Film className="size-3" aria-hidden />
      {t("animate")}
    </Link>
  );
}

function ReuseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const t = useTranslations("Studio");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/85", className)}
    >
      <CornerDownLeft className="size-3 rtl:-scale-x-100" aria-hidden />
      {t("usePrompt")}
    </button>
  );
}

function VideoCard({ item, onReuse }: { item: StudioItem; onReuse: () => void }) {
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
      <button type="button" onClick={onReuse} className="flex w-full items-center gap-1.5 border-t px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-muted">
        <CornerDownLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
        {t("usePrompt")}
      </button>
      {/* Opens the clip as a new video editor project (paid plans, like video itself). */}
      {item.status === "ok" && item.url && (
        <Link href={`/editor?clip=${item.url.split("/").pop()}`} className="flex items-center gap-1.5 border-t px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-muted">
          <Clapperboard className="size-3.5" aria-hidden />
          {t("editVideo")}
        </Link>
      )}
    </li>
  );
}
