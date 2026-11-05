"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";

const MIN_ZOOM = 25;
const MAX_ZOOM = 200;

/** Right-hand canvas: top/bottom overlay slots, zoomable content, and the zoom/fullscreen control. */
export function CanvasShell({ top, bottom, children }: { top?: ReactNode; bottom?: ReactNode; children: ReactNode }) {
  const t = useTranslations("Workspace");
  const canvasRef = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(100);

  return (
    <section ref={canvasRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-canvas p-10">
      {top && <div className="absolute top-10 left-1/2 z-10 -translate-x-1/2">{top}</div>}

      <div className="flex flex-col items-center gap-5 transition-transform" style={{ transform: `scale(${zoom / 100})` }}>
        {children}
      </div>

      {bottom && <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">{bottom}</div>}

      <div className="absolute end-6 bottom-6 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-[0_4px_6px_rgba(0,0,0,0.05)]">
        <ZoomButton label={t("zoomOut")} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 10))}>
          <Minus className="size-4" aria-hidden />
        </ZoomButton>
        <span className="w-11 text-center font-mono text-xs font-semibold" dir="ltr">
          {zoom}%
        </span>
        <ZoomButton label={t("zoomIn")} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 10))}>
          <Plus className="size-4" aria-hidden />
        </ZoomButton>
        <span className="h-4 w-px bg-border" />
        <ZoomButton
          label={t("fullscreen")}
          onClick={() =>
            document.fullscreenElement ? document.exitFullscreen() : canvasRef.current?.requestFullscreen()
          }
        >
          <Maximize className="size-4" aria-hidden />
        </ZoomButton>
      </div>
    </section>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex items-center rounded-lg border px-2.5 py-1.5 hover:bg-muted">
      {children}
    </button>
  );
}

export function CanvasEmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex w-[480px] max-w-full flex-col items-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-[13px] leading-normal text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export function ImageFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border bg-background shadow-[0_8px_24px_rgba(0,0,0,0.08)]", className)}>
      {children}
    </div>
  );
}

export function StatusPill({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {children}
    </div>
  );
}

export function ImageBadge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-lg border bg-white/85 px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export function CompareSlider({
  before,
  after,
  beforeBadge,
  afterBadge,
  className = "h-[480px] w-[640px]",
}: {
  before: string;
  after: string;
  beforeBadge: ReactNode;
  afterBadge: ReactNode;
  className?: string;
}) {
  const t = useTranslations("Workspace");
  const [position, setPosition] = useState(50);
  const frameRef = useRef<HTMLDivElement>(null);

  const moveTo = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    // Images are not mirrored in RTL, so the comparison keeps physical left/right.
    <div
      ref={frameRef}
      dir="ltr"
      className={cn(
        "relative max-w-full touch-none overflow-hidden rounded-2xl border bg-background shadow-[0_8px_24px_rgba(0,0,0,0.08)] select-none",
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- generated output / local preview */}
      <img src={after} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
        <img src={before} alt="" className="absolute inset-0 size-full bg-background object-cover" />
      </div>
      <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary" style={{ left: `${position}%` }}>
        <button
          type="button"
          role="slider"
          aria-label={t("dragCompare")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 5));
            if (e.key === "ArrowRight") setPosition((p) => Math.min(100, p + 5));
          }}
          className="absolute top-1/2 left-1/2 flex size-8 -translate-1/2 items-center justify-center gap-0.5 rounded-full border-2 border-primary bg-white text-primary shadow-[0_2px_4px_rgba(0,0,0,0.12)]"
        >
          <ChevronLeft className="size-3" strokeWidth={3} aria-hidden />
          <ChevronRight className="size-3" strokeWidth={3} aria-hidden />
        </button>
      </div>
      <div className="absolute top-4 left-4">{beforeBadge}</div>
      <div className="absolute top-4 right-4">{afterBadge}</div>
    </div>
  );
}
