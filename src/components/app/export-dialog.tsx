"use client";

import { useState } from "react";
import { ChevronDown, Download, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { GeneratedImage } from "@/lib/ai/types";

const formats = [
  { key: "PNG", mime: "image/png", ext: "png" },
  { key: "JPEG", mime: "image/jpeg", ext: "jpg" },
  { key: "WebP", mime: "image/webp", ext: "webp" },
] as const;
type FormatKey = (typeof formats)[number]["key"];

const qualities = [100, 95, 85, 75];
const scales = [1, 0.75, 0.5];

async function encodeImage(url: string, width: number, height: number, mime: string, quality: number) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), mime, quality / 100),
  );
}

export function ExportDialog({
  open,
  onOpenChange,
  image,
  filenameBase,
  aspectRatio,
  resolution,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: Pick<GeneratedImage, "url" | "width" | "height">;
  /** e.g. "SOFA-12345_lifestyle_v1"; the extension follows the chosen format. */
  filenameBase: string;
  aspectRatio: string;
  resolution: string;
  /** Persist to History; resolves true on success. Omit when the image is already saved. */
  onSave?: () => Promise<boolean>;
}) {
  const tw = useTranslations("Workspace");
  const [format, setFormat] = useState<FormatKey>("PNG");
  const [quality, setQuality] = useState(95);
  const [scale, setScale] = useState(1);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = formats.find((f) => f.key === format)!;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const filename = `${filenameBase}.${selected.ext}`;

  async function download() {
    setBusy(true);
    try {
      const blob = await encodeImage(image.url, width, height, selected.mime, quality);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSaved(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-[440px]">
        <div className="border-b px-6 py-5">
          <DialogTitle className="text-base font-bold">{tw("exportTitle")}</DialogTitle>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- provider output URL */}
            <img src={image.url} alt="" className="size-16 rounded-lg object-cover" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-semibold" dir="ltr">{filename}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {tw("exportMeta", { aspect: aspectRatio, resolution })}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold">{tw("exportFormat")}</span>
            <div role="radiogroup" aria-label={tw("exportFormat")} className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {formats.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={format === f.key}
                  onClick={() => setFormat(f.key)}
                  className={cn(
                    "rounded-md border border-transparent py-1.5 text-xs font-semibold text-muted-foreground",
                    format === f.key && "border-primary bg-accent text-primary",
                  )}
                >
                  {f.key}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label={tw("quality")}
              value={String(quality)}
              disabled={format === "PNG"}
              onChange={(v) => setQuality(Number(v))}
              options={qualities.map((q) => ({ value: String(q), label: `${q}%` }))}
            />
            <SelectField
              label={tw("scale")}
              value={String(scale)}
              onChange={(v) => setScale(Number(v))}
              options={scales.map((s) => ({
                value: String(s),
                label: `${Math.round(image.width * s)} × ${Math.round(image.height * s)}`,
              }))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          {onSave && (
            <Button
              variant="outline"
              disabled={saved || saving}
              onClick={async () => {
                setSaving(true);
                setSaved(await onSave());
                setSaving(false);
              }}
              className="h-9 px-4 text-[13px] font-semibold"
            >
              <Save aria-hidden />
              {saved ? tw("savedToLibrary") : tw("saveToLibrary")}
            </Button>
          )}
          <Button onClick={download} disabled={busy} className="h-9 px-4 text-[13px] font-semibold">
            <Download aria-hidden />
            {tw("download")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold">{label}</span>
      <span className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border bg-transparent py-1.5 ps-3 pe-8 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          dir="ltr"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
      </span>
    </label>
  );
}
