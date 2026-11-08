"use server";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AnalyticsDay } from "@/features/analytics/actions";
import { JOB_FEATURES, type JobFeature } from "@/features/analytics/config";
import type { ProviderKeyView } from "@/lib/ai/provider-keys";
import { listProviderKeys } from "@/lib/ai/provider-keys";
import type { Feature } from "@/lib/ai/types";
import { listAllAudit, PLATFORM_ORG, recordAudit, type AuditEntry } from "@/lib/audit";
import { IdentityError } from "@/lib/auth/clerk";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { countActiveSessions, getSession, revokeUserSessions } from "@/lib/auth/session";
import { beginViewAs, endViewAs, readViewAs, VIEW_AS_MINUTES } from "@/lib/auth/view-as";
import { findUserByEmail, insertUser, listUsers, normalizeEmail, setUserPassword, setUserStatus, toView, updateUser, type UserView } from "@/lib/auth/users";
import { hasLiveSubscription } from "@/lib/billing/billing";
import { listConnections } from "@/lib/catalog/connections";
import { isPlan, type PlanId } from "@/lib/plans";
import { DEFAULT_CREDIT_RULES, parseCreditRules, planCreditsFor, type CreditRules, type PricedFeature } from "@/lib/credits";
import { ADJUSTMENT_LIMIT, addCreditAdjustment, adjustmentTotalsByOrg, listCreditAdjustments, type CreditAdjustment } from "@/lib/platform/credit-adjustments";
import { getOrganization, insertOrganization, listOrganizations, updateOrganization, type Organization } from "@/lib/platform/organizations";
import { getPlatformSettings, savePlatformSettings, type PlatformSettings } from "@/lib/platform/settings";
import { sendInvitationEmail } from "@/lib/team/invitations";
import { ensureMembership, insertInvite, isRole, listAllMembers, removeMember, updateMember, type Member, type Role } from "@/lib/team/members";
import { dayKey, lastDays, startOfDay, startOfMonth } from "@/lib/time";
import { creatorKey, creditsOf, isJobBy, listAllUsage, type UsageEvent } from "@/lib/usage";

// Super-admin console. Platform scope by design: these are the only actions that read across
// orgs, and every one of them re-checks the platform role (never trust the page that called it).
// Secrets stay out: admins see key status and the ••••last4 hint, never a key or store credential.

type Failure = {
  ok: false;
  error: "forbidden" | "invalid_input" | "not_found" | "email_taken" | "weak_password" | "self" | "last_admin" | "last_super_admin" | "already_member" | "billing_managed";
};
type Result<T = object> = ({ ok: true } & T) | Failure;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const cleanCredits = (value: unknown) =>
  value === null || value === "" || value === undefined ? null : Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1_000_000 ? Number(value) : undefined;

/** Clerk refusing an email or password becomes the matching form error; anything else is a bug. */
function identityFailure(error: unknown): Failure {
  if (error instanceof IdentityError) return { ok: false, error: error.code };
  throw error;
}

async function admin() {
  const session = await getSession();
  return session?.user.platformRole === "super_admin" ? session.user : null;
}

const isJob = (e: UsageEvent) => (JOB_FEATURES as readonly string[]).includes(e.feature);

function daily(events: UsageEvent[], days: string[]): AnalyticsDay[] {
  const byDay = new Map<string, UsageEvent[]>(days.map((d) => [d, []]));
  for (const e of events) byDay.get(dayKey(new Date(e.at)))?.push(e);
  return [...byDay].map(([day, list]) => {
    const ok = list.filter((e) => e.ok);
    const byFeature = Object.fromEntries(JOB_FEATURES.map((f) => [f, 0])) as Record<JobFeature, number>;
    for (const e of list) byFeature[e.feature as JobFeature]++;
    return {
      day,
      total: list.length,
      failed: list.length - ok.length,
      byFeature,
      successRate: list.length ? ok.length / list.length : null,
      avgSeconds: ok.length ? ok.reduce((s, e) => s + e.durationMs, 0) / ok.length / 1000 : null,
      creators: new Set(list.map(creatorKey)).size,
    };
  });
}

// ---------- Overview ----------

