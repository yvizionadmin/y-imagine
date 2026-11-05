"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ResizeFit } from "../presets";

const BOX_W = 300;
const BOX_H = 216;

function fitInside(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / w, maxH / h);
  return { width: w * scale, height: h * scale };
}

/**
 * Live crop preview (Figma 35:1096): for crop it shows the whole source with the kept area framed and
 * the rest dimmed; for pad/stretch it shows the target canvas with the image placed as the output will be.
 * Geometry is physical (image pixels don't mirror in RTL), hence dir="ltr".
 */
export function ResizePreview({
  src,
  source,
  target,
  fit,
}: {
  src: string;
  source: { width: number; height: number } | null;
  target: { width: number; height: number };
  fit: ResizeFit;
}) {
  const t = useTranslations("Resize");
  if (!source) return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />;

  const ratio = target.width / target.height;
  const badge = (
    <span className="absolute start-1.5 top-1.5 rounded bg-primary px-2 py-1 font-mono text-[10px] font-bold text-primary-foreground">
      {t("dimensions", { width: String(target.width), height: String(target.height) })}
    </span>
  );

  if (fit === "crop") {
    const shown = fitInside(source.width, source.height, BOX_W, BOX_H);
    const crop =
      source.width / source.height > ratio
        ? { width: shown.height * ratio, height: shown.height }
        : { width: shown.width, height: shown.width / ratio };
    return (
      <div dir="ltr" className="relative overflow-hidden" style={shown}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img src={src} alt="" className="size-full" />
        <div
          className="absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(15,23,42,0.5)]"
          style={{ ...crop, left: (shown.width - crop.width) / 2, top: (shown.height - crop.height) / 2 }}
        >
          <ThirdsGrid />
          {badge}
        </div>
      </div>
    );
  }

  return (
    <div dir="ltr" className="relative border border-primary bg-white" style={fitInside(target.width, target.height, BOX_W, BOX_H)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      <img src={src} alt="" className={fit === "pad" ? "size-full object-contain" : "size-full object-fill"} />
      <ThirdsGrid />
      {badge}
    </div>
  );
}

function ThirdsGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {["33.333%", "66.666%"].map((at) => (
        <span key={`v${at}`} className="absolute inset-y-0 w-px bg-white/60" style={{ left: at }} />
      ))}
      {["33.333%", "66.666%"].map((at) => (
        <span key={`h${at}`} className="absolute inset-x-0 h-px bg-white/60" style={{ top: at }} />
      ))}
    </div>
  );
}
