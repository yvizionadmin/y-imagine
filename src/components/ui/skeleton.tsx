"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";

/** A grey placeholder shape while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-muted motion-reduce:animate-none", className)} />;
}

/**
 * What a page or section looks like while it loads (U5), in place of a lone spinner: `list` rows, `cards` in a grid,
 * or a `page` (heading, then rows). Announced once as "Loading".
 */
export function LoadingSkeleton({ variant = "list", count, className }: { variant?: "list" | "cards" | "page"; count?: number; className?: string }) {
  const t = useTranslations("Shell");
  const n = count ?? (variant === "cards" ? 6 : 4);
  return (
    <div role="status" aria-label={t("loading")} className={cn("flex w-full flex-col gap-3", className)}>
      {variant === "page" && (
        <div className="flex flex-col gap-2 pb-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      )}
      {variant === "cards" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        Array.from({ length: n }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-background p-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className={cn("h-3.5", ["w-3/5", "w-1/2", "w-2/3", "w-2/5"][i % 4])} />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
