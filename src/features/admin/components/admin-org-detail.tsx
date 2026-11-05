"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActivityChart } from "@/features/analytics/components/charts";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { ROLES, type Role } from "@/lib/team/roles";
import {
  addAdminOrgMember,
  changeAdminOrgMemberRole,
  getAdminOrg,
  removeAdminOrgMember,
  setAdminOrgStatus,
  type AdminOrgDetail as Detail,
} from "../actions";
import { AuditList } from "./admin-audit";
import { EditOrgDialog } from "./admin-organizations";
import { Card, NoticeBar, StatTile, StatusBadge, Table, td, th, type Notice } from "./admin-ui";

export function AdminOrgDetail({ id }: { id: string }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [data, setData] = useState<Detail | null | "missing">(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const n = (v: number) => format.number(v, LATN);

  const refresh = useCallback(async () => {
    const r = await getAdminOrg(id);
    setData(r.ok ? r.data : "missing");
  }, [id]);
  useEffect(() => {
    getAdminOrg(id).then((r) => setData(r.ok ? r.data : "missing"));
  }, [id]);

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    const r = await action;
    setNotice(r.ok ? { tone: "ok", text: success } : { tone: "error", text: t(`errors.${r.error}`) });
    refresh();
  }

  if (data === null) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" aria-hidden />;
  if (data === "missing")
    return (
      <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <p className="font-semibold">{t("orgs.notFound")}</p>
        <Link href="/admin/organizations" className="text-xs font-semibold text-primary hover:underline">
          {t("orgs.back")}
        </Link>
      </div>
    );

  const { org } = data;
  const suspended = org.status === "suspended";

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <Link href="/admin/organizations" className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
        {t("orgs.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold">{org.name}</h1>
            <StatusBadge tone={suspended ? "off" : "ok"}>{t(`orgStatus.${org.status}`)}</StatusBadge>
            <StatusBadge tone="brand">{t(`plans.${org.plan}`)}</StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            <span dir="ltr">{org.id}</span> · {t("createdBy", { by: org.createdBy, when: format.relativeTime(new Date(org.createdAt), now) })}
          </p>
          {suspended && org.suspendedReason && <p className="text-xs text-danger">{t("orgs.reason", { reason: org.suspendedReason })}</p>}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setEditing(true)} className="h-10 px-4 text-[13px] font-semibold">
            {t("orgs.edit")}
          </Button>
          <Button
            variant={suspended ? "default" : "destructive"}
            className="h-10 px-4 text-[13px] font-bold"
            onClick={() => {
              if (suspended) return run(setAdminOrgStatus(org.id, false), t("orgs.reactivated", { name: org.name }));
              const reason = window.prompt(t("orgs.suspendPrompt", { name: org.name }));
              if (reason !== null) run(setAdminOrgStatus(org.id, true, reason), t("orgs.suspended", { name: org.name }));
            }}
          >
            {t(suspended ? "orgs.reactivate" : "orgs.suspend")}
          </Button>
        </div>
      </div>

      <NoticeBar notice={notice} />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("orgs.creditsThisMonth")}
          value={`${n(org.creditsUsed)} / ${n(org.creditsMonthly)}`}
          detail={org.creditsOverride !== null ? t("orgs.custom") : t("creditsPerMonth", { display: n(org.creditsMonthly) })}
          tone={org.creditsUsed >= org.creditsMonthly ? "warn" : undefined}
        />
        <StatTile label={t("orgs.columns.members")} value={n(org.members)} detail={org.invites ? t("orgs.invites", { count: org.invites, display: n(org.invites) }) : t("orgs.noInvites")} />
        <StatTile
          label={t("orgs.aiKeys")}
          value={n(data.keys.length)}
          detail={data.keys.some((k) => k.status === "invalid") ? t("orgs.keysInvalid") : data.keys.length ? t("orgs.keysOk") : t("orgs.keysNone")}
          tone={data.keys.some((k) => k.status === "invalid") ? "warn" : undefined}
        />
        <StatTile
          label={t("orgs.stores")}
          value={n(data.connections.length)}
          detail={(data.connections.find((c) => c.isDefault) ?? data.connections[0])?.name ?? t("orgs.storesNone")}
        />
      </div>

      <Card title={t("orgs.usage30")}>
        <ActivityChart days={data.daily} />
      </Card>

      <Members orgId={org.id} members={data.members} onRun={run} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("orgs.aiKeys")}>
          {data.keys.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("orgs.keysNone")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.keys.map((k) => (
                <li key={k.provider} className="flex items-center justify-between gap-3 py-2.5 text-[13px] first:pt-0 last:pb-0">
                  <span className="flex flex-col">
                    <span className="font-semibold capitalize">{k.provider}</span>
                    <span className="text-[11px] text-muted-foreground" dir="ltr">
                      {k.hint}
                    </span>
                  </span>
                  <StatusBadge tone={k.status === "valid" ? "ok" : "off"}>{k.status === "valid" ? t("keyValid") : (k.lastError ?? t("keyInvalid"))}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">{t("orgs.keysNote")}</p>
        </Card>
        <Card title={t("orgs.audit")}>
          <AuditList entries={data.audit} showOrg={false} />
        </Card>
      </div>

      <EditOrgDialog org={editing ? org : null} onClose={() => setEditing(false)} onSaved={(name) => (setNotice({ tone: "ok", text: t("orgs.saved", { name }) }), refresh())} />
    </div>
  );
}

function Members({
  orgId,
  members,
  onRun,
}: {
  orgId: string;
  members: Detail["members"];
  onRun: (action: Promise<{ ok: true } | { ok: false; error: string }>, success: string) => Promise<void>;
}) {
  const t = useTranslations("Admin");
  const tRoles = useTranslations("Team.roles");
  const format = useFormatter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const address = email.trim().toLowerCase();
    await onRun(
      addAdminOrgMember(orgId, { email: address, role }).then((r) => (r.ok ? { ok: true as const } : r)),
      t("orgs.memberAdded", { email: address }),
    );
    setBusy(false);
    setEmail("");
  }

  return (
    <Card title={t("orgs.members")}>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <label htmlFor="add-member-email" className="sr-only">
            {t("email")}
          </label>
          <Input id="add-member-email" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="h-10 text-[13px]" />
        </div>
        <select aria-label={t("role")} value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-10 w-36 rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:border-ring">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {tRoles(r)}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy} className="h-10 px-4 text-[13px] font-bold">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {t("orgs.addMember")}
        </Button>
        <p className="w-full text-[11px] text-muted-foreground">{t("orgs.addMemberHint")}</p>
      </form>
      <Table
        minWidth={640}
        head={
          <tr>
            <th scope="col" className={th}>{t("orgs.columns.member")}</th>
            <th scope="col" className={th}>{t("role")}</th>
            <th scope="col" className={th}>{t("status")}</th>
            <th scope="col" className={th}>{t("orgs.columns.jobs30")}</th>
            <th scope="col" className={`${th} w-24`}><span className="sr-only">{t("actionsLabel")}</span></th>
          </tr>
        }
      >
        {members.map((m) => (
          <tr key={m.id} className="border-b last:border-b-0">
            <td className={td}>
              <span className="flex flex-col">
                <span className="font-semibold">{m.name || m.email}</span>
                {m.name && (
                  <span className="text-[11px] text-muted-foreground" dir="ltr">
                    {m.email}
                  </span>
                )}
              </span>
            </td>
            <td className={td}>
              <select
                aria-label={t("changeRoleFor", { name: m.name || m.email })}
                value={m.role}
                onChange={(e) => onRun(changeAdminOrgMemberRole(orgId, m.id, e.target.value as Role), t("roleChanged", { name: m.name || m.email }))}
                className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tRoles(r)}
                  </option>
                ))}
              </select>
            </td>
            <td className={td}>
              <StatusBadge tone={m.status === "active" ? "ok" : "warn"}>{t(`memberStatus.${m.status}`)}</StatusBadge>
            </td>
            <td className={`${td} tabular-nums`}>{format.number(m.jobs, LATN)}</td>
            <td className={td}>
              <button
                type="button"
                onClick={() => window.confirm(t("orgs.removeConfirm", { name: m.name || m.email })) && onRun(removeAdminOrgMember(orgId, m.id), t("orgs.memberRemoved", { name: m.name || m.email }))}
                className="text-xs font-semibold text-danger hover:underline"
              >
                {t("remove")}
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
