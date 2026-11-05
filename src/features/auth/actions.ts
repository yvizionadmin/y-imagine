"use server";

import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "@/lib/auth/password";
import { clerkEnabled } from "@/lib/auth/constants";
import { createSession, endSession, getSession, setSessionOrg } from "@/lib/auth/session";
import { clearLimit, clientIp, hit, isLimited, LIMITS } from "@/lib/rate-limit";
import { findUserByEmail, insertUser, normalizeEmail, syncBootstrapRole, updateUser } from "@/lib/auth/users";
import type { PlanId } from "@/lib/plans";
import { insertOrganization } from "@/lib/platform/organizations";
import { getPlatformSettings } from "@/lib/platform/settings";
import { acceptInvites, ensureMembership, listAllMembers, listMembershipsForUser } from "@/lib/team/members";

type Failure = {
  ok: false;
  error: "invalid_input" | "weak_password" | "email_taken" | "company_required" | "signups_closed" | "invalid_credentials" | "disabled" | "too_many_attempts";
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");


// signUp / signIn / signOut are the local login. With Clerk, its components and session do this
// (company creation moves to createCompany on /onboarding).

export async function signUp(input: { name: string; email: string; password: string; company: string }): Promise<{ ok: true } | Failure> {
  if (clerkEnabled()) return { ok: false, error: "invalid_input" };
  if (!(await hit("auth-ip", await clientIp(), LIMITS.authPerIp)).ok) return { ok: false, error: "too_many_attempts" };
  const name = clean(input.name, 80);
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  const company = clean(input.company, 80);
  const password = typeof input.password === "string" ? input.password : "";
  if (!name || !EMAIL.test(email) || email.length > 254) return { ok: false, error: "invalid_input" };
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, error: "weak_password" };
  if (await findUserByEmail(email)) return { ok: false, error: "email_taken" };

  // Invited people can always join; closing sign-ups only stops new companies.
  const invited = (await listAllMembers()).some((m) => m.status === "invited" && m.email.toLowerCase() === email);
  const settings = await getPlatformSettings();
  if (!invited && !settings.signupsEnabled) return { ok: false, error: "signups_closed" };
  if (!invited && !company) return { ok: false, error: "company_required" };

  const user = await insertUser({ name, email, password, createdBy: null });
  const joined = await acceptInvites(user);
  for (const m of joined) await recordAudit({ orgId: m.orgId, action: "member.added", actor: user.name, target: email, meta: { via: "invitation" } });

  const orgId = joined[0]?.orgId ?? (await startCompany(user, company, settings.defaultPlan));
  if (joined.length) await recordAudit({ orgId, action: "auth.signed_up", actor: user.name, target: email });
  await createSession(user.id, orgId);
  return { ok: true };
}

/** A new company with its creator as admin (self-service sign-up). Returns the org id. */
async function startCompany(user: { id: string; name: string; email: string }, company: string, plan: PlanId) {
  const org = await insertOrganization({ name: company, plan, createdBy: user.email });
  await ensureMembership({ orgId: org.id, userId: user.id, name: user.name, email: user.email, role: "admin", invitedBy: null });
  await recordAudit({ orgId: org.id, action: "org.created", actor: user.name, target: org.name, meta: { plan: org.plan, via: "sign_up" } });
  await recordAudit({ orgId: org.id, action: "auth.signed_up", actor: user.name, target: user.email });
  return org.id;
}

/**
 * Clerk sign-up's second step (/onboarding): someone signed in with no org and no invitation names
 * their company. Honours "sign-ups off" and the default plan like the local sign-up.
 */
export async function createCompany(input: { company: string }): Promise<{ ok: true } | Failure> {
  const session = await getSession();
  if (!session) return { ok: false, error: "invalid_input" };
  const company = clean(input.company, 80);
  if (!company) return { ok: false, error: "company_required" };
  if ((await listMembershipsForUser(session.user.id)).length) return { ok: true };
  const settings = await getPlatformSettings();
  if (!settings.signupsEnabled) return { ok: false, error: "signups_closed" };
  await setSessionOrg(await startCompany(session.user, company, settings.defaultPlan));
  return { ok: true };
}

export async function signIn(input: { email: string; password: string }): Promise<{ ok: true } | Failure> {
  if (clerkEnabled()) return { ok: false, error: "invalid_credentials" };
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  const password = typeof input.password === "string" ? input.password.slice(0, PASSWORD_MAX) : "";
  if (!EMAIL.test(email) || !password) return { ok: false, error: "invalid_credentials" };
  // Failures per email (credential stuffing on one account) and attempts per IP (spraying many).
  if ((await isLimited("sign-in", email, LIMITS.signInFailures)) || !(await hit("auth-ip", await clientIp(), LIMITS.authPerIp)).ok) {
    return { ok: false, error: "too_many_attempts" };
  }

  const found = await findUserByEmail(email);
  const valid = found?.passwordHash ? await verifyPassword(password, found.passwordHash) : false;
  if (!found || !valid) {
    await hit("sign-in", email, LIMITS.signInFailures);
    return { ok: false, error: "invalid_credentials" };
  }
  if (found.status !== "active") return { ok: false, error: "disabled" };

  await clearLimit("sign-in", email);
  const user = await syncBootstrapRole(found);
  await updateUser(user.id, { lastSignInAt: new Date().toISOString() });
  // Invitations sent to an existing account are accepted on its next sign-in.
  const before = new Set((await listMembershipsForUser(user.id)).map((m) => m.orgId));
  for (const m of await acceptInvites(user)) {
    if (!before.has(m.orgId)) await recordAudit({ orgId: m.orgId, action: "member.added", actor: user.name, target: email, meta: { via: "invitation" } });
  }
  await createSession(user.id, null);
  return { ok: true };
}

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}

export async function switchOrganization(orgId: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const memberships = await listMembershipsForUser(session.user.id);
  if (!memberships.some((m) => m.orgId === orgId)) return { ok: false };
  await setSessionOrg(orgId);
  return { ok: true };
}
