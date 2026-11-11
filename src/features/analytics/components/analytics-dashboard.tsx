"use client";

import { PageHeader } from "@/components/app/page-header";
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { getAnalytics, type Analytics, type AnalyticsDay, type RecentItem } from "../actions";
import { ANALYTICS_RANGES, type AnalyticsRange } from "../config";
import { ActivityChart, Sparkline } from "./charts";
import { LoadingSkeleton } from "@/components/ui/skeleton";

const TOOL_HREF = { create: "/home", video: "/home?mode=video", generate: "/generate", recolor: "/recolor", aplus: "/aplus", looks: "/looks", upscale: "/history", copy: "/copy", chat: "/chat", agent: "/agents", voice: "/editor", music: "/editor", director: "/editor/director" } as const;

/** Analytics Overview (Figma analytics-dashboard 30:6, restyled to the light design). */
export function AnalyticsDashboard() {
  const t = useTranslations("Analytics");
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getAnalytics(range).then((next) => {
      if (!live) return;
      setData(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [range]);

  return (
    // Same 1200px column and padding as History; the padding centres it so the scrollbar stays at the page edge.
    <div className="flex w-full flex-col gap-6 overflow-y-auto p-4 md:px-[max(2rem,calc((100%-1200px)/2))] md:py-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div role="radiogroup" aria-label={t("range")} className="flex w-fit gap-1 rounded-lg border bg-background p-1">
        {ANALYTICS_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={range === r}
            onClick={() => {
              if (r === range) return;
              setLoading(true);
              setRange(r);
            }}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-semibold text-muted-foreground hover:bg-muted",
              range === r && "bg-accent text-primary hover:bg-accent",
            )}
          >
            {t("lastDays", { count: r, days: String(r) })}
          </button>
        ))}
      </div>

      {!data ? (
        <LoadingSkeleton variant="cards" className="p-4" />
      ) : (
        // Refetching keeps the previous render, dimmed, so the layout never jumps.
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <Kpis data={data} />

          <section className="flex flex-col gap-4 rounded-2xl border bg-background p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">{t("activityTitle", { count: data.range, days: String(data.range) })}</h2>
              <p className="text-[13px] text-muted-foreground">{t("activitySubtitle")}</p>
            </div>
            {data.kpis.jobs.value === 0 ? (
              <EmptyChart />
            ) : (
              <>
                <ActivityChart days={data.daily} />
                <DailyTable days={data.daily} />
              </>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <ToolBreakdown data={data} />
            <RecentActivity items={data.recent} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <CreditMeter used={data.credits.used} allocated={data.credits.allocated} />
            <TopCreators creators={data.creators} />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpis({ data }: { data: Analytics }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const { jobs, successRate, avgSeconds, creators } = data.kpis;
  const series = (pick: (d: AnalyticsDay) => number | null) => data.daily.map(pick);
  const period = t("vsPrevious", { count: data.range, days: String(data.range) });

  const pct = (v: number) => format.number(v, { ...LATN, style: "percent", maximumFractionDigits: 0 });
  const sec = (v: number) => t("seconds", { value: format.number(v, { ...LATN, maximumFractionDigits: 2 }) });
  const int = (v: number) => format.number(v, LATN);

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label={t("kpis.jobs")}
        value={int(jobs.value ?? 0)}
        delta={relative(jobs.value, jobs.previous, pct, t("new"))}
        upIsGood
        period={period}
        trend={series((d) => d.total)}
      />
      <Tile
        label={t("kpis.successRate")}
        value={successRate.value === null ? "—" : pct(successRate.value)}
        delta={
          successRate.value !== null && successRate.previous !== null
            ? signed((successRate.value - successRate.previous) * 100, (v) => t("points", { value: format.number(v, { ...LATN, maximumFractionDigits: 0 }) }))
            : null
        }
        upIsGood
        period={period}
        trend={series((d) => d.successRate)}
      />
      <Tile
        label={t("kpis.avgSpeed")}
        value={avgSeconds.value === null ? "—" : sec(avgSeconds.value)}
        delta={avgSeconds.value !== null && avgSeconds.previous !== null ? signed(avgSeconds.value - avgSeconds.previous, sec) : null}
        upIsGood={false}
        period={period}
        trend={series((d) => d.avgSeconds)}
      />
      <Tile
        label={t("kpis.creators")}
        value={int(creators.value ?? 0)}
        delta={creators.value !== null && creators.previous !== null ? signed(creators.value - creators.previous, int) : null}
        upIsGood
        period={period}
        trend={series((d) => d.creators)}
      />
    </div>
  );
}

type Delta = { text: string; direction: -1 | 0 | 1 } | null;

function signed(diff: number, fmt: (v: number) => string): Delta {
  const rounded = Math.round(diff * 100) / 100;
  if (rounded === 0) return { text: fmt(0), direction: 0 };
  return { text: `${rounded > 0 ? "+" : "−"}${fmt(Math.abs(rounded))}`, direction: rounded > 0 ? 1 : -1 };
}

function relative(value: number | null, previous: number | null, pct: (v: number) => string, fresh: string): Delta {
  if (value === null || previous === null) return null;
  if (previous === 0) return value > 0 ? { text: fresh, direction: 1 } : null;
  return signed((value - previous) / previous, pct);
}

function Tile({
  label,
  value,
  delta,
  upIsGood,
  period,
  trend,
}: {
  label: string;
  value: string;
  delta: Delta;
  upIsGood: boolean;
  period: string;
  trend: (number | null)[];
}) {
  const good = delta && delta.direction !== 0 ? (delta.direction > 0) === upIsGood : null;
  const Arrow = delta?.direction === -1 ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-background p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {delta && (
          <span
            title={period}
            className={cn(
              "flex items-center gap-0.5 text-xs font-semibold",
              good === null ? "text-muted-foreground" : good ? "text-emerald-700" : "text-danger",
            )}
          >
            {delta.direction !== 0 && <Arrow className="size-3.5 rtl:-scale-x-100" aria-hidden />}
            <span dir="ltr">{delta.text}</span>
            <span className="sr-only">{period}</span>
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-[28px] leading-none font-bold">{value}</span>
        <Sparkline values={trend} label={label} />
      </div>
    </div>
  );
}

function EmptyChart() {
  const t = useTranslations("Analytics");
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
      <p className="text-sm font-semibold">{t("emptyTitle")}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t("emptyBody")}</p>
      <Link href="/generate" className="text-xs font-semibold text-primary hover:underline">
        {t("emptyCta")}
      </Link>
    </div>
  );
}

/** The same numbers as the chart, for screen readers and anyone who prefers a table. */
function DailyTable({ days }: { days: AnalyticsDay[] }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer font-semibold text-primary">{t("showTable")}</summary>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border">
        <table className="w-full">
          <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("date")}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t("jobsLabel")}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t("failedLabel")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...days].reverse().map((d) => (
              <tr key={d.day} className="border-t">
                <td className="px-3 py-1.5">{format.dateTime(new Date(`${d.day}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC", numberingSystem: "latn" })}</td>
                <td className="px-3 py-1.5 text-end">{format.number(d.total, LATN)}</td>
                <td className="px-3 py-1.5 text-end">{format.number(d.failed, LATN)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Jobs by tool: horizontal bars (replaces the Figma donut; bars compare close values better). */
function ToolBreakdown({ data }: { data: Analytics }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const total = data.byFeature.reduce((sum, f) => sum + f.count, 0);
  const max = Math.max(1, ...data.byFeature.map((f) => f.count));
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-background p-6">
      <h2 className="text-base font-bold">{t("byToolTitle")}</h2>
      <ul className="flex flex-col gap-3.5">
        {data.byFeature.map(({ feature, count }) => (
          <li key={feature} className="grid grid-cols-[96px_1fr] items-center gap-3 text-[13px]">
            <Link href={TOOL_HREF[feature]} className="truncate text-muted-foreground hover:text-foreground">
              {t(`tools.${feature}`)}
            </Link>
            <div className="flex items-center gap-2">
              {count > 0 && <span className="h-3 rounded-e bg-primary" style={{ width: `${(count / max) * 80}%` }} />}
              <span className="shrink-0 font-semibold tabular-nums">
                {format.number(count, LATN)}
                {total > 0 && (
                  <span className="ms-1 font-normal text-muted-foreground">({format.number(count / total, { ...LATN, style: "percent", maximumFractionDigits: 0 })})</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentActivity({ items }: { items: RecentItem[] }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-background p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{t("recentTitle")}</h2>
        <Link href="/history" className="text-xs font-semibold text-primary hover:underline">
          {t("viewHistory")}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noRecent")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
              <img src={item.imageUrl} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-muted object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold">{item.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("recentLine", { by: item.by, tool: t(`tools.${item.tool}`) })}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px]">
                <span className="text-muted-foreground">{format.relativeTime(new Date(Math.min(Date.parse(item.at), now.getTime())), now)}</span>
                <RecentStatus status={item.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentStatus({ status }: { status: RecentItem["status"] }) {
  const t = useTranslations("Analytics");
  if (status === "uploaded")
    return (
      <span className="flex items-center gap-1 font-semibold text-emerald-700">
        <CircleCheck className="size-3" aria-hidden />
        {t("status.uploaded")}
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex items-center gap-1 font-semibold text-danger">
        <CircleAlert className="size-3" aria-hidden />
        {t("status.failed")}
      </span>
    );
  return <span className="font-semibold text-muted-foreground">{t(`status.${status}`)}</span>;
}

function CreditMeter({ used, allocated }: { used: number; allocated: number }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const share = allocated > 0 ? Math.min(1, used / allocated) : 0;
  const high = share >= 0.9;
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-background p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("creditsTitle")}</h2>
        <span className="text-xs font-medium text-muted-foreground">{t("allocated", { count: format.number(allocated, LATN) })}</span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={allocated}
        aria-valuenow={used}
        aria-label={t("creditsTitle")}
        className="h-2 overflow-hidden rounded-full bg-primary/15"
      >
        <div className={cn("h-full rounded-full", high ? "bg-amber-500" : "bg-primary")} style={{ width: `${share * 100}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{t("consumed", { count: format.number(used, LATN) })}</span>
        <span className={cn("flex items-center gap-1 font-semibold", high ? "text-amber-700" : "text-foreground")}>
          {high && <TriangleAlert className="size-3.5" aria-hidden />}
          {t("utilized", { value: format.number(share, { ...LATN, style: "percent", maximumFractionDigits: 0 }) })}
        </span>
      </div>
      <p className="text-[11px] text-subtle">{t("creditsNote")}</p>
    </section>
  );
}

function TopCreators({ creators }: { creators: Analytics["creators"] }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-background p-5">
      <h2 className="text-sm font-semibold">{t("creatorsTitle")}</h2>
      {creators.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noCreators")}</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {creators.map((c) => (
            <li key={c.name} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted p-2">
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold">{c.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {t("creatorJobs", { count: c.jobs, display: format.number(c.jobs, LATN) })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
