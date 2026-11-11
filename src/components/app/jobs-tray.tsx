"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CircleAlert, CircleCheck, Loader2, X } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTray } from "@/features/tray/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { JOBS_EVENT } from "@/lib/jobs-events";
import type { TrayItem, TrayState } from "@/lib/tray";

/** Poll quickly while something runs, slowly otherwise; never while the tab is hidden. */
const BUSY_MS = 5_000;
const IDLE_MS = 30_000;
const NOTICE_MS = 10_000;
const key = (item: TrayItem) => `${item.kind}:${item.id}`;

/**
 * The top bar's jobs tray (U4): a bell with the number of running jobs, a list of running and recently finished
 * work, and a notice when one of yours finishes while you're elsewhere in the app.
 */
export function JobsTray() {
  const t = useTranslations("Shell.tray");
  const router = useRouter();
  const pathname = usePathname();
  const [tray, setTray] = useState<TrayState | null>(null);
  const [notices, setNotices] = useState<TrayItem[]>([]);
  /** Finished work already shown (or finished before this page opened): no notice for it. */
  const notified = useRef<Set<string> | null>(null);

  const apply = useCallback(
    (next: TrayState) => {
      setTray(next);
      if (notified.current === null) {
        notified.current = new Set(next.finished.map(key));
        return;
      }
      const fresh = next.finished.filter((item) => !notified.current!.has(key(item)));
      if (!fresh.length) return;
      for (const item of fresh) notified.current.add(key(item));
      setNotices((list) => [...fresh, ...list].slice(0, 3));
      router.refresh(); // finished work used credits
    },
    [router],
  );

  // Check on load, on each page change, when a screen starts a job, and on a timer.
  const busy = (tray?.running.length ?? 0) > 0;
  useEffect(() => {
    const load = () => void getTray().then(apply, () => {});
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, busy ? BUSY_MS : IDLE_MS);
    // A screen just started a job: show it now, not at the next check.
    window.addEventListener(JOBS_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(JOBS_EVENT, load);
    };
  }, [apply, busy, pathname]);

  const dismiss = (item: TrayItem) => setNotices((list) => list.filter((n) => key(n) !== key(item)));
  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(() => setNotices((list) => list.slice(0, -1)), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notices]);

  const running = tray?.running.length ?? 0;
  return (
    <>
      <Popover>
        <PopoverTrigger
          aria-label={t("button", { count: running })}
          title={t("button", { count: running })}
          className="relative flex size-9 items-center justify-center rounded-full hover:bg-white/10 data-popup-open:bg-white/10"
        >
          <Bell className="size-4" aria-hidden />
          {running > 0 && (
            <span aria-hidden className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground">
              {running}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-80 max-w-[calc(100vw-1.5rem)] gap-0 p-0 font-sans">
          <TrayList tray={tray} />
        </PopoverContent>
      </Popover>
      <div role="status" aria-live="polite" className="pointer-events-none fixed end-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {notices.map((item) => (
          <Notice key={key(item)} item={item} onDismiss={() => dismiss(item)} />
        ))}
      </div>
    </>
  );
}

function TrayList({ tray }: { tray: TrayState | null }) {
  const t = useTranslations("Shell.tray");
  if (!tray) return <Loader2 className="m-6 mx-auto size-5 animate-spin text-muted-foreground" aria-label={t("loading")} />;
  if (!tray.running.length && !tray.finished.length) return <p className="p-5 text-center text-xs text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="flex max-h-[70vh] flex-col overflow-y-auto py-2">
      {tray.running.length > 0 && <Group title={t("running")} items={tray.running} />}
      {tray.finished.length > 0 && <Group title={t("finished")} items={tray.finished} />}
    </div>
  );
}

function Group({ title, items }: { title: string; items: TrayItem[] }) {
  return (
    <section className="flex flex-col">
      <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">{title}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={key(item)}>
            <Row item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ item }: { item: TrayItem }) {
  const t = useTranslations("Shell.tray");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const n = (v: number) => format.number(v, LATN);
  const when = format.relativeTime(new Date(Math.min(Date.parse(item.at), now.getTime())), now);
  const pct = item.progress && item.progress.total > 0 ? Math.round((item.progress.done / item.progress.total) * 100) : null;
  const detail =
    item.kind === "publish" && item.progress
      ? t("uploading", { count: item.progress.total, display: n(item.progress.total) })
      : item.state === "working"
        ? item.progress
          ? t("progress", { done: n(item.progress.done), total: n(item.progress.total) })
          : t("started", { when })
        : `${t(`states.${item.state}`)} · ${when}`;
  return (
    <Link href={item.href} className="flex items-start gap-3 px-4 py-2 hover:bg-muted">
      <StateIcon state={item.state} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-semibold text-muted-foreground">{t(`kinds.${item.kind}`)}</span>
        {item.title && (
          <span dir="auto" className="truncate text-start text-[13px] font-medium">
            {item.title}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">{detail}</span>
        {item.state === "working" && pct !== null && item.kind !== "publish" && (
          <span aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
    </Link>
  );
}

function StateIcon({ state, className }: { state: TrayItem["state"]; className?: string }) {
  if (state === "working") return <Loader2 className={cn("size-4 shrink-0 animate-spin text-primary", className)} aria-hidden />;
  if (state === "failed") return <CircleAlert className={cn("size-4 shrink-0 text-danger", className)} aria-hidden />;
  return <CircleCheck className={cn("size-4 shrink-0 text-emerald-600", className)} aria-hidden />;
}

function Notice({ item, onDismiss }: { item: TrayItem; onDismiss: () => void }) {
  const t = useTranslations("Shell.tray");
  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
      <StateIcon state={item.state} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 font-sans">
        <p className="text-[13px] font-semibold">{t(item.state === "failed" ? "noticeFailed" : "noticeDone", { kind: t(`kinds.${item.kind}`) })}</p>
        {item.title && (
          <p dir="auto" className="truncate text-start text-xs text-muted-foreground">
            {item.title}
          </p>
        )}
        <Link href={item.href} onClick={onDismiss} className="w-fit text-xs font-semibold text-primary hover:underline">
          {t("open")}
        </Link>
      </div>
      <button type="button" onClick={onDismiss} aria-label={t("dismiss")} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
