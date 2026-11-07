"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { ImageActions, ImageViewer, type ViewerImage } from "@/components/app/image-viewer";

/**
 * The results area: top/bottom overlay slots and the content. A generated image (`img[data-result]`) opens in a
 * full-window viewer (zoom, download, share) when clicked, and gets Open / Download / Share in the corner.
 */
export function CanvasShell({ top, bottom, children }: { top?: ReactNode; bottom?: ReactNode; children: ReactNode }) {
  const t = useTranslations("Workspace.viewer");
  const contentRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<ViewerImage | null>(null);
  const [viewing, setViewing] = useState<ViewerImage | null>(null);

  // Which generated image is showing (it changes as jobs finish and shots are picked).
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const read = () => {
      const img = content.querySelector<HTMLImageElement>("img[data-result]");
      const next = img ? { src: img.src, alt: img.alt, name: img.alt || "image" } : null;
      setResult((current) => (current?.src === next?.src ? current : next));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative flex min-h-[20rem] min-w-0 shrink-0 grow items-center justify-center overflow-hidden bg-canvas p-10">
      {top && <div className="absolute top-10 left-1/2 z-10 -translate-x-1/2">{top}</div>}

      <div
        ref={contentRef}
        className="flex flex-col items-center gap-5 [&_img[data-result]]:cursor-zoom-in"
        onClick={(e) => {
          const img = e.target instanceof HTMLImageElement && e.target.matches("[data-result]") ? e.target : null;
          if (img) setViewing({ src: img.src, alt: img.alt, name: img.alt || "image" });
        }}
      >
        {children}
      </div>

      {bottom && <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">{bottom}</div>}

      {result && (
        <div className="absolute end-6 bottom-6 z-10 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("open")}
            title={t("open")}
            onClick={() => setViewing(result)}
            className="flex size-9 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur hover:text-primary"
          >
            <Maximize className="size-4" aria-hidden />
          </button>
          <ImageActions image={result} onUpscaled={setViewing} />
        </div>
      )}

      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

export function CanvasEmptyState({ icon, title, body, placeholder = true }: { icon: ReactNode; title: string; body: string; placeholder?: boolean }) {
  return (
    <div data-empty-state={placeholder ? "" : undefined} className="flex w-[480px] max-w-full flex-col items-center gap-3 text-center">
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
