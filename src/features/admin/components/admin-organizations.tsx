"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { PLAN_IDS, type PlanId } from "@/lib/plans";
import { createAdminOrg, listAdminOrgs, setAdminOrgStatus, updateAdminOrg, type AdminOrgRow } from "../actions";
import { Field, filterSelectClass, NoticeBar, PageHeader, selectClass, StatusBadge, Table, td, th, type Notice } from "./admin-ui";
import { usePlanCredits } from "./use-plan-credits";
import { LoadingSkeleton } from "@/components/ui/skeleton";

export function AdminOrganizations() {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [orgs, setOrgs] = useState<AdminOrgRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminOrgRow | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const n = (v: number) => format.number(v, LATN);

  const refresh = useCallback(async () => {
    const r = await listAdminOrgs();
    if (r.ok) setOrgs(r.orgs);
  }, []);
  useEffect(() => {
    listAdminOrgs().then((r) => r.ok && setOrgs(r.orgs));
  }, []);

  async function toggleStatus(org: AdminOrgRow) {
    const suspend = org.status === "active";
    let reason = "";
    if (suspend) {
      const answer = window.prompt(t("orgs.suspendPrompt", { name: org.name }));
      if (answer === null) return;
      reason = answer;
    }
    const r = await setAdminOrgStatus(org.id, suspend, reason);
    setNotice(r.ok ? { tone: "ok", text: t(suspend ? "orgs.suspended" : "orgs.reactivated", { name: org.name }) } : { tone: "error", text: t(`errors.${r.error}`) });
    refresh();
  }

  const q = query.trim().toLowerCase();
  const rows = (orgs ?? []).filter((o) => (status === "all" || o.status === status) && (!q || o.name.toLowerCase().includes(q) || o.id.includes(q)));

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <PageHeader title={t("orgs.title")} subtitle={t("orgs.subtitle")}>
        <Button onClick={() => setCreating(true)} className="h-10 px-4 text-[13px] font-bold">
          <Plus aria-hidden />
          {t("orgs.create")}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-[320px] max-w-full">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("orgs.search")}
            aria-label={t("orgs.search")}
            className="h-9 w-full rounded-lg border bg-background ps-8 pe-3 text-[13px] outline-none focus-visible:border-ring"
          />
        </div>
        <select aria-label={t("status")} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={filterSelectClass}>
          <option value="all">{t("allStatuses")}</option>
          <option value="active">{t("orgStatus.active")}</option>
          <option value="suspended">{t("orgStatus.suspended")}</option>
        </select>
      </div>

      <NoticeBar notice={notice} />

      {!orgs ? (
        <LoadingSkeleton variant="list" className="p-4" />
      ) : (
        <Table
          minWidth={900}
          head={
            <tr>
              {(["name", "plan", "credits", "members", "lastJob", "status"] as const).map((c) => (
                <th key={c} scope="col" className={th}>
                  {t(`orgs.columns.${c}`)}
                </th>
              ))}
              <th scope="col" className={`${th} w-12`}>
                <span className="sr-only">{t("actionsLabel")}</span>
              </th>
            </tr>
          }
        >
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                {t("noMatches")}
              </td>
            </tr>
          )}
          {rows.map((o) => {
            const ratio = o.creditsMonthly ? o.creditsUsed / o.creditsMonthly : 1;
            return (
              <tr key={o.id} className="border-b last:border-b-0">
                <td className={td}>
                  <Link href={`/admin/organizations/${o.id}`} className="flex flex-col gap-0.5 hover:underline">
                    <span className="font-semibold">{o.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {t("createdAgo", { when: format.relativeTime(new Date(o.createdAt), now) })}
                    </span>
                  </Link>
                </td>
                <td className={td}>
                  <StatusBadge tone="brand">{t(`plans.${o.plan}`)}</StatusBadge>
                  {o.creditsOverride !== null && <span className="ms-1.5 text-[11px] text-muted-foreground">{t("orgs.custom")}</span>}
                </td>
                <td className={td}>
                  <div className="flex w-36 flex-col gap-1">
                    <span className="text-xs tabular-nums">
                      {n(o.creditsUsed)} / {n(o.creditsMonthly)}
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <span className={ratio >= 1 ? "block h-full bg-destructive" : ratio > 0.8 ? "block h-full bg-amber-500" : "block h-full bg-primary"} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                    </span>
                  </div>
                </td>
                <td className={`${td} tabular-nums`}>
                  {n(o.members)}
                  {o.invites > 0 && <span className="ms-1 text-[11px] text-muted-foreground">{t("orgs.invites", { count: o.invites, display: n(o.invites) })}</span>}
                </td>
                <td className={`${td} text-muted-foreground`}>{o.lastJobAt ? format.relativeTime(new Date(o.lastJobAt), now) : t("never")}</td>
                <td className={td}>
                  <StatusBadge tone={o.status === "active" ? "ok" : "off"}>{t(`orgStatus.${o.status}`)}</StatusBadge>
                </td>
                <td className={td}>
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={t("rowActions", { name: o.name })} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 font-sans">
                      <DropdownMenuItem onClick={() => router.push(`/admin/organizations/${o.id}`)}>{t("orgs.open")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditing(o)}>{t("orgs.edit")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant={o.status === "active" ? "destructive" : "default"} onClick={() => toggleStatus(o)}>
                        {t(o.status === "active" ? "orgs.suspend" : "orgs.reactivate")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <CreateOrgDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(name, owner) => {
          setNotice({ tone: "ok", text: t(`orgs.created.${owner}`, { name }) });
          refresh();
        }}
      />
      <EditOrgDialog
        org={editing}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          setNotice({ tone: "ok", text: t("orgs.saved", { name }) });
          refresh();
        }}
      />
    </div>
  );
}

function PlanFields({ plan, setPlan, credits, setCredits }: { plan: PlanId; setPlan: (p: PlanId) => void; credits: string; setCredits: (c: string) => void }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const planCredits = usePlanCredits();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t("orgs.plan")} htmlFor="org-plan">
        <select id="org-plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} className={selectClass}>
          {PLAN_IDS.map((p) => (
            <option key={p} value={p}>
              {t(`plans.${p}`)} · {t("creditsPerMonth", { display: format.number(planCredits[p], LATN) })}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("orgs.creditsOverride")} htmlFor="org-credits" hint={t("orgs.creditsOverrideHint")}>
        <Input
          id="org-credits"
          type="number"
          min={0}
          max={1000000}
          inputMode="numeric"
          dir="ltr"
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
          placeholder={String(planCredits[plan])}
          className="h-10 text-[13px]"
        />
      </Field>
    </div>
  );
}

function CreateOrgDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (name: string, owner: "joined" | "created" | "invited") => void }) {
  const t = useTranslations("Admin");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<PlanId>("starter");
  const [credits, setCredits] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setName("");
    setPlan("starter");
    setCredits("");
    setOwnerEmail("");
    setOwnerName("");
    setOwnerPassword("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createAdminOrg({ name, plan, creditsOverride: credits || null, ownerEmail, ownerName, ownerPassword });
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`));
    onCreated(name.trim(), r.owner);
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="gap-6 p-7 sm:max-w-[540px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-lg font-bold">{t("orgs.createTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("orgs.createBody")}</DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field label={t("orgs.name")} htmlFor="org-name">
            <Input id="org-name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-[13px]" />
          </Field>
          <PlanFields plan={plan} setPlan={setPlan} credits={credits} setCredits={setCredits} />
          <fieldset className="flex flex-col gap-4 rounded-xl border p-4">
            <legend className="px-1 text-xs font-bold">{t("orgs.owner")}</legend>
            <Field label={t("email")} htmlFor="owner-email" hint={t("orgs.ownerHint")}>
              <Input id="owner-email" type="email" required dir="ltr" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="name@company.com" className="h-10 text-[13px]" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("name")} htmlFor="owner-name">
                <Input id="owner-name" maxLength={80} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="h-10 text-[13px]" />
              </Field>
              <Field label={t("tempPassword")} htmlFor="owner-password">
                <Input id="owner-password" type="password" autoComplete="new-password" dir="ltr" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} className="h-10 text-[13px]" />
              </Field>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={close} className="h-10 px-4 text-[13px] font-semibold">
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy} className="h-10 px-4 text-[13px] font-bold">
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t("orgs.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditOrgDialog({ org, onClose, onSaved }: { org: Pick<AdminOrgRow, "id" | "name" | "plan" | "creditsOverride"> | null; onClose: () => void; onSaved: (name: string) => void }) {
  return (
    <Dialog open={!!org} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-6 p-7 sm:max-w-[500px]">{org && <EditOrgForm key={org.id} org={org} onClose={onClose} onSaved={onSaved} />}</DialogContent>
    </Dialog>
  );
}

function EditOrgForm({ org, onClose, onSaved }: { org: Pick<AdminOrgRow, "id" | "name" | "plan" | "creditsOverride">; onClose: () => void; onSaved: (name: string) => void }) {
  const t = useTranslations("Admin");
  const [name, setName] = useState(org.name);
  const [plan, setPlan] = useState<PlanId>(org.plan);
  const [credits, setCredits] = useState(org.creditsOverride === null ? "" : String(org.creditsOverride));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await updateAdminOrg(org.id, { name, plan, creditsOverride: credits || null });
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`));
    onSaved(name.trim());
    onClose();
  }

  return (
    <>
      <DialogTitle className="text-lg font-bold">{t("orgs.editTitle")}</DialogTitle>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label={t("orgs.name")} htmlFor="edit-org-name">
          <Input id="edit-org-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-[13px]" />
        </Field>
        <PlanFields plan={plan} setPlan={setPlan} credits={credits} setCredits={setCredits} />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} className="h-10 px-4 text-[13px] font-semibold">
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={busy} className="h-10 px-4 text-[13px] font-bold">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </div>
      </form>
    </>
  );
}