export type AdminOverview = {
  totals: { orgs: number; suspendedOrgs: number; users: number; disabledUsers: number; superAdmins: number; activeSessions: number };
  jobs: { total: number; failed: number; activeOrgs: number; avgSeconds: number | null };
  daily: AnalyticsDay[];
  topOrgs: { id: string; name: string; jobs: number; failed: number }[];
  errors: { id: string; orgId: string; orgName: string; feature: Feature; error: string | null; userName: string; at: string }[];
  byFeature: { feature: JobFeature; count: number; failed: number }[];
  audit: (AuditEntry & { orgName: string | null })[];
  settings: PlatformSettings;
};

export async function getAdminOverview(range = 30): Promise<Result<{ data: AdminOverview }>> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  const days = lastDays(range);
  const [orgs, users, usage, sessions, audit, settings] = await Promise.all([
    listOrganizations(),
    listUsers(),
    listAllUsage(startOfDay(days[0])).then((all) => all.filter(isJob)),
    countActiveSessions(),
    listAllAudit({ limit: 8 }),
    getPlatformSettings(),
  ]);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? null;
  const ok = usage.filter((e) => e.ok);

  const perOrg = new Map<string, { jobs: number; failed: number }>();
  for (const e of usage) {
    const row = perOrg.get(e.orgId) ?? { jobs: 0, failed: 0 };
    row.jobs++;
    if (!e.ok) row.failed++;
    perOrg.set(e.orgId, row);
  }

  return {
    ok: true,
    data: {
      totals: {
        orgs: orgs.length,
        suspendedOrgs: orgs.filter((o) => o.status === "suspended").length,
        users: users.length,
        disabledUsers: users.filter((u) => u.status === "disabled").length,
        superAdmins: users.filter((u) => u.platformRole === "super_admin").length,
        activeSessions: [...sessions.values()].reduce((a, b) => a + b, 0),
      },
      jobs: {
        total: usage.length,
        failed: usage.length - ok.length,
        activeOrgs: perOrg.size,
        avgSeconds: ok.length ? ok.reduce((s, e) => s + e.durationMs, 0) / ok.length / 1000 : null,
      },
      daily: daily(usage, days),
      topOrgs: [...perOrg]
        .map(([id, row]) => ({ id, name: orgName(id) ?? id, ...row }))
        .sort((a, b) => b.jobs - a.jobs)
        .slice(0, 5),
      errors: usage
        .filter((e) => !e.ok)
        .reverse()
        .slice(0, 6)
        .map((e) => ({ id: e.id, orgId: e.orgId, orgName: orgName(e.orgId) ?? e.orgId, feature: e.feature, error: e.error, userName: e.userName, at: e.at })),
      byFeature: JOB_FEATURES.map((feature) => {
        const list = usage.filter((e) => e.feature === feature);
        return { feature, count: list.length, failed: list.filter((e) => !e.ok).length };
      }),
      audit: audit.map((e) => ({ ...e, orgName: e.orgId === PLATFORM_ORG ? null : orgName(e.orgId) })),
      settings,
    },
  };
}

// ---------- Organizations ----------

export type AdminOrgRow = Organization & {
  /** Plan credits (or override) plus this month's adjustments. */
  creditsMonthly: number;
  /** Net credits added or removed by super admins this month. */
  creditsAdjusted: number;
  creditsUsed: number;
  members: number;
  invites: number;
  lastJobAt: string | null;
};

async function orgRows(): Promise<AdminOrgRow[]> {
  const since = startOfMonth();
  const [orgs, members, usage, settings, adjusted] = await Promise.all([
    listOrganizations(),
    listAllMembers(),
    listAllUsage(since),
    getPlatformSettings(),
    adjustmentTotalsByOrg(since),
  ]);
  return orgs.map((o) => {
    const mine = members.filter((m) => m.orgId === o.id);
    const events = usage.filter((e) => e.orgId === o.id);
    const creditsAdjusted = adjusted.get(o.id) ?? 0;
    return {
      ...o,
      creditsMonthly: Math.max(0, planCreditsFor(settings.creditRules, o) + creditsAdjusted),
      creditsAdjusted,
      creditsUsed: creditsOf(events),
      members: mine.filter((m) => m.status === "active").length,
      invites: mine.filter((m) => m.status === "invited").length,
      lastJobAt: events.at(-1)?.at ?? null,
    };
  });
}

