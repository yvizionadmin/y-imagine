"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LATN } from "@/lib/format";
import type { Role } from "@/lib/team/members";
import {
  changeMemberDepartment,
  changeMemberRole,
  getTeam,
  inviteMember,
  removeTeamMember,
  resendInvite,
  type MemberView,
} from "../actions";

const ROLES: Role[] = ["admin", "editor", "viewer"];
type Team = Awaited<ReturnType<typeof getTeam>>;
type ActionError = "forbidden" | "invalid_input" | "already_member" | "not_found" | "self" | "last_admin" | "seat_limit";

/** Team Members (Figma team-settings 30:430 with the Invite modal 30:621), restyled to light. */
export function TeamSettings() {
  const t = useTranslations("Team");
  const [team, setTeam] = useState<Team | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberView | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => setTeam(await getTeam()), []);
  useEffect(() => {
    getTeam().then(setTeam);
  }, []);

  async function run(action: Promise<{ ok: true } | { ok: false; error: ActionError }>, success?: string) {
    const response = await action;
    setNotice(response.ok ? (success ? { tone: "ok", text: success } : null) : { tone: "error", text: t(`errors.${response.error}`) });
    await refresh();
  }

  const q = query.trim().toLowerCase();
  const rows = (team?.members ?? [])
    .filter((m) => role === "all" || m.role === role)
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.includes(q))
    .sort((a, b) => Number(b.isYou) - Number(a.isYou) || (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{t("title")}</h2>
          {team && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              {t("total", { count: team.members.length, display: String(team.members.length) })}
            </span>
          )}
        </div>
        {team?.canManage && (
          <Button onClick={() => setInviting(true)} className="h-10 px-4 text-[13px] font-bold">
            <Plus aria-hidden />
            {t("invite")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[320px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-9 w-full rounded-lg border bg-background ps-8 pe-3 text-[13px] outline-none focus-visible:border-ring"
          />
        </div>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border bg-background ps-3 pe-2 text-[13px] text-muted-foreground">
          {t("roleFilter")}
          <select value={role} onChange={(e) => setRole(e.target.value as Role | "all")} className="bg-transparent font-semibold text-foreground outline-none">
            <option value="all">{t("all")}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {team && !team.canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("rounded-lg px-3 py-2 text-xs", notice.tone === "error" ? "bg-red-50 text-danger" : "bg-emerald-50 text-emerald-800")}
        >
          {notice.text}
        </p>
      )}

      {!team ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <MembersTable
          rows={rows}
          canManage={team.canManage}
          onRole={(m, r) => run(changeMemberRole(m.id, r), t("roleChanged", { name: m.name || m.email, role: t(`roles.${r}`) }))}
          onResend={async (m) => {
            const response = await resendInvite(m.id);
            setNotice(response.ok ? { tone: "ok", text: t(response.emailed ? "resent" : "resentNoEmail", { email: m.email }) } : { tone: "error", text: t(`errors.${response.error}`) });
            await refresh();
          }}
          onEditDepartment={setEditing}
          onRemove={(m) => {
            const name = m.name || m.email;
            if (window.confirm(t(m.status === "invited" ? "revokeConfirm" : "removeConfirm", { name }))) {
              run(removeTeamMember(m.id), t(m.status === "invited" ? "revoked" : "removed", { name }));
            }
          }}
        />
      )}

      {team && (
        <>
          <InviteDialog
            open={inviting}
            onOpenChange={setInviting}
            departments={team.departments}
            onInvited={(email, emailed) => {
              setNotice({ tone: "ok", text: t(emailed ? "invited" : "invitedNoEmail", { email }) });
              refresh();
            }}
          />
          <DepartmentDialog
            member={editing}
            departments={team.departments}
            onClose={() => setEditing(null)}
            onSave={(m, department) => run(changeMemberDepartment(m.id, department))}
          />
        </>
      )}
    </div>
  );
}

