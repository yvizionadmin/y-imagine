"use client";

import { useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { motion } from "motion/react";

export const RECOLOR_SWATCHES = [
  { key: "original", color: null },
  { key: "sage", color: "#6f9a7a" },
  { key: "terracotta", color: "#c8643a" },
  { key: "navy", color: "#2c4f8f" },
  { key: "sand", color: "#c9a56b" },
] as const;

type SwatchKey = (typeof RECOLOR_SWATCHES)[number]["key"];

/** A light illustration of Recolor: a colour wash over a studio shot. The real tool repaints the product with AI. */
export function RecolorDemo({ alt, label, names }: { alt: string; label: string; names: Record<SwatchKey, string> }) {
  const [active, setActive] = useState<SwatchKey>("terracotta");
  const color = RECOLOR_SWATCHES.find((s) => s.key === active)?.color;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden rounded-3xl border bg-[#f3f3f3]">
        <Image src="/demo/sofa-grey-base.png" alt={alt} fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
        <div
          aria-hidden
          className="absolute inset-0 mix-blend-color transition-[background-color,opacity] duration-700"
          style={{ backgroundColor: color ?? "transparent", opacity: color ? 0.85 : 0 }}
        />
        <span aria-live="polite" className="absolute bottom-3 start-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {names[active]}
        </span>
      </div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2.5">
        {RECOLOR_SWATCHES.map(({ key, color: swatch }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active === key}
            aria-label={names[key]}
            title={names[key]}
            onClick={() => setActive(key)}
            className="relative flex size-11 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            {active === key && <motion.span layoutId="recolor-ring" aria-hidden className="absolute inset-0 rounded-full border-2 border-foreground" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
            <span className="flex size-8 items-center justify-center rounded-full border border-black/10 shadow-inner" style={{ background: swatch ?? "linear-gradient(135deg,#9a9a9a,#5f5f5f)" }}>
              {active === key && <Check className="size-4 text-white drop-shadow" aria-hidden />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