export async function listAdminOrgs(): Promise<Result<{ orgs: AdminOrgRow[] }>> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  return { ok: true, orgs: (await orgRows()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

/** Creates an org and its first admin: an existing user joins now, anyone else is invited. */
export async function createAdminOrg(input: {
  name: string;
  plan: string;
  creditsOverride: string | number | null;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}): Promise<Result<{ id: string; owner: "joined" | "created" | "invited" }>> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const name = clean(input.name, 80);
  const email = normalizeEmail(String(input.ownerEmail ?? ""));
  const credits = cleanCredits(input.creditsOverride);
  const password = typeof input.ownerPassword === "string" ? input.ownerPassword : "";
  if (!name || !isPlan(input.plan) || credits === undefined || !EMAIL.test(email)) return { ok: false, error: "invalid_input" };
  if (password && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) return { ok: false, error: "weak_password" };

  // The owner account first, so a password Clerk rejects doesn't leave an org without an admin.
  let owner: "joined" | "created" | "invited";
  let user = await findUserByEmail(email);
  if (!user && password) {
    try {
      user = await insertUser({ name: clean(input.ownerName, 80) || email.split("@")[0]!, email, password, createdBy: actor.email });
    } catch (error) {
      return identityFailure(error);
    }
    await recordAudit({ orgId: PLATFORM_ORG, action: "user.created", actor: actor.name, target: email });
    owner = "created";
  } else {
    owner = user ? "joined" : "invited";
  }

  const org = await insertOrganization({ name, plan: input.plan, creditsOverride: credits, createdBy: actor.email });
  await recordAudit({ orgId: org.id, action: "org.created", actor: actor.name, target: org.name, meta: { plan: org.plan, via: "admin" } });
  if (user) {
    await ensureMembership({ orgId: org.id, userId: user.id, name: user.name, email, role: "admin", invitedBy: actor.name });
    await recordAudit({ orgId: org.id, action: "member.added", actor: actor.name, target: email, meta: { role: "admin" } });
    // A temporary password was just set by the admin, who shares it; only joining an existing account is emailed.
    if (owner === "joined") await sendInvitationEmail({ email, orgName: org.name, inviter: actor.name, role: "admin", hasAccount: true });
  } else {
    await insertInvite({ orgId: org.id, email, role: "admin", department: "", invitedBy: actor.name });
    await sendInvitationEmail({ email, orgName: org.name, inviter: actor.name, role: "admin", hasAccount: false });
    await recordAudit({ orgId: org.id, action: "member.invited", actor: actor.name, target: email, meta: { role: "admin" } });
  }
  return { ok: true, id: org.id, owner };
}

export async function updateAdminOrg(id: string, input: { name: string; plan: string; creditsOverride: string | number | null }): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const org = await getOrganization(id);
  if (!org) return { ok: false, error: "not_found" };
  const name = clean(input.name, 80);
  const credits = cleanCredits(input.creditsOverride);
  if (!name || !isPlan(input.plan) || credits === undefined) return { ok: false, error: "invalid_input" };
  // A paying org's plan follows its Stripe subscription; changing it here would drift from what it pays.
  if (input.plan !== org.plan && hasLiveSubscription(org)) return { ok: false, error: "billing_managed" };
  await updateOrganization(id, { name, plan: input.plan, creditsOverride: credits });
  await recordAudit({
    orgId: id,
    action: "org.updated",
    actor: actor.name,
    target: name,
    meta: { plan: `${org.plan}→${input.plan}`, credits: `${org.creditsOverride ?? "plan"}→${credits ?? "plan"}` },
  });
  return { ok: true };
}

export async function setAdminOrgStatus(id: string, suspend: boolean, reason = ""): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const org = await getOrganization(id);
  if (!org) return { ok: false, error: "not_found" };
  const why = clean(reason, 200);
  await updateOrganization(id, { status: suspend ? "suspended" : "active", suspendedReason: suspend ? why || null : null });
  await recordAudit({ orgId: id, action: suspend ? "org.suspended" : "org.reactivated", actor: actor.name, target: org.name, meta: why ? { reason: why } : undefined });
  return { ok: true };
}

