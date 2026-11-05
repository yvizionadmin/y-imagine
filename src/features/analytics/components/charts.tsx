"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LATN } from "@/lib/format";
import type { AnalyticsDay } from "../actions";
import { JOB_FEATURES } from "../config";

// Hand-drawn SVG charts (no chart library). One series each, in the brand accent; grid and axes in
// the border/muted tokens. Time runs left to right in both directions, so the plots are dir="ltr"
// while their labels stay in the page direction.

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis max with 4 even steps (0 / 5 / 10 / 15 / 20). */
function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(value / 4)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= value)!;
  return nice * 4;
}

const parseDay = (key: string) => new Date(`${key}T12:00:00Z`);

/** KPI sparkline: de-emphasised trend, current value as an accent end-dot. */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const W = 80;
  const H = 32;
  const points = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (points.length < 2) return <span className="h-8 w-20" aria-hidden />;
  const max = Math.max(...points.map((p) => p[1]));
  const min = Math.min(...points.map((p) => p[1]));
  const x = (i: number) => 4 + (i / (values.length - 1)) * (W - 8);
  const y = (v: number) => (max === min ? H / 2 : H - 4 - ((v - min) / (max - min)) * (H - 8));
  const d = points.map(([i, v], n) => `${n ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [li, lv] = points[points.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="var(--subtle)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r={3} fill="var(--primary)" stroke="var(--background)" strokeWidth={1.5} />
    </svg>
  );
}

/** Daily jobs line + area wash, with a crosshair tooltip (pointer and keyboard). */
export function ActivityChart({ days }: { days: AnalyticsDay[] }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const H = 220;
  const pad = { top: 12, right: 12, bottom: 28, left: 36 };
  const max = niceMax(Math.max(0, ...days.map((d) => d.total)));
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join("");
  const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 1, 2, 3, 4].map((n) => (max / 4) * n);
  const labelEvery = Math.ceil(days.length / 6);
  const short = (key: string) => format.dateTime(parseDay(key), { month: "short", day: "numeric", timeZone: "UTC", numberingSystem: "latn" });
  const last = days.length - 1;

  function pick(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - box.left) / box.width;
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))));
  }
  function key(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? last) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last) - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else return;
    e.preventDefault();
  }

  const shown = active !== null ? days[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0;

  return (
    <div ref={wrapRef} className="relative h-[220px] w-full" dir="ltr">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={t("activityAria", { count: days.length, days: String(days.length) })}
          tabIndex={0}
          onKeyDown={key}
          onFocus={() => setActive((a) => a ?? last)}
          onBlur={() => setActive(null)}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {format.number(v, { ...LATN, maximumFractionDigits: 1 })}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === last ? (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
                {short(d.day)}
              </text>
            ) : null,
          )}
          <path d={area} fill="var(--primary)" fillOpacity={0.1} />
          <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last)} cy={y(days[last].total)} r={4} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />
          {active !== null && (
            <>
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} stroke="var(--muted-foreground)" strokeWidth={1} />
              <circle cx={x(active)} cy={y(days[active].total)} r={4} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />
            </>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={pick}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {shown && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 w-[168px] -translate-x-1/2 rounded-lg border bg-background px-3 py-2 text-[11px] shadow-md"
          style={{ left: tipLeft }}
        >
          <Tooltip day={shown} />
        </div>
      )}
    </div>
  );
}

function Tooltip({ day }: { day: AnalyticsDay }) {
  const t = useTranslations("Analytics");
  const format = useFormatter();
  const n = (v: number) => format.number(v, LATN);
  return (
    <div className="flex flex-col gap-1" dir="auto">
      <span className="text-muted-foreground">
        {format.dateTime(parseDay(day.day), { dateStyle: "medium", timeZone: "UTC", numberingSystem: "latn" })}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{n(day.total)}</span>
        <span className="text-muted-foreground">{t("jobsLabel")}</span>
      </span>
      {JOB_FEATURES.filter((f) => day.byFeature[f] > 0).map((f) => (
        <span key={f} className="flex justify-between gap-2">
          <span className="font-semibold">{n(day.byFeature[f])}</span>
          <span className="text-muted-foreground">{t(`tools.${f}`)}</span>
        </span>
      ))}
      {day.failed > 0 && (
        <span className="flex justify-between gap-2">
          <span className="font-semibold">{n(day.failed)}</span>
          <span className="text-muted-foreground">{t("failedLabel")}</span>
        </span>
      )}
    </div>
  );
}
