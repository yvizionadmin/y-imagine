"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { ActivityChart } from "@/features/analytics/components/charts";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { getAdminOverview, type AdminOverview as Overview } from "../actions";
import { AuditList } from "./admin-audit";
import { Card, PageHeader, StatTile } from "./admin-ui";

/** Platform health at a glance: tenants, users, job volume and failures across every org. */
export function AdminOverview() {
  const t = useTranslations("Admin");
  const tTools = useTranslations("Shell.nav");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [data, setData] = useState<Overview | null>(null);
  const n = (v: number) => format.number(v, LATN);

  useEffect(() => {
    getAdminOverview(30).then((r) => r.ok && setData(r.data));
  }, []);

  if (!data) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" aria-hidden />;
  const { totals, jobs, settings } = data;
  const failRate = jobs.total ? jobs.failed / jobs.total : 0;
  const maxFeature = Math.max(1, ...data.byFeature.map((f) => f.count));

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <PageHeader title={t("overview.title")} subtitle={t("overview.subtitle")} />

      {(settings.maintenance.enabled || settings.disabledFeatures.length > 0 || !settings.signupsEnabled) && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-credits-border bg-credits px-4 py-3 text-[13px] text-credits-foreground">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {settings.maintenance.enabled && <span className="font-semibold">{t("overview.maintenanceOn")}</span>}
          {!settings.signupsEnabled && <span>{t("overview.signupsOff")}</span>}
          {settings.disabledFeatures.length > 0 && (
            <span>{t("overview.featuresOff", { list: settings.disabledFeatures.map((f) => tTools(f)).join(", ") })}</span>
          )}
          <Link href="/admin/controls" className="ms-auto font-semibold underline">
            {t("overview.manage")}
          </Link>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("overview.orgs")}
          value={n(totals.orgs)}
          detail={totals.suspendedOrgs ? t("overview.suspendedCount", { count: totals.suspendedOrgs, display: n(totals.suspendedOrgs) }) : t("overview.allActive")}
          tone={totals.suspendedOrgs ? "warn" : undefined}
        />
        <StatTile
          label={t("overview.users")}
          value={n(totals.users)}
          detail={t("overview.usersDetail", { sessions: n(totals.activeSessions), admins: n(totals.superAdmins) })}
        />
        <StatTile label={t("overview.jobs")} value={n(jobs.total)} detail={t("overview.activeOrgs", { count: jobs.activeOrgs, display: n(jobs.activeOrgs) })} />
        <StatTile
          label={t("overview.failureRate")}
          value={format.number(failRate, { ...LATN, style: "percent", maximumFractionDigits: 1 })}
          detail={t("overview.failedCount", { count: jobs.failed, display: n(jobs.failed) })}
          tone={failRate > 0.1 ? "warn" : undefined}
        />
      </div>

      <Card title={t("overview.activity")}>
        <ActivityChart days={data.daily} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("overview.byTool")}>
          <ul className="flex flex-col gap-3.5">
            {data.byFeature.map(({ feature, count, failed }) => (
              <li key={feature} className="grid grid-cols-[96px_1fr] items-center gap-3 text-[13px]">
                <span className="truncate text-muted-foreground">{tTools(feature)}</span>
                <div className="flex items-center gap-2">
                  {count > 0 && <span className="h-3 rounded-e bg-primary" style={{ width: `${(count / maxFeature) * 75}%` }} />}
                  <span className="shrink-0 font-semibold tabular-nums">{n(count)}</span>
                  {failed > 0 && <span className="text-[11px] text-danger">{t("overview.failedCount", { count: failed, display: n(failed) })}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("overview.topOrgs")} action={<Link href="/admin/organizations" className="text-xs font-semibold text-primary hover:underline">{t("viewAll")}</Link>}>
          {data.topOrgs.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("overview.noJobs")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {data.topOrgs.map((o, i) => (
                <li key={o.id} className="flex items-center gap-3 text-[13px]">
                  <span className="w-4 text-subtle tabular-nums">{n(i + 1)}</span>
                  <Link href={`/admin/organizations/${o.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                    {o.name}
                  </Link>
                  <span className="tabular-nums">{t("jobsCount", { count: o.jobs, display: n(o.jobs) })}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title={t("overview.recentErrors")} action={<Link href="/admin/activity?status=failed" className="text-xs font-semibold text-primary hover:underline">{t("viewAll")}</Link>}>
          {data.errors.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("overview.noErrors")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.errors.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px] first:pt-0 last:pb-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">
                      {e.orgName} · {tTools(e.feature)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {e.userName} · {format.relativeTime(new Date(e.at), now)}
                    </span>
                  </span>
                  <code className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-danger">{e.error ?? "error"}</code>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("overview.recentAudit")} action={<Link href="/admin/activity" className="text-xs font-semibold text-primary hover:underline">{t("viewAll")}</Link>}>
          <AuditList entries={data.audit} />
        </Card>
      </div>
    </div>
  );
}