export type AdminOrgDetail = {
  org: AdminOrgRow;
  members: (Pick<Member, "id" | "name" | "email" | "role" | "status" | "department" | "createdAt"> & { userId: string | null; jobs: number })[];
  daily: AnalyticsDay[];
  keys: Pick<ProviderKeyView, "provider" | "hint" | "status" | "lastError" | "validatedAt">[];
  connections: { id: string; type: string; name: string; isDefault: boolean; lastTestOk: boolean | null }[];
  audit: AuditEntry[];
  adjustments: CreditAdjustment[];
};

export async function getAdminOrg(id: string): Promise<Result<{ data: AdminOrgDetail }>> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  const row = (await orgRows()).find((o) => o.id === id);
  if (!row) return { ok: false, error: "not_found" };
  const days = lastDays(30);
  const [members, usage, keys, connections, audit, adjustments] = await Promise.all([
    listAllMembers().then((all) => all.filter((m) => m.orgId === id)),
    listAllUsage(startOfDay(days[0])).then((all) => all.filter((e) => e.orgId === id && isJob(e))),
    listProviderKeys(id),
    listConnections(id),
    listAllAudit({ orgId: id, limit: 20 }),
    listCreditAdjustments(id),
  ]);
  return {
    ok: true,
    data: {
      org: row,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        department: m.department,
        createdAt: m.createdAt,
        jobs: usage.filter((e) => isJobBy(e, m)).length,
      })),
      daily: daily(usage, days),
      keys: keys.map((k) => ({ provider: k.provider, hint: k.hint, status: k.status, lastError: k.lastError, validatedAt: k.validatedAt })),
      connections: connections.map((c) => ({ id: c.id, type: c.type, name: c.name, isDefault: c.isDefault, lastTestOk: c.lastTest?.ok ?? null })),
      audit,
      adjustments,
    },
  };
}

/** Adds (positive) or removes (negative) credits for this month only, with a reason for the audit log. */
export async function adjustAdminOrgCredits(orgId: string, input: { amount: string | number; reason: string }): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const org = await getOrganization(orgId);
  if (!org) return { ok: false, error: "not_found" };
  const amount = Number(input.amount);
  const reason = clean(input.reason, 200);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > ADJUSTMENT_LIMIT || !reason) return { ok: false, error: "invalid_input" };
  await addCreditAdjustment(orgId, { amount, reason, actor: actor.name });
  await recordAudit({ orgId, action: "org.credits_adjusted", actor: actor.name, target: org.name, meta: { amount: (amount > 0 ? "+" : "") + amount, reason } });
  return { ok: true };
}

export async function addAdminOrgMember(orgId: string, input: { email: string; role: string }): Promise<Result<{ joined: boolean }>> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const org = await getOrganization(orgId);
  if (!org) return { ok: false, error: "not_found" };
  const email = normalizeEmail(String(input.email ?? ""));
  if (!EMAIL.test(email) || !isRole(input.role)) return { ok: false, error: "invalid_input" };
  const existing = (await listAllMembers()).find((m) => m.orgId === orgId && m.email.toLowerCase() === email);
  if (existing) return { ok: false, error: "already_member" };

  const user = await findUserByEmail(email);
  if (user) {
    await ensureMembership({ orgId, userId: user.id, name: user.name, email, role: input.role, invitedBy: actor.name });
    await recordAudit({ orgId, action: "member.added", actor: actor.name, target: email, meta: { role: input.role, via: "admin" } });
    await sendInvitationEmail({ email, orgName: org.name, inviter: actor.name, role: input.role, hasAccount: true });
  } else {
    await insertInvite({ orgId, email, role: input.role, department: "", invitedBy: actor.name });
    await sendInvitationEmail({ email, orgName: org.name, inviter: actor.name, role: input.role, hasAccount: false });
    await recordAudit({ orgId, action: "member.invited", actor: actor.name, target: email, meta: { role: input.role, via: "admin" } });
  }
  return { ok: true, joined: !!user };
}

const activeAdmins = (members: Member[], orgId: string) => members.filter((m) => m.orgId === orgId && m.role === "admin" && m.status === "active");

