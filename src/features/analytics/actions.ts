"use server";

import { listGenerations, type GenerationMode } from "@/lib/generations";
import { listLooks } from "@/lib/looks/looks";
import { assetUrl } from "@/lib/storage/assets";
import { dayKey, lastDays, startOfDay, startOfMonth } from "@/lib/time";
import { creatorKey, creditsOf, listUsage, type UsageEvent } from "@/lib/usage";
import { getWorkspace } from "@/lib/workspace";
import { ANALYTICS_RANGES, JOB_FEATURES, type AnalyticsRange, type JobFeature } from "./config";


type Comparison = { value: number | null; previous: number | null };

export type AnalyticsDay = {
  day: string;
  total: number;
  failed: number;
  byFeature: Record<JobFeature, number>;
  successRate: number | null;
  avgSeconds: number | null;
  creators: number;
};
export type RecentItem = {
  id: string;
  tool: JobFeature;
  title: string;
  sku: string | null;
  by: string;
  at: string;
  imageUrl: string;
  status: "saved" | "board" | "uploaded" | "failed";
};

export type Analytics = {
  range: AnalyticsRange;
  daily: AnalyticsDay[];
  kpis: { jobs: Comparison; successRate: Comparison; avgSeconds: Comparison; creators: Comparison };
  byFeature: { feature: JobFeature; count: number }[];
  creators: { name: string; jobs: number }[];
  recent: RecentItem[];
  credits: { used: number; allocated: number };
};

const MODE_TOOL: Record<GenerationMode, JobFeature> = { create: "create", video: "video", lifestyle: "generate", recolor: "recolor", aplus: "aplus" };
const isJob = (e: UsageEvent): e is UsageEvent & { feature: JobFeature } => (JOB_FEATURES as readonly string[]).includes(e.feature);

function summarize(events: UsageEvent[]) {
  const ok = events.filter((e) => e.ok);
  return {
    jobs: events.length,
    successRate: events.length ? ok.length / events.length : null,
    avgSeconds: ok.length ? ok.reduce((sum, e) => sum + e.durationMs, 0) / ok.length / 1000 : null,
    creators: new Set(events.map(creatorKey)).size,
  };
}

export async function getAnalytics(rangeInput: number): Promise<Analytics> {
  const workspace = await getWorkspace({ read: true });
  const range: AnalyticsRange = (ANALYTICS_RANGES as readonly number[]).includes(rangeInput) ? (rangeInput as AnalyticsRange) : 30;
  const now = new Date();
  const days = lastDays(range * 2, now);
  const previousStart = startOfDay(days[0]);
  const currentStart = startOfDay(days[range]);
  const monthStart = startOfMonth(now);

  const since = previousStart < monthStart ? previousStart : monthStart;
  const [events, generations, looks] = await Promise.all([
    listUsage(workspace.orgId, since).then((all) => all.filter(isJob)),
    listGenerations(workspace.orgId),
    listLooks(workspace.orgId),
  ]);

  const current = events.filter((e) => new Date(e.at) >= currentStart);
  const previous = events.filter((e) => new Date(e.at) >= previousStart && new Date(e.at) < currentStart);
  const a = summarize(current);
  const b = summarize(previous);

  const byDay = new Map<string, UsageEvent[]>(days.slice(range).map((day) => [day, []]));
  for (const e of current) byDay.get(dayKey(new Date(e.at)))?.push(e);
  const daily = [...byDay].map(([day, list]): AnalyticsDay => {
    const stats = summarize(list);
    const byFeature = Object.fromEntries(JOB_FEATURES.map((f) => [f, 0])) as Record<JobFeature, number>;
    for (const e of list) byFeature[e.feature as JobFeature]++;
    return {
      day,
      total: list.length,
      failed: list.filter((e) => !e.ok).length,
      byFeature,
      successRate: stats.successRate,
      avgSeconds: stats.avgSeconds,
      creators: stats.creators,
    };
  });

  const perCreator = new Map<string, { name: string; jobs: number }>();
  for (const e of current) perCreator.set(creatorKey(e), { name: e.userName, jobs: (perCreator.get(creatorKey(e))?.jobs ?? 0) + 1 });

  const recent: RecentItem[] = [
    ...generations.map((g): RecentItem => ({
      id: g.id,
      tool: MODE_TOOL[g.mode],
      title: g.title || g.sku,
      sku: g.sku,
      by: g.createdBy,
      at: g.createdAt,
      imageUrl: assetUrl(g.assetId),
      status: g.status === "uploaded" ? "uploaded" : g.status === "failed" ? "failed" : "saved",
    })),
    ...looks.map((l): RecentItem => ({
      id: l.id,
      tool: "looks",
      title: l.title,
      sku: l.items[0]?.sku ?? null,
      by: l.createdBy,
      at: l.updatedAt ?? l.createdAt,
      imageUrl: assetUrl(l.resultAssetId),
      status: l.isBoard ? "board" : "saved",
    })),
  ]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 5);

  return {
    range,
    daily,
    kpis: {
      jobs: { value: a.jobs, previous: b.jobs },
      successRate: { value: a.successRate, previous: b.successRate },
      avgSeconds: { value: a.avgSeconds, previous: b.avgSeconds },
      creators: { value: a.creators, previous: b.creators },
    },
    byFeature: JOB_FEATURES.map((feature) => ({ feature, count: current.filter((e) => e.feature === feature).length })).sort(
      (x, y) => y.count - x.count,
    ),
    creators: [...perCreator.values()].sort((x, y) => y.jobs - x.jobs).slice(0, 4),
    recent,
    // Failed jobs don't consume credits.
    credits: { used: creditsOf(events.filter((e) => new Date(e.at) >= monthStart)), allocated: workspace.creditsMonthly },
  };
}
