"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { zipSync } from "fflate";
import {
  Camera,
  ChevronDown,
  Download,
  ImagePlus,
  Loader2,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { ConfigPanel, PanelBody, PanelFooter, PanelHeader, RequiredTag, Section } from "@/components/app/config-panel";
import { Button } from "@/components/ui/button";
import { LATN } from "@/lib/format";
import {
  RESIZE_FORMATS,
  RESIZE_INPUT_TYPES,
  RESIZE_MAX_BYTES,
  RESIZE_MAX_FILES,
  RESIZE_MAX_SIDE,
  RESIZE_MIN_SIDE,
  RESIZE_PLATFORMS,
  RESIZE_QUALITY,
  isResizeSide,
  type ResizeFit,
  type ResizeFormat,
  type ResizePlatform,
  type ResizeSize,
  type ResizeSizeKey,
} from "../presets";
import { ResizePreview } from "./resize-preview";

const PLATFORM_ICONS: Record<ResizePlatform, LucideIcon> = {
  amazon: ShoppingBag,
  shopify: ShoppingCart,
  instagram: Camera,
  custom: Settings,
};
const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
const CONCURRENCY = 2;

type Output = { key: string; url: string; blob: Blob; width: number; height: number };
type QueueItem = {
  id: string;
  file: File;
  url: string;
  source: { width: number; height: number } | null;
  sizeKey: ResizeSizeKey;
  result: Output | null;
  /** Job key of the last failed attempt; a settings change makes the row Queued again. */
  failedKey: string | null;
};
type Status = "queued" | "processing" | "done" | "failed";

/** Batch Image Resize, in the shared prompt dock (Platform / Output chips, queue + preview as results). Not an AI job. */
export function ResizeWorkspace() {
  const t = useTranslations("Resize");
  const format = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [platform, setPlatform] = useState<ResizePlatform>("amazon");
  const [custom, setCustom] = useState({ width: "1200", height: "1200" });
  const [quality, setQuality] = useState<number>(RESIZE_QUALITY.default);
  const [outputFormat, setOutputFormat] = useState<ResizeFormat>("webp");
  const [preserve, setPreserve] = useState(true);
  const [cropFit, setCropFit] = useState<Exclude<ResizeFit, "stretch">>("crop");

  // Object URLs live outside React state's lifecycle; revoke whatever is left on unmount.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.url);
        if (item.result) URL.revokeObjectURL(item.result.url);
      }
    },
    [],
  );

  const sizes: readonly ResizeSize[] = RESIZE_PLATFORMS[platform];
  const customSize = { key: "custom" as const, width: Number(custom.width), height: Number(custom.height) };
  const customValid = isResizeSide(customSize.width) && isResizeSide(customSize.height);
  const fit: ResizeFit = preserve ? cropFit : "stretch";

  const sizeFor = (item: QueueItem): ResizeSize =>
    platform === "custom" ? customSize : (sizes.find((s) => s.key === item.sizeKey) ?? sizes[0]);
  const outputMime = (item: QueueItem) => (outputFormat === "original" ? item.file.type : `image/${outputFormat}`);
  const usesQuality = (item: QueueItem) => outputMime(item) !== "image/png";
  const jobKey = (item: QueueItem) => {
    const size = sizeFor(item);
    return [size.width, size.height, fit, outputFormat, usesQuality(item) ? quality : ""].join("|");
  };
  const statusOf = (item: QueueItem): Status =>
    processing.has(item.id)
      ? "processing"
      : item.result?.key === jobKey(item)
        ? "done"
        : item.failedKey === jobKey(item)
          ? "failed"
          : "queued";

  const done = items.filter((i) => statusOf(i) === "done");
  const pending = items.filter((i) => statusOf(i) === "queued" || statusOf(i) === "failed");
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const qualityDisabled = outputFormat === "png" || (selected !== null && !usesQuality(selected));
  const seconds = Math.max(
    1,
    Math.ceil(pending.reduce((sum, i) => sum + 0.4 + ((i.source?.width ?? 2000) * (i.source?.height ?? 2000)) / 1e6 * 0.08, 0)),
  );

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const accepted = files.filter((f) => (RESIZE_INPUT_TYPES as readonly string[]).includes(f.type) && f.size > 0 && f.size <= RESIZE_MAX_BYTES);
    const room = RESIZE_MAX_FILES - items.length;
    const added = accepted.slice(0, Math.max(0, room)).map(
      (file): QueueItem => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        source: null,
        sizeKey: platform === "custom" ? "custom" : sizes[0].key,
        result: null,
        failedKey: null,
      }),
    );

    const messages = [];
    if (accepted.length < files.length) messages.push(t("rejected", { count: files.length - accepted.length, display: num(files.length - accepted.length) }));
    if (accepted.length > added.length) messages.push(t("limit", { max: num(RESIZE_MAX_FILES) }));
    setNotice(messages.length ? messages.join(" ") : null);
    if (!added.length) return;

    setItems((current) => [...current, ...added]);
    for (const item of added) {
      const img = new Image();
      img.onload = () =>
        setItems((current) =>
          current.map((i) => (i.id === item.id ? { ...i, source: { width: img.naturalWidth, height: img.naturalHeight } } : i)),
        );
      img.src = item.url;
    }
  }

  function remove(item: QueueItem) {
    URL.revokeObjectURL(item.url);
    if (item.result) URL.revokeObjectURL(item.result.url);
    setItems((current) => current.filter((i) => i.id !== item.id));
  }

  function choosePlatform(next: ResizePlatform) {
    setPlatform(next);
    const first = next === "custom" ? "custom" : RESIZE_PLATFORMS[next][0].key;
    setItems((current) => current.map((i) => ({ ...i, sizeKey: first })));
  }

  async function resizeOne(item: QueueItem) {
    const size = sizeFor(item);
    const key = jobKey(item);
    setProcessing((current) => new Set(current).add(item.id));
    let output: Output | null = null;
    try {
      const body = new FormData();
      body.set("file", item.file);
      body.set("width", String(size.width));
      body.set("height", String(size.height));
      body.set("fit", fit);
      body.set("format", outputFormat);
      body.set("quality", String(quality));
      const response = await fetch("/api/resize", { method: "POST", body });
      if (response.ok) {
        const blob = await response.blob();
        output = {
          key,
          blob,
          url: URL.createObjectURL(blob),
          width: Number(response.headers.get("x-image-width")),
          height: Number(response.headers.get("x-image-height")),
        };
      }
    } catch {
      // Network failure: the row shows Failed and the next Resize All retries it.
    }

    const current = itemsRef.current.find((i) => i.id === item.id);
    if (!current) {
      if (output) URL.revokeObjectURL(output.url);
    } else {
      if (output && current.result) URL.revokeObjectURL(current.result.url);
      setItems((list) =>
        list.map((i) => (i.id !== item.id ? i : output ? { ...i, result: output, failedKey: null } : { ...i, failedKey: key })),
      );
    }
    setProcessing((list) => {
      const next = new Set(list);
      next.delete(item.id);
      return next;
    });
  }

  async function resizeAll() {
    const queue = [...pending];
    setRunning(true);
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) await resizeOne(item);
      }),
    );
    setRunning(false);
  }

  function outputName(item: QueueItem, output: Output, taken: Set<string>) {
    const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = EXT[output.blob.type] ?? "img";
    let name = `${base}_${output.width}x${output.height}.${ext}`;
    for (let n = 2; taken.has(name); n++) name = `${base}_${output.width}x${output.height}-${n}.${ext}`;
    taken.add(name);
    return name;
  }

  async function downloadZip() {
    const taken = new Set<string>();
    const entries = await Promise.all(
      done.map(async (item) => [outputName(item, item.result!, taken), new Uint8Array(await item.result!.blob.arrayBuffer())] as const),
    );
    // Images are already compressed; store them as-is.
    const zip = zipSync(Object.fromEntries(entries), { level: 0 });
    saveBlob(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `resized_${new Date().toISOString().slice(0, 10)}.zip`);
  }

  // Numbers go in pre-formatted: ICU would otherwise pick Arabic-Indic digits on the server only.
  const num = (value: number) => format.number(value, { ...LATN, useGrouping: false });
  const mb = (bytes: number) => format.number(bytes / 1024 / 1024, { ...LATN, maximumFractionDigits: 1 });
  const kb = (bytes: number) =>
    bytes < 1024 * 1024 ? t("kb", { size: format.number(bytes / 1024, { ...LATN, maximumFractionDigits: 0 }) }) : t("mb", { size: mb(bytes) });

  const PlatformIcon = PLATFORM_ICONS[platform];
  const platformSummary =
    platform === "custom" ? t("dimensions", { width: custom.width || "?", height: custom.height || "?" }) : t(`platforms.${platform}`);
  const outputSummary = [t(`formats.${outputFormat}`), qualityDisabled ? null : format.number(quality / 100, { ...LATN, style: "percent" })]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* The prompt dock: images in, then the platform and output chips; ↑ resizes the queue. */}
      <ConfigPanel tool="resize" onSubmit={() => void resizeAll()}>
        <PanelHeader title={t("title")} />
        <PanelBody disabled={running}>
          <input
            ref={inputRef}
            type="file"
            accept={RESIZE_INPUT_TYPES.join(",")}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={items.length >= RESIZE_MAX_FILES}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-dashed border-input bg-muted/40 px-4 py-3 text-start hover:border-primary/60 disabled:opacity-50"
            >
              <UploadCloud className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{items.length ? t("addImages") : t("dropTitle")}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("dropHint", { size: mb(RESIZE_MAX_BYTES), max: num(RESIZE_MAX_FILES) })}
                </span>
              </span>
            </button>
          </div>
          {notice && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {notice}
            </p>
          )}

          <Section
            title={t("platformChip")}
            summary={platformSummary}
            icon={<PlatformIcon className="size-3.5 shrink-0" aria-hidden />}
            aside={platform === "custom" && !customValid ? <RequiredTag /> : undefined}
          >
            <span id="resize-platform" className="sr-only">
              {t("platformPreset")}
            </span>
            <div role="radiogroup" aria-labelledby="resize-platform" className="flex flex-wrap gap-3">
              {(Object.keys(RESIZE_PLATFORMS) as ResizePlatform[]).map((key) => {
                const Icon = PLATFORM_ICONS[key];
                const active = platform === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choosePlatform(key)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-full border bg-background px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted",
                      active && "border-primary bg-accent font-bold text-primary hover:bg-accent",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {t(`platforms.${key}`)}
                  </button>
                );
              })}
            </div>
            {platform === "custom" && (
              <div className="flex items-center gap-2" dir="ltr">
                <SideInput label={t("width")} value={custom.width} onChange={(width) => setCustom((c) => ({ ...c, width }))} />
                <span className="text-xs text-muted-foreground">×</span>
                <SideInput label={t("height")} value={custom.height} onChange={(height) => setCustom((c) => ({ ...c, height }))} />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            )}
            {platform === "custom" && !customValid && (
              <p role="alert" className="text-[11px] text-danger">
                {t("customRange", { min: num(RESIZE_MIN_SIDE), max: num(RESIZE_MAX_SIDE) })}
              </p>
            )}
          </Section>

          <Section title={t("outputChip")} summary={outputSummary} icon={<Settings className="size-3.5 shrink-0" aria-hidden />}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="resize-quality" className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t("quality")}</span>
                <span className="font-bold text-primary">{qualityDisabled ? "—" : format.number(quality / 100, { ...LATN, style: "percent" })}</span>
              </label>
              <input
                id="resize-quality"
                type="range"
                min={RESIZE_QUALITY.min}
                max={RESIZE_QUALITY.max}
                value={quality}
                disabled={qualityDisabled}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="h-4 w-full accent-primary disabled:opacity-40"
              />
              {qualityDisabled && <p className="text-[11px] text-subtle">{t("qualityPng")}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="resize-format" className="text-xs text-muted-foreground">
                {t("format")}
              </label>
              <div className="relative flex items-center">
                <select
                  id="resize-format"
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value as ResizeFormat)}
                  className="h-11 w-full appearance-none rounded-lg border bg-background ps-3 pe-9 text-[13px] outline-none focus-visible:border-ring"
                >
                  {RESIZE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`formats.${f}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute end-3 size-3.5 text-muted-foreground" aria-hidden />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span id="resize-preserve" className="text-[13px] font-semibold">
                {t("preserveAspect")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={preserve}
                aria-labelledby="resize-preserve"
                onClick={() => setPreserve((p) => !p)}
                className={cn("relative h-5 w-10 shrink-0 rounded-full transition-colors", preserve ? "bg-primary" : "bg-muted-foreground/30")}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white shadow transition-[inset-inline-start]",
                    preserve ? "start-[22px]" : "start-0.5",
                  )}
                />
              </button>
            </div>
            {preserve ? (
              <div role="radiogroup" aria-label={t("fitMode")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(["crop", "pad"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={cropFit === f}
                    onClick={() => setCropFit(f)}
                    className={cn(
                      "h-8 rounded-md text-xs font-semibold text-muted-foreground",
                      cropFit === f && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    {t(`fits.${f}`)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-subtle">{t("stretchNote")}</p>
            )}
          </Section>
        </PanelBody>
        <PanelFooter
          note={items.length === 0 ? t("emptyQueue") : pending.length === 0 && !running ? t("allDone") : t("estimate", { seconds, display: num(seconds) })}
          actions={
            <Button type="button" variant="outline" onClick={downloadZip} disabled={done.length === 0} className="h-9 rounded-full px-3 text-xs font-semibold">
              <Download aria-hidden />
              {t("downloadZip")}
            </Button>
          }
          submitLabel={running ? t("resizing") : t("resizeAll")}
          canSubmit={pending.length > 0 && !(platform === "custom" && !customValid)}
          busy={running}
          onReset={() => {
            for (const item of items) {
              URL.revokeObjectURL(item.url);
              if (item.result) URL.revokeObjectURL(item.result.url);
            }
            setItems([]);
            setNotice(null);
          }}
        />
      </ConfigPanel>

      {/* Results: the queue and a live preview of the selected image; drop files anywhere here. */}
      <section
        aria-labelledby="resize-queue"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn("flex min-h-[16rem] min-w-0 shrink-0 grow flex-col gap-6 bg-canvas p-6 sm:p-8", dragging && "bg-accent/40")}
      >
        {items.length === 0 ? (
          <div data-empty-state="" className="mx-auto flex w-[480px] max-w-full flex-col items-center gap-3 pt-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
              <ImagePlus className="size-8" strokeWidth={1.5} aria-hidden />
            </div>
            <h2 id="resize-queue" className="text-lg font-bold">
              {t("title")}
            </h2>
            <p className="text-[13px] leading-normal text-muted-foreground">{t("subtitle")}</p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border bg-background p-5">
              <h2 id="resize-queue" className="text-base font-bold">
                {t("queueTitle", { count: items.length, display: num(items.length) })}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {items.map((item) => {
                  const status = statusOf(item);
                  const size = sizeFor(item);
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-xl border p-3 transition-colors",
                        selected?.id === item.id ? "border-primary bg-accent/40" : "hover:bg-muted/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        aria-pressed={selected?.id === item.id}
                        className="flex min-w-0 flex-1 items-center gap-4 text-start"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                        <img src={item.url} alt="" className="size-12 shrink-0 rounded-lg bg-muted object-cover" />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-sm font-bold" dir="ltr">
                            {item.file.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("original", {
                              size: item.source ? t("dimensions", { width: String(item.source.width), height: String(item.source.height) }) : "…",
                            })}
                            {" · "}
                            {kb(item.file.size)}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-4">
                        <label className="relative flex items-center">
                          <span className="sr-only">{t("targetSize", { name: item.file.name })}</span>
                          <select
                            value={size.key}
                            disabled={platform === "custom"}
                            onChange={(e) =>
                              setItems((current) =>
                                current.map((i) => (i.id === item.id ? { ...i, sizeKey: e.target.value as ResizeSizeKey } : i)),
                              )
                            }
                            className="h-8 appearance-none rounded-lg border bg-background ps-3 pe-8 text-xs font-semibold text-muted-foreground outline-none focus-visible:border-ring disabled:opacity-100"
                          >
                            {(platform === "custom" ? [customSize] : sizes).map((s) => (
                              <option key={s.key} value={s.key}>
                                {t("sizeOption", {
                                  size: t("dimensions", { width: String(s.width), height: String(s.height) }),
                                  name: t(`sizes.${s.key}`),
                                })}
                              </option>
                            ))}
                          </select>
                          {platform !== "custom" && (
                            <ChevronDown className="pointer-events-none absolute end-2.5 size-3 text-muted-foreground" aria-hidden />
                          )}
                        </label>
                        <StatusBadge status={status} />
                        <div className="flex gap-1.5">
                          {status === "done" && (
                            <IconButton
                              label={t("downloadOne", { name: item.file.name })}
                              onClick={() => saveBlob(item.result!.blob, outputName(item, item.result!, new Set()))}
                            >
                              <Download className="size-3.5" aria-hidden />
                            </IconButton>
                          )}
                          <IconButton label={t("remove", { name: item.file.name })} onClick={() => remove(item)} disabled={status === "processing"}>
                            <Trash2 className="size-3.5" aria-hidden />
                          </IconButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <aside className="flex w-full shrink-0 flex-col gap-4 rounded-2xl border bg-background p-5 lg:w-[360px]">
              <h2 className="text-[15px] font-bold">{t("previewTitle")}</h2>
          <div className="flex h-[240px] items-center justify-center overflow-hidden rounded-xl border bg-muted/60">
            {selected ? (
              <ResizePreview
                src={selected.url}
                source={selected.source}
                target={sizeFor(selected)}
                fit={fit}
              />
            ) : (
              <p className="px-6 text-center text-xs text-muted-foreground">{t("previewEmpty")}</p>
            )}
          </div>
          {selected && statusOf(selected) === "done" && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {t("outputReady", {
                size: t("dimensions", { width: String(selected.result!.width), height: String(selected.result!.height) }),
                bytes: kb(selected.result!.blob.size),
              })}
            </p>
          )}
            </aside>
          </div>
        )}
      </section>
    </>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations("Resize");
  const tone = {
    queued: "bg-amber-50 text-amber-700",
    processing: "bg-accent text-primary",
    done: "bg-emerald-50 text-emerald-700",
    failed: "bg-red-50 text-danger",
  }[status];
  return (
    <span className={cn("inline-flex w-[92px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold", tone)}>
      {status === "processing" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {t(`status.${status}`)}
    </span>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SideInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={RESIZE_MIN_SIDE}
      max={RESIZE_MAX_SIDE}
      aria-label={label}
      aria-invalid={!isResizeSide(Number(value))}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-20 rounded-lg border bg-background px-2 text-center font-mono text-xs outline-none focus-visible:border-ring aria-invalid:border-[#ef4444]"
    />
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