export async function changeAdminOrgMemberRole(orgId: string, memberId: string, role: Role): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isRole(role)) return { ok: false, error: "invalid_input" };
  const members = await listAllMembers();
  const member = members.find((m) => m.orgId === orgId && m.id === memberId);
  if (!member) return { ok: false, error: "not_found" };
  const admins = activeAdmins(members, orgId);
  if (role !== "admin" && member.role === "admin" && member.status === "active" && admins.length === 1) return { ok: false, error: "last_admin" };
  await updateMember(orgId, memberId, { role });
  await recordAudit({ orgId, action: "member.role_changed", actor: actor.name, target: member.email, meta: { from: member.role, to: role, via: "admin" } });
  return { ok: true };
}

export async function removeAdminOrgMember(orgId: string, memberId: string): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const members = await listAllMembers();
  const member = members.find((m) => m.orgId === orgId && m.id === memberId);
  if (!member) return { ok: false, error: "not_found" };
  if (member.role === "admin" && member.status === "active" && activeAdmins(members, orgId).length === 1) return { ok: false, error: "last_admin" };
  await removeMember(orgId, memberId);
  await recordAudit({ orgId, action: "member.removed", actor: actor.name, target: member.email, meta: { status: member.status, via: "admin" } });
  return { ok: true };
}

// ---------- Users ----------

export type AdminUserRow = UserView & {
  orgs: { id: string; name: string; role: Role }[];
  sessions: number;
  isYou: boolean;
};

export async function listAdminUsers(): Promise<Result<{ users: AdminUserRow[]; orgs: { id: string; name: string }[] }>> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const [users, members, orgs, sessions] = await Promise.all([listUsers(), listAllMembers(), listOrganizations(), countActiveSessions()]);
  return {
    ok: true,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name })).sort((a, b) => a.name.localeCompare(b.name)),
    users: users
      .map((u) => ({
        ...toView(u),
        orgs: members
          .filter((m) => m.userId === u.id && m.status === "active")
          .map((m) => ({ id: m.orgId, name: orgs.find((o) => o.id === m.orgId)?.name ?? m.orgId, role: m.role })),
        sessions: sessions.get(u.id) ?? 0,
        isYou: u.id === actor.id,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  password: string;
  orgId: string;
  role: string;
  superAdmin: boolean;
}): Promise<Result> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const name = clean(input.name, 80);
  const email = normalizeEmail(String(input.email ?? ""));
  const password = typeof input.password === "string" ? input.password : "";
  if (!name || !EMAIL.test(email)) return { ok: false, error: "invalid_input" };
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, error: "weak_password" };
  if (await findUserByEmail(email)) return { ok: false, error: "email_taken" };
  if (input.orgId && (!(await getOrganization(input.orgId)) || !isRole(input.role))) return { ok: false, error: "invalid_input" };

  let user;
  try {
    user = await insertUser({ name, email, password, createdBy: actor.email, platformRole: input.superAdmin ? "super_admin" : null });
  } catch (error) {
    return identityFailure(error);
  }
  await recordAudit({ orgId: PLATFORM_ORG, action: "user.created", actor: actor.name, target: email, meta: input.superAdmin ? { platformRole: "super_admin" } : undefined });
  if (input.orgId && isRole(input.role)) {
    await ensureMembership({ orgId: input.orgId, userId: user.id, name, email, role: input.role, invitedBy: actor.name });
    await recordAudit({ orgId: input.orgId, action: "member.added", actor: actor.name, target: email, meta: { role: input.role, via: "admin" } });
  }
  return { ok: true };
}

async function editableUser(id: string) {
  const actor = await admin();
  if (!actor) return { ok: false as const, error: "forbidden" as const };
  const users = await listUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return { ok: false as const, error: "not_found" as const };
  return { ok: true as const, actor, user, users };
}

export async function setAdminUserStatus(id: string, disable: boolean): Promise<Result> {
  const found = await editableUser(id);
  if (!found.ok) return found;
  const { actor, user } = found;
  if (user.id === actor.id) return { ok: false, error: "self" };
  await setUserStatus(user, disable ? "disabled" : "active");
  if (disable) await revokeUserSessions(id);
  await recordAudit({ orgId: PLATFORM_ORG, action: disable ? "user.disabled" : "user.enabled", actor: actor.name, target: user.email });
  return { ok: true };
}

