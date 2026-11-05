import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { clerkEnabled } from "@/lib/auth/constants";
import { getSession, signedOutPath } from "@/lib/auth/session";
import { creditsFor, getOrganization, listOrganizations } from "@/lib/platform/organizations";
import { getPlatformSettings } from "@/lib/platform/settings";
import { listMembershipsForUser } from "@/lib/team/members";
import { startOfMonth } from "@/lib/time";
import { countSuccessfulJobs } from "@/lib/usage";

export type Workspace = {
  orgId: string;
  orgName: string;
  role: "admin" | "editor" | "viewer";
  user: { id: string; name: string; email: string };
  /** Platform operator (super-admin console). Independent of the org role. */
  isSuperAdmin: boolean;
  /** Orgs the user belongs to, for the org switcher. */
  orgs: { id: string; name: string }[];
  /** Jobs included in the org's plan each month. */
  creditsMonthly: number;
  /** Remaining jobs in the org's monthly plan quota ("credits" in the UI). Failed jobs are free. */
  creditsRemaining: number;
};

export type BlockedReason = "suspended" | "maintenance" | "no_org" | "account";

/**
 * The signed-in user's current org. Redirects to sign-in without a session, to /onboarding when a
 * Clerk user has no org yet, and to /blocked when the org is suspended, the platform is in
 * maintenance, the account is disabled, or (local login) the user has no org. Super admins pass
 * maintenance and suspension so they can fix things.
 */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  const session = await getSession();
  if (!session) redirect(await signedOutPath());
  const { user } = session;
  const isSuperAdmin = user.platformRole === "super_admin";

  const [memberships, settings, orgs] = await Promise.all([listMembershipsForUser(user.id), getPlatformSettings(), listOrganizations()]);
  if (settings.maintenance.enabled && !isSuperAdmin) redirect("/blocked?reason=maintenance");

  const known = memberships.filter((m) => orgs.some((o) => o.id === m.orgId));
  const membership = known.find((m) => m.orgId === session.orgId) ?? known[0];
  if (!membership) redirect(isSuperAdmin ? "/admin" : clerkEnabled() ? "/onboarding" : "/blocked?reason=no_org");

  const org = (await getOrganization(membership.orgId))!;
  if (org.status === "suspended" && !isSuperAdmin) redirect("/blocked?reason=suspended");

  // Error reports carry ids only (no names or emails).
  Sentry.setUser({ id: user.id });
  Sentry.setTag("org", org.id);

  const creditsMonthly = creditsFor(org);
  const used = await countSuccessfulJobs(org.id, startOfMonth());

  return {
    orgId: org.id,
    orgName: org.name,
    role: membership.role,
    user: { id: user.id, name: user.name, email: user.email },
    isSuperAdmin,
    orgs: known.map((m) => ({ id: m.orgId, name: orgs.find((o) => o.id === m.orgId)!.name })),
    creditsMonthly,
    creditsRemaining: Math.max(0, creditsMonthly - used),
  };
});

/** For the super-admin console: the signed-in user, who must hold the platform role. */
export const requireSuperAdmin = cache(async () => {
  const session = await getSession();
  if (!session) redirect(await signedOutPath());
  if (session.user.platformRole !== "super_admin") redirect("/generate");
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});
