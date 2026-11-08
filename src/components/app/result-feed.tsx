"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, History } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { listToolFeed } from "@/features/history/actions";
import type { GenerationMode, HistoryItem } from "@/features/history/types";
import { ImageActions, ImageViewer, type ViewerImage } from "@/components/app/image-viewer";
import { Link } from "@/i18n/navigation";
import { feedTurns, promptOf } from "@/lib/feed-turns";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

// A tool's results feed, Gemini-style: every result is saved to History, and the tool lists the user's own
// earlier results above the current job, oldest at the top. Results made together (one job, one SKU and
// prompt, a few minutes apart) read as one turn: the prompt as a bubble, then its images.

/**
 * A tool's results feed. Opened from the Tools menu it starts empty and collects what is made during this visit;
 * opened from History ("Open in tool", `?from=<id>&sku=`) it also brings that product's earlier results, and
 * `origin` (the result opened) so the tool can put its prompt back. New Job remounts the tool, clearing it.
 */
export function useToolFeed(mode: GenerationMode) {
  const params = useSearchParams();
  const from = params.get("from");
  const fromSku = params.get("sku") ?? undefined;
  const [loaded, setLoaded] = useState<HistoryItem[]>([]);
  const [sessionIds, setSessionIds] = useState<string[]>([]);

  const load = useCallback(
    (sku?: string) => {
      listToolFeed(mode, sku)
        .then((list) => setLoaded((prev) => mergeById(prev, list)))
        .catch(() => {});
    },
    [mode],
  );
  useEffect(() => {
    if (from) load(fromSku);
  }, [from, fromSku, load]);

  const origin = (from && loaded.find((item) => item.id === from)) || null;
  const items = loaded.filter((item) => sessionIds.includes(item.id) || (origin !== null && item.sku === origin.sku));

  /** A result was just saved: show it in the feed (once it is no longer the current job). */
  const track = useCallback(
    (id: string) => {
      setSessionIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      load();
    },
    [load],
  );
  return { items, origin, track };
}

function mergeById(prev: HistoryItem[], next: HistoryItem[]) {
  const byId = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ResultFeed({
  items,
  hideIds = [],
  onReuse,
}: {
  items: HistoryItem[];
  /** The current job's saved results: they show in the canvas below, not twice. */
  hideIds?: string[];
  /** Puts a turn's prompt back in the prompt box. */
  onReuse?: (prompt: string) => void;
}) {
  const t = useTranslations("Workspace.feed");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const tv = useTranslations("Workspace.viewer");
  const [viewing, setViewing] = useState<ViewerImage | null>(null);
  const viewerImage = (item: HistoryItem): ViewerImage => ({ src: item.imageUrl, alt: item.title || item.sku, name: `${item.sku}_${item.mode}`, sku: item.sku, mode: item.mode });
  const ref = useRef<HTMLElement>(null);
  const shown = items.filter((item) => !hideIds.includes(item.id));
  const hasItems = shown.length > 0;

  // Open on the latest results, like a chat.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!hasItems || scrolled.current) return;
    scrolled.current = true;
    const main = ref.current?.closest("main");
    main?.scrollTo({ top: main.scrollHeight });
  }, [hasItems]);

  if (!hasItems) return null;

  return (
    <section ref={ref} data-feed="" aria-label={t("label")} className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-8 pb-2">
      <ol className="flex flex-col gap-10">
        {feedTurns(shown).map((turn) => {
          const first = turn[0];
          const prompt = promptOf(first);
          const meta = [first.sku, prompt ? first.title : null, [first.settings.aspectRatio, first.settings.resolution].filter(Boolean).join(" · ")].filter(Boolean);
          return (
            <li key={first.id} className="flex flex-col gap-3">
              <div className="flex justify-end">
                <div className="group/prompt flex max-w-[85%] flex-col gap-1 rounded-2xl rounded-ee-md bg-muted px-4 py-2.5">
                  <p dir="auto" className="text-sm leading-relaxed whitespace-pre-line">
                    {prompt || first.title}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span dir="auto">{meta.join(" · ")}</span>
                    {onReuse && prompt && (
                      <button type="button" onClick={() => onReuse(prompt)} className="flex items-center gap-1 font-semibold text-primary hover:underline">
                        <CornerDownLeft className="size-3 rtl:-scale-x-100" aria-hidden />
                        {t("reuse")}
                      </button>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {turn.map((item) => (
                  <figure key={item.id} className="group relative overflow-hidden rounded-2xl border bg-background shadow-sm">
                    <button type="button" onClick={() => setViewing(viewerImage(item))} aria-label={`${tv("open")}: ${item.title || item.sku}`} className="block cursor-zoom-in">
                      {/* eslint-disable-next-line @next/next/no-img-element -- stored asset, served by /api/assets */}
                      <img
                        src={thumbnailUrl(item.imageUrl, 640)}
                        alt={item.title || item.sku}
                        width={item.width || undefined}
                        height={item.height || undefined}
                        loading="lazy"
                        className="block h-auto max-h-80 w-auto max-w-full object-contain"
                      />
                    </button>
                    <div className="absolute end-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <ImageActions image={viewerImage(item)} onUpscaled={setViewing} />
                      <Link
                        href="/history"
                        aria-label={t("openHistory")}
                        title={t("openHistory")}
                        className="flex size-9 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur hover:text-primary"
                      >
                        <History className="size-4" aria-hidden />
                      </Link>
                    </div>
                  </figure>
                ))}
              </div>
              <time dateTime={first.createdAt} className="text-[11px] text-muted-foreground">
                {format.relativeTime(new Date(first.createdAt), now)}
              </time>
            </li>
          );
        })}
      </ol>
      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
