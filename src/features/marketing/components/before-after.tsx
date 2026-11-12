"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";

type Shot = { src: string; alt: string };

/** Sweep path for the first look: out to the "after", back over the "before", home to the middle. */
const INTRO = [50, 82, 18, 50];
const INTRO_MS = 2600;

/** Ease in-out between the intro stops, t in 0..1. */
export function introPosition(t: number) {
  const span = INTRO.length - 1;
  const at = Math.min(Math.max(t, 0), 1) * span;
  const i = Math.min(Math.floor(at), span - 1);
  const local = at - i;
  const eased = local < 0.5 ? 2 * local * local : 1 - (-2 * local + 2) ** 2 / 2;
  return INTRO[i] + (INTRO[i + 1] - INTRO[i]) * eased;
}

/**
 * Drag (or hover, or arrow keys) to compare two images. A native range input drives it, so keyboards,
 * touch and screen readers work without extra code. Images compare left to right in both languages.
 */
export function BeforeAfter({
  before,
  after,
  labels,
  priority,
  sizes,
  className,
}: {
  before: Shot;
  after: Shot;
  labels: { before: string; after: string; slider: string };
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const [pos, setPos] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  useEffect(() => {
    const el = frame.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now() + 500;
        const step = (now: number) => {
          if (touched.current) return;
          const t = (now - start) / INTRO_MS;
          if (t >= 0) setPos(introPosition(t));
          if (t < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  function take(value: number) {
    touched.current = true;
    setPos(Math.min(100, Math.max(0, value)));
  }

  function hover(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    take(((event.clientX - box.left) / box.width) * 100);
  }

  const rounded = Math.round(pos);
  return (
    <div
      ref={frame}
      dir="ltr"
      onPointerMove={hover}
      className={cn(
        "group relative overflow-hidden select-none has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
        className,
      )}
    >
      <Image src={after.src} alt={after.alt} fill priority={priority} sizes={sizes} className="object-cover" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <Image src={before.src} alt={before.alt} fill priority={priority} sizes={sizes} className="scale-110 object-cover" />
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_24px_rgba(255,255,255,.6)]" style={{ insetInlineStart: `${pos}%` }}>
        <span className="absolute top-1/2 start-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-black/30 text-white shadow-lg backdrop-blur-md transition-transform group-active:scale-90">
          <ChevronLeft className="size-4" />
          <ChevronRight className="-ms-1 size-4" />
        </span>
      </div>

      <span
        aria-hidden
        className="pointer-events-none absolute top-3 start-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white uppercase backdrop-blur transition-opacity"
        style={{ opacity: pos > 14 ? 1 : 0 }}
      >
        {labels.before}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute top-3 end-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-black uppercase backdrop-blur transition-opacity"
        style={{ opacity: pos < 86 ? 1 : 0 }}
      >
        {labels.after}
      </span>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={rounded}
        aria-label={labels.slider}
        aria-valuetext={`${labels.before} ${rounded}%`}
        onChange={(event) => take(Number(event.target.value))}
        onPointerDown={() => (touched.current = true)}
        className="absolute inset-0 size-full cursor-ew-resize touch-pan-y opacity-0"
      />
    </div>
  );
}