export async function resetAdminUserPassword(id: string, password: string): Promise<Result> {
  const found = await editableUser(id);
  if (!found.ok) return found;
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, error: "weak_password" };
  try {
    await setUserPassword(found.user, password);
  } catch (error) {
    return identityFailure(error);
  }
  // Signing out everywhere makes the reset effective on stolen sessions too.
  if (found.user.id !== found.actor.id) await revokeUserSessions(id);
  await recordAudit({ orgId: PLATFORM_ORG, action: "user.password_reset", actor: found.actor.name, target: found.user.email });
  return { ok: true };
}

export async function setAdminUserSuperAdmin(id: string, grant: boolean): Promise<Result> {
  const found = await editableUser(id);
  if (!found.ok) return found;
  const { actor, user, users } = found;
  if (!grant && user.id === actor.id) return { ok: false, error: "self" };
  if (!grant && users.filter((u) => u.platformRole === "super_admin" && u.status === "active").length <= 1) return { ok: false, error: "last_super_admin" };
  await updateUser(id, { platformRole: grant ? "super_admin" : null });
  await recordAudit({ orgId: PLATFORM_ORG, action: grant ? "user.super_admin_granted" : "user.super_admin_revoked", actor: actor.name, target: user.email });
  return { ok: true };
}

export async function revokeAdminUserSessions(id: string): Promise<Result<{ count: number }>> {
  const found = await editableUser(id);
  if (!found.ok) return found;
  if (found.user.id === found.actor.id) return { ok: false, error: "self" };
  const count = await revokeUserSessions(id);
  await recordAudit({ orgId: PLATFORM_ORG, action: "user.sessions_revoked", actor: found.actor.name, target: found.user.email, meta: { count: String(count) } });
  return { ok: true, count };
}

// ---------- Activity (monitoring) ----------

export type AdminJob = Pick<UsageEvent, "id" | "orgId" | "feature" | "userName" | "provider" | "model" | "ok" | "error" | "durationMs" | "at"> & { orgName: string };

export async function getAdminActivity(filter: { orgId?: string; status?: "ok" | "failed" | "all"; feature?: string }): Promise<
  Result<{ jobs: AdminJob[]; audit: (AuditEntry & { orgName: string | null })[]; orgs: { id: string; name: string }[] }>
> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  const [orgs, usage, audit] = await Promise.all([listOrganizations(), listAllUsage(), listAllAudit({ orgId: filter.orgId || undefined, limit: 100 })]);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? null;
  const jobs = usage
    .filter((e) => !filter.orgId || e.orgId === filter.orgId)
    .filter((e) => !filter.feature || filter.feature === "all" || e.feature === filter.feature)
    .filter((e) => !filter.status || filter.status === "all" || (filter.status === "ok" ? e.ok : !e.ok))
    .reverse()
    .slice(0, 200)
    .map((e) => ({ ...e, orgName: orgName(e.orgId) ?? e.orgId }));
  return {
    ok: true,
    jobs,
    audit: audit.map((e) => ({ ...e, orgName: e.orgId === PLATFORM_ORG ? null : orgName(e.orgId) })),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------- Controls ----------

export async function getAdminControls(): Promise<Result<{ settings: PlatformSettings }>> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  return { ok: true, settings: await getPlatformSettings() };
}

export async function saveAdminControls(input: {
  maintenance: { enabled: boolean; message: string };
  signupsEnabled: boolean;
  defaultPlan: PlanId;
  disabledFeatures: string[];
}): Promise<Result<{ settings: PlatformSettings }>> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isPlan(input.defaultPlan) || !Array.isArray(input.disabledFeatures)) return { ok: false, error: "invalid_input" };
  const disabled = input.disabledFeatures.filter((f): f is JobFeature => (JOB_FEATURES as readonly string[]).includes(f));
  const before = await getPlatformSettings();
  const settings = await savePlatformSettings(
    {
      maintenance: { enabled: !!input.maintenance?.enabled, message: clean(input.maintenance?.message, 280) },
      signupsEnabled: !!input.signupsEnabled,
      defaultPlan: input.defaultPlan,
      disabledFeatures: disabled,
    },
    actor.name,
  );
  const changed = [
    before.maintenance.enabled !== settings.maintenance.enabled && `maintenance=${settings.maintenance.enabled ? "on" : "off"}`,
    before.signupsEnabled !== settings.signupsEnabled && `signups=${settings.signupsEnabled ? "on" : "off"}`,
    before.defaultPlan !== settings.defaultPlan && `defaultPlan=${settings.defaultPlan}`,
    before.disabledFeatures.join() !== settings.disabledFeatures.join() && `disabled=${settings.disabledFeatures.join("|") || "none"}`,
  ].filter(Boolean) as string[];
  await recordAudit({ orgId: PLATFORM_ORG, action: "platform.settings_updated", actor: actor.name, target: "platform", meta: { changes: changed.join(", ") || "none" } });
  return { ok: true, settings };
}

