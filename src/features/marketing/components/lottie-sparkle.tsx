"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { cn } from "cn";
import sparkle from "../lottie/sparkle.json";

// The player loads after the page, so it never delays the first paint.
const Lottie = dynamic(() => import("lottie-react").then((m) => m.LottieLight), { ssr: false, loading: () => null });

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const query = matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Brand sparkles (Lottie). A still icon before the player loads and for reduced motion. */
export function LottieSparkle({ className }: { className?: string }) {
  const animate = useSyncExternalStore(subscribe, () => !matchMedia(REDUCED).matches, () => false);
  return (
    <span aria-hidden className={cn("relative inline-flex items-center justify-center", className)}>
      {animate ? <Lottie src={sparkle} loop autoplay className="size-full" /> : <Sparkles className="size-3/5 text-primary" />}
    </span>
  );
}
