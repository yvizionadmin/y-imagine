"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import type { AuditEntry } from "@/lib/audit";

/** Audit rows as "<actor> <action> <target> · org · time". Meta is shown verbatim (never secrets). */
export function AuditList({ entries, showOrg = true }: { entries: (AuditEntry & { orgName?: string | null })[]; showOrg?: boolean }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  if (entries.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{t("noActivity")}</p>;
  return (
    <ul className="flex flex-col divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 py-2.5 text-[13px] first:pt-0 last:pb-0">
          <span>
            <span className="font-semibold">{e.actor}</span> {t(`actions.${e.action}`)}{" "}
            <span className="font-semibold" dir="auto">
              {e.target}
            </span>
          </span>
          <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            {showOrg && <span>{e.orgName ?? t("platform")}</span>}
            <span>{format.relativeTime(new Date(e.at), now)}</span>
            {e.meta &&
              Object.entries(e.meta).map(([k, v]) => (
                <span key={k} dir="ltr">
                  {k}: {v}
                </span>
              ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