// ---------- Credits ----------

export async function getAdminCredits(): Promise<Result<{ rules: CreditRules; defaults: CreditRules; updatedAt: string | null; updatedBy: string | null }>> {
  if (!(await admin())) return { ok: false, error: "forbidden" };
  const settings = await getPlatformSettings();
  return { ok: true, rules: settings.creditRules, defaults: DEFAULT_CREDIT_RULES, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy };
}

/** What changed between two rule sets, for the audit log ("pro credits 500→800, video perSecond 2→3"). */
function creditChanges(before: CreditRules, after: CreditRules) {
  const changes: string[] = [];
  for (const [plan, n] of Object.entries(after.planCredits)) if (before.planCredits[plan as PlanId] !== n) changes.push(`${plan} credits ${before.planCredits[plan as PlanId]}→${n}`);
  for (const [tool, n] of Object.entries(after.featureCosts)) if (before.featureCosts[tool as PricedFeature] !== n) changes.push(`${tool} cost ${before.featureCosts[tool as PricedFeature]}→${n}`);
  if (before.video.base !== after.video.base) changes.push(`video base ${before.video.base}→${after.video.base}`);
  if (before.video.perSecond !== after.video.perSecond) changes.push(`video perSecond ${before.video.perSecond}→${after.video.perSecond}`);
  for (const [res, m] of Object.entries(after.video.resolution)) {
    const was = before.video.resolution[res as keyof CreditRules["video"]["resolution"]];
    if (was !== m) changes.push(`video ${res} ×${was}→×${m}`);
  }
  for (const [plan, tools] of Object.entries(after.planFeatures)) {
    const was = before.planFeatures[plan as PlanId];
    if (was.join() !== tools.join()) changes.push(`${plan} tools ${tools.join("|") || "none"}`);
  }
  return changes;
}

/** Saves the credit rules. They apply to jobs started after this; running jobs keep what they reserved. */
export async function saveAdminCredits(input: unknown): Promise<Result<{ rules: CreditRules; updatedAt: string | null; updatedBy: string | null }>> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "forbidden" };
  const rules = parseCreditRules(input);
  if (!rules) return { ok: false, error: "invalid_input" };
  const { creditRules: before, updatedAt: _at, updatedBy: _by, ...switches } = await getPlatformSettings();
  void [_at, _by];
  const saved = await savePlatformSettings({ ...switches, creditRules: rules }, actor.name);
  const changes = creditChanges(before, rules);
  await recordAudit({ orgId: PLATFORM_ORG, action: "platform.credits_updated", actor: actor.name, target: "platform", meta: { changes: changes.join(", ").slice(0, 1000) || "none" } });
  return { ok: true, rules: saved.creditRules, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
}

/** Opens an org as its admin would see it: read-only, for a limited time, and always in the audit log. */
export async function startViewAs(orgId: string) {
  const actor = await admin();
  if (!actor) return { ok: false as const, error: "forbidden" as const };
  const org = await getOrganization(orgId);
  if (!org) return { ok: false as const, error: "not_found" as const };
  await recordAudit({ orgId: org.id, action: "org.view_started", actor: actor.name, target: org.name, meta: { minutes: String(VIEW_AS_MINUTES) } });
  await beginViewAs(actor.id, org.id);
  redirect(`/${await getLocale()}/home`);
}

export async function stopViewAs() {
  const actor = await admin();
  const view = actor && (await readViewAs(actor.id));
  await endViewAs();
  if (actor && view) {
    const org = await getOrganization(view.orgId);
    await recordAudit({ orgId: view.orgId, action: "org.view_ended", actor: actor.name, target: org?.name ?? view.orgId });
  }
  redirect(`/${await getLocale()}${view ? `/admin/organizations/${view.orgId}` : "/home"}`);
}
