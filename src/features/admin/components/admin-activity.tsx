"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { JOB_FEATURES } from "@/features/analytics/config";
import { LATN } from "@/lib/format";
import { getAdminActivity, type AdminJob } from "../actions";
import { AuditList } from "./admin-audit";
import { Card, filterSelectClass, PageHeader, StatusBadge, Table, td, th } from "./admin-ui";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type Tab = "jobs" | "audit";
type Status = "all" | "ok" | "failed";
type Data = Extract<Awaited<ReturnType<typeof getAdminActivity>>, { ok: true }>;

/** Monitoring: every job and every audited action across orgs, newest first. */
export function AdminActivity() {
  const t = useTranslations("Admin");
  const tTools = useTranslations("Shell.nav");
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "audit" ? "audit" : "jobs");
  const [orgId, setOrgId] = useState(params.get("org") ?? "");
  const [status, setStatus] = useState<Status>(params.get("status") === "failed" ? "failed" : "all");
  const [feature, setFeature] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    getAdminActivity({ orgId, status, feature }).then((r) => {
      if (!live) return;
      if (r.ok) setData(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [orgId, status, feature, tick]);

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <PageHeader title={t("activity.title")} subtitle={t("activity.subtitle")}>
        <Button
          variant="outline"
          onClick={() => {
            setLoading(true);
            setTick((n) => n + 1);
          }}
          className="h-9 px-3 text-[13px] font-semibold"
        >
          <RefreshCw className={cn(loading && "animate-spin")} aria-hidden />
          {t("refresh")}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t("activity.title")} className="flex gap-1 rounded-lg border bg-background p-1">
          {(["jobs", "audit"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn("rounded-md px-3 py-1.5 text-[13px] font-semibold text-muted-foreground", tab === value && "bg-accent text-primary")}
            >
              {t(`activity.tabs.${value}`)}
            </button>
          ))}
        </div>
        <select aria-label={t("organization")} value={orgId} onChange={(e) => setOrgId(e.target.value)} className={filterSelectClass}>
          <option value="">{t("allOrgs")}</option>
          {data?.orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {tab === "jobs" && (
          <>
            <select aria-label={t("status")} value={status} onChange={(e) => setStatus(e.target.value as Status)} className={filterSelectClass}>
              <option value="all">{t("allStatuses")}</option>
              <option value="ok">{t("jobStatus.ok")}</option>
              <option value="failed">{t("jobStatus.failed")}</option>
            </select>
            <select aria-label={t("activity.tool")} value={feature} onChange={(e) => setFeature(e.target.value)} className={filterSelectClass}>
              <option value="all">{t("activity.allTools")}</option>
              {JOB_FEATURES.map((f) => (
                <option key={f} value={f}>
                  {tTools(f)}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {!data ? (
        <LoadingSkeleton variant="list" className="p-4" />
      ) : tab === "jobs" ? (
        <Jobs jobs={data.jobs} />
      ) : (
        <Card title={t("activity.tabs.audit")}>
          <AuditList entries={data.audit} />
        </Card>
      )}
    </div>
  );
}

function Jobs({ jobs }: { jobs: AdminJob[] }) {
  const t = useTranslations("Admin");
  const tTools = useTranslations("Shell.nav");
  const format = useFormatter();
  return (
    <Table
      minWidth={900}
      head={
        <tr>
          {(["time", "org", "tool", "user", "provider", "duration", "status"] as const).map((c) => (
            <th key={c} scope="col" className={th}>
              {t(`activity.columns.${c}`)}
            </th>
          ))}
        </tr>
      }
    >
      {jobs.length === 0 && (
        <tr>
          <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
            {t("noMatches")}
          </td>
        </tr>
      )}
      {jobs.map((j) => (
        <tr key={j.id} className="border-b last:border-b-0">
          <td className={`${td} whitespace-nowrap text-muted-foreground tabular-nums`}>
            {format.dateTime(new Date(j.at), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
          </td>
          <td className={`${td} font-semibold`}>{j.orgName}</td>
          <td className={td}>{tTools(j.feature as (typeof JOB_FEATURES)[number])}</td>
          <td className={td}>{j.userName}</td>
          <td className={`${td} text-muted-foreground`} dir="ltr">
            {j.provider}
            {j.model && <span className="text-[11px]"> · {j.model}</span>}
          </td>
          <td className={`${td} tabular-nums`}>{format.number(j.durationMs / 1000, { ...LATN, maximumFractionDigits: 1 })}s</td>
          <td className={td}>
            {j.ok ? <StatusBadge tone="ok">{t("jobStatus.ok")}</StatusBadge> : <StatusBadge tone="off">{j.error ?? t("jobStatus.failed")}</StatusBadge>}
          </td>
        </tr>
      ))}
    </Table>
  );
}
