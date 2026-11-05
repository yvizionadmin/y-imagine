"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Search, ShieldCheck } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { ROLES, type Role } from "@/lib/team/roles";
import {
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  setAdminUserStatus,
  setAdminUserSuperAdmin,
  type AdminUserRow,
} from "../actions";
import { Field, filterSelectClass, NoticeBar, PageHeader, selectClass, StatusBadge, Table, td, th, type Notice } from "./admin-ui";

type Filter = "all" | "active" | "disabled" | "super_admin";

export function AdminUsers() {
  const t = useTranslations("Admin");
  const tRoles = useTranslations("Team.roles");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [data, setData] = useState<{ users: AdminUserRow[]; orgs: { id: string; name: string }[] } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [orgId, setOrgId] = useState("all");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    const r = await listAdminUsers();
    if (r.ok) setData(r);
  }, []);
  useEffect(() => {
    listAdminUsers().then((r) => r.ok && setData(r));
  }, []);

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    const r = await action;
    setNotice(r.ok ? { tone: "ok", text: success } : { tone: "error", text: t(`errors.${r.error}`) });
    refresh();
  }

  function resetPassword(u: AdminUserRow) {
    const password = window.prompt(t("users.resetPrompt", { email: u.email }));
    if (password) run(resetAdminUserPassword(u.id, password), t("users.passwordReset", { email: u.email }));
  }

  const q = query.trim().toLowerCase();
  const rows = (data?.users ?? [])
    .filter((u) => filter === "all" || (filter === "super_admin" ? u.platformRole === "super_admin" : u.status === filter))
    .filter((u) => orgId === "all" || (orgId === "none" ? u.orgs.length === 0 : u.orgs.some((o) => o.id === orgId)))
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <PageHeader title={t("users.title")} subtitle={t("users.subtitle")}>
        <Button onClick={() => setCreating(true)} className="h-10 px-4 text-[13px] font-bold">
          <Plus aria-hidden />
          {t("users.create")}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-[320px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("users.search")}
            aria-label={t("users.search")}
            className="h-9 w-full rounded-lg border bg-background ps-8 pe-3 text-[13px] outline-none focus-visible:border-ring"
          />
        </div>
        <select aria-label={t("status")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={filterSelectClass}>
          <option value="all">{t("allStatuses")}</option>
          <option value="active">{t("userStatus.active")}</option>
          <option value="disabled">{t("userStatus.disabled")}</option>
          <option value="super_admin">{t("superAdmin")}</option>
        </select>
        <select aria-label={t("organization")} value={orgId} onChange={(e) => setOrgId(e.target.value)} className={filterSelectClass}>
          <option value="all">{t("allOrgs")}</option>
          <option value="none">{t("users.noOrg")}</option>
          {data?.orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <NoticeBar notice={notice} />

      {!data ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <Table
          minWidth={900}
          head={
            <tr>
              {(["user", "orgs", "status", "lastSignIn", "sessions"] as const).map((c) => (
                <th key={c} scope="col" className={th}>
                  {t(`users.columns.${c}`)}
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
              <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                {t("noMatches")}
              </td>
            </tr>
          )}
          {rows.map((u) => (
            <tr key={u.id} className="border-b last:border-b-0">
              <td className={td}>
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-semibold">
                    {u.name}
                    {u.platformRole === "super_admin" && (
                      <span title={t("superAdmin")} className="text-primary">
                        <ShieldCheck className="size-3.5" aria-label={t("superAdmin")} />
                      </span>
                    )}
                    {u.isYou && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{t("you")}</span>}
                  </span>
                  <span className="text-[11px] text-muted-foreground" dir="ltr">
                    {u.email}
                  </span>
                </span>
              </td>
              <td className={td}>
                {u.orgs.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {u.orgs.map((o) => (
                      <Link key={o.id} href={`/admin/organizations/${o.id}`} className="rounded-md bg-muted px-2 py-0.5 text-[11px] hover:underline">
                        {o.name} · {tRoles(o.role)}
                      </Link>
                    ))}
                  </span>
                )}
              </td>
              <td className={td}>
                <StatusBadge tone={u.status === "active" ? "ok" : "off"}>{t(`userStatus.${u.status}`)}</StatusBadge>
              </td>
              <td className={`${td} text-muted-foreground`}>{u.lastSignInAt ? format.relativeTime(new Date(u.lastSignInAt), now) : t("never")}</td>
              <td className={`${td} tabular-nums`}>{u.sessions}</td>
              <td className={td}>
                {!u.isYou && (
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={t("rowActions", { name: u.email })} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 font-sans">
                      <DropdownMenuItem onClick={() => resetPassword(u)}>{t("users.resetPassword")}</DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={u.sessions === 0}
                        onClick={() => run(revokeAdminUserSessions(u.id), t("users.signedOut", { email: u.email }))}
                      >
                        {t("users.signOutEverywhere")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          window.confirm(t(u.platformRole ? "users.revokeAdminConfirm" : "users.grantAdminConfirm", { email: u.email })) &&
                          run(setAdminUserSuperAdmin(u.id, !u.platformRole), t(u.platformRole ? "users.adminRevoked" : "users.adminGranted", { email: u.email }))
                        }
                      >
                        {t(u.platformRole ? "users.revokeAdmin" : "users.grantAdmin")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={u.status === "active" ? "destructive" : "default"}
                        onClick={() =>
                          (u.status !== "active" || window.confirm(t("users.disableConfirm", { email: u.email }))) &&
                          run(setAdminUserStatus(u.id, u.status === "active"), t(u.status === "active" ? "users.disabled" : "users.enabled", { email: u.email }))
                        }
                      >
                        {t(u.status === "active" ? "users.disable" : "users.enable")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {data && (
        <CreateUserDialog
          open={creating}
          onOpenChange={setCreating}
          orgs={data.orgs}
          onCreated={(email) => {
            setNotice({ tone: "ok", text: t("users.created", { email }) });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  orgs,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgs: { id: string; name: string }[];
  onCreated: (email: string) => void;
}) {
  const t = useTranslations("Admin");
  const tRoles = useTranslations("Team.roles");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setName("");
    setEmail("");
    setPassword("");
    setOrgId("");
    setRole("editor");
    setSuperAdmin(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createAdminUser({ name, email, password, orgId, role, superAdmin });
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`));
    onCreated(email.trim().toLowerCase());
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="gap-6 p-7 sm:max-w-[520px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-lg font-bold">{t("users.createTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("users.createBody")}</DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("name")} htmlFor="user-name">
              <Input id="user-name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-[13px]" />
            </Field>
            <Field label={t("email")} htmlFor="user-email">
              <Input id="user-email" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="h-10 text-[13px]" />
            </Field>
          </div>
          <Field label={t("tempPassword")} htmlFor="user-password" hint={t("users.passwordHint")}>
            <Input id="user-password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 text-[13px]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("organization")} htmlFor="user-org">
              <select id="user-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className={selectClass}>
                <option value="">{t("users.noOrg")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("role")} htmlFor="user-role">
              <select id="user-role" value={role} disabled={!orgId} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tRoles(r)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-start gap-2.5 rounded-xl border p-3 text-[13px]">
            <input type="checkbox" checked={superAdmin} onChange={(e) => setSuperAdmin(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{t("users.makeSuperAdmin")}</span>
              <span className="text-[11px] text-muted-foreground">{t("users.makeSuperAdminHint")}</span>
            </span>
          </label>
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
              {t("users.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