function MembersTable({
  rows,
  canManage,
  onRole,
  onResend,
  onEditDepartment,
  onRemove,
}: {
  rows: MemberView[];
  canManage: boolean;
  onRole: (member: MemberView, role: Role) => void;
  onResend: (member: MemberView) => void;
  onEditDepartment: (member: MemberView) => void;
  onRemove: (member: MemberView) => void;
}) {
  const t = useTranslations("Team");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const columns = ["member", "role", "department", "credits", "lastActive", "actions"] as const;

  return (
    <div className="relative overflow-x-auto rounded-xl border bg-background">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead className="border-b bg-muted text-[11px] font-semibold text-muted-foreground uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={cn("px-3 py-3 text-start first:ps-4 last:pe-4", c === "actions" && "sticky end-0 w-12 bg-muted")}>
                {c === "actions" ? <span className="sr-only">{t("columns.actions")}</span> : t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">
                {t("noMatches")}
              </td>
            </tr>
          )}
          {rows.map((m) => (
            <tr key={m.id} className="border-b last:border-b-0">
              <td className="py-3 ps-4 pe-3">
                <div className="flex items-center gap-3">
                  <Avatar member={m} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{m.name || m.email}</span>
                      {m.isYou && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{t("you")}</span>}
                    </span>
                    {m.name && (
                      <span className="truncate text-[11px] text-muted-foreground" dir="ltr">
                        {m.email}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3">
                <span
                  className={cn(
                    "inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                    m.role === "admin" ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {t(`roles.${m.role}`)}
                </span>
              </td>
              <td className="px-3 text-muted-foreground">{m.department || "—"}</td>
              <td className="px-3 font-semibold">
                {m.status === "invited" ? "—" : t("credits", { count: m.creditsUsed, display: format.number(m.creditsUsed, LATN) })}
              </td>
              <td className="px-3 text-muted-foreground">
                {m.status === "invited" ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{t("pending")}</span>
                ) : m.isYou ? (
                  t("now")
                ) : m.lastActiveAt ? (
                  format.relativeTime(new Date(m.lastActiveAt), now)
                ) : (
                  t("never")
                )}
              </td>
              <td className="sticky end-0 bg-background py-3 ps-3 pe-4">
                {canManage && !m.isYou && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t("rowActions", { name: m.name || m.email })}
                      className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52 font-sans">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{t("changeRole")}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="font-sans">
                          <DropdownMenuRadioGroup value={m.role} onValueChange={(value) => onRole(m, value as Role)}>
                            {ROLES.map((r) => (
                              <DropdownMenuRadioItem key={r} value={r} closeOnClick>
                                {t(`roles.${r}`)}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onClick={() => onEditDepartment(m)}>{t("changeDepartment")}</DropdownMenuItem>
                      {m.status === "invited" && <DropdownMenuItem onClick={() => onResend(m)}>{t("resend")}</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onRemove(m)}>
                        {m.status === "invited" ? t("revoke") : t("remove")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Avatar({ member }: { member: MemberView }) {
  const initials = (member.name || member.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        member.status === "invited" ? "border border-dashed border-subtle text-subtle" : "bg-primary text-primary-foreground",
      )}
    >
      {initials}
    </span>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  departments,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: string[];
  onInvited: (email: string, emailed: boolean) => void;
}) {
  const t = useTranslations("Team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setEmail("");
    setRole("editor");
    setDepartment("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const response = await inviteMember({ email, role, department });
    setBusy(false);
    if (!response.ok) return setError(t(`errors.${response.error === "invalid_input" ? "invalid_email" : response.error}`));
    onInvited(email.trim().toLowerCase(), response.emailed);
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="gap-6 p-7 sm:max-w-[500px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-lg font-bold">{t("inviteTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("inviteBody")}</DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <Field label={t("email")} htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              autoFocus
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="h-10 text-[13px]"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("role")} htmlFor="invite-role">
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-10 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:border-ring"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("department")} htmlFor="invite-department">
              <Input
                id="invite-department"
                list="team-departments"
                value={department}
                maxLength={60}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder={t("departmentPlaceholder")}
                className="h-10 text-[13px]"
              />
              <DepartmentOptions departments={departments} />
            </Field>
          </div>
          <p className="-mt-3 text-[11px] text-muted-foreground">{t(`roleHints.${role}`)}</p>
          {error && (
            <p role="alert" className="-mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={close} className="h-10 px-4 text-[13px] font-semibold">
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy} className="h-10 px-4 text-[13px] font-bold">
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t("send")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentDialog({
  member,
  departments,
  onClose,
  onSave,
}: {
  member: MemberView | null;
  departments: string[];
  onClose: () => void;
  onSave: (member: MemberView, department: string) => void;
}) {
  const t = useTranslations("Team");
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-5 p-6 sm:max-w-[420px]">
        {member && (
          <form
            key={member.id}
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              onSave(member, String(new FormData(e.currentTarget).get("department") ?? ""));
              onClose();
            }}
          >
            <DialogTitle className="text-base font-bold">{t("departmentTitle", { name: member.name || member.email })}</DialogTitle>
            <Field label={t("department")} htmlFor="edit-department">
              <Input
                id="edit-department"
                name="department"
                list="team-departments"
                defaultValue={member.department}
                maxLength={60}
                autoFocus
                placeholder={t("departmentPlaceholder")}
                className="h-10 text-[13px]"
              />
              <DepartmentOptions departments={departments} />
            </Field>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={onClose} className="h-10 px-4 text-[13px] font-semibold">
                {t("cancel")}
              </Button>
              <Button type="submit" className="h-10 px-4 text-[13px] font-bold">
                {t("save")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepartmentOptions({ departments }: { departments: string[] }) {
  return (
    <datalist id="team-departments">
      {departments.map((d) => (
        <option key={d} value={d} />
      ))}
    </datalist>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
