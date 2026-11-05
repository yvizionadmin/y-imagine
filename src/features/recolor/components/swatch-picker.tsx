"use client";

import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dropzone, FileActions, HiddenFileInput } from "@/components/app/upload-inputs";
import type { SwatchAnalysis } from "@/lib/ai/types";

export type SwatchState =
  | { status: "analyzing" }
  | { status: "ready"; analysis: SwatchAnalysis }
  | { status: "error" };

const ACCEPT = "image/png,image/jpeg,image/webp";

/** "natural_beige-linen.png" → "Natural Beige Linen" */
export function swatchDisplayName(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function SwatchPicker({
  title,
  file,
  preview,
  state,
  onChange,
}: {
  /** Dropzone title; it names the sample the category needs (fabric swatch, finish sample…). */
  title: string;
  file: File | null;
  preview: string | null;
  state: SwatchState | null;
  onChange: (file: File | null) => void;
}) {
  const t = useTranslations("Recolor");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!file || !preview) {
    return (
      <Dropzone
        accept={ACCEPT}
        onFile={onChange}
        title={title}
        hint={t("swatchUploadHint")}
        className="h-24"
      />
    );
  }

  const hex = state?.status === "ready" ? state.analysis.hex : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted p-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img src={preview} alt="" className="size-11 shrink-0 rounded-full object-cover" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{swatchDisplayName(file.name)}</span>
          <span className="text-[10px] text-[#6b7280]" aria-live="polite">
            {state?.status === "analyzing" && (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                {t("analyzing")}
              </span>
            )}
            {state?.status === "ready" && t(`finish.${state.analysis.finish}`)}
            {state?.status === "error" && <span className="text-[#ef4444]">{t("analysisFailed")}</span>}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-3.5 rounded-[3px] border" style={{ backgroundColor: hex ?? "transparent" }} />
          <span dir="ltr">{t("colorMap", { hex: hex ?? "—" })}</span>
        </span>
        <FileActions onReplace={() => inputRef.current?.click()} onRemove={() => onChange(null)} />
      </div>
      <HiddenFileInput inputRef={inputRef} accept={ACCEPT} onChange={onChange} />
    </div>
  );
}
