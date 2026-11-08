import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { clerkEnabled } from "@/lib/auth/constants";
import { getSession, signedOutPath } from "@/lib/auth/session";
import { readViewAs } from "@/lib/auth/view-as";
import { monthlyAllowance } from "@/lib/platform/credit-adjustments";
import { getOrganization, listOrganizations } from "@/lib/platform/organizations";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { PlanId } from "@/lib/plans";
import { listMembershipsForUser } from "@/lib/team/members";
import { startOfMonth } from "@/lib/time";
import { creditsUsedSince } from "@/lib/usage";

export type Workspace = {
  orgId: string;
  orgName: string;
  role: "admin" | "editor" | "viewer";
  plan: PlanId;
  user: { id: string; name: string; email: string };
  /** Platform operator (super-admin console). Independent of the org role. */
  isSuperAdmin: boolean;
  /** Orgs the user belongs to, for the org switcher. */
  orgs: { id: string; name: string }[];
  /** Credits the org has this month: plan (or override) plus admin adjustments. */
  creditsMonthly: number;
  /** Credits left this month. Jobs use their tool's cost; failed jobs are free. */
  creditsRemaining: number;
  /** Set while a super admin views this org read-only. They aren't a member of it. */
  viewAs?: { expiresAt: string };
};

export type BlockedReason = "suspended" | "maintenance" | "no_org" | "account";

/**
 * The signed-in user's current org. Redirects to sign-in without a session, to /onboarding when a
 * Clerk user has no org yet, and to /blocked when the org is suspended, the platform is in
 * maintenance, the account is disabled, or (local login) the user has no org. Super admins pass
 * maintenance and suspension so they can fix things.
 */
const loadWorkspace = cache(async (): Promise<Workspace> => {
  const session = await getSession();
  if (!session) redirect(await signedOutPath());
  const { user } = session;
  const isSuperAdmin = user.platformRole === "super_admin";

  const [memberships, settings, orgs] = await Promise.all([listMembershipsForUser(user.id), getPlatformSettings(), listOrganizations()]);
  if (settings.maintenance.enabled && !isSuperAdmin) redirect("/blocked?reason=maintenance");

  const known = memberships.filter((m) => orgs.some((o) => o.id === m.orgId));
  const membership = known.find((m) => m.orgId === session.orgId) ?? known[0];
  const viewAs = isSuperAdmin ? await readViewAs(user.id) : null;
  const viewedOrg = viewAs && orgs.find((o) => o.id === viewAs.orgId);
  if (!membership && !viewedOrg) redirect(isSuperAdmin ? "/admin" : clerkEnabled() ? "/onboarding" : "/blocked?reason=no_org");

  const org = (await getOrganization(viewedOrg ? viewedOrg.id : membership!.orgId))!;
  if (org.status === "suspended" && !isSuperAdmin) redirect("/blocked?reason=suspended");

  // Error reports carry ids only (no names or emails).
  Sentry.setUser({ id: user.id });
  Sentry.setTag("org", org.id);

  const since = startOfMonth();
  const [creditsMonthly, used] = await Promise.all([monthlyAllowance(org, settings.creditRules, since), creditsUsedSince(org.id, since)]);

  return {
    orgId: org.id,
    orgName: org.name,
    role: viewedOrg ? "admin" : membership!.role,
    plan: org.plan,
    user: { id: user.id, name: user.name, email: user.email },
    isSuperAdmin,
    orgs: viewedOrg ? [{ id: org.id, name: org.name }] : known.map((m) => ({ id: m.orgId, name: orgs.find((o) => o.id === m.orgId)!.name })),
    creditsMonthly,
    creditsRemaining: Math.max(0, creditsMonthly - used),
    ...(viewedOrg && viewAs ? { viewAs: { expiresAt: viewAs.expiresAt } } : {}),
  };
});

/**
 * The current workspace. While a super admin views an org this refuses every Server Action, so the read-only rule
 * holds for any action written later. An action that only reads passes `{ read: true }`; forgetting that shows a
 * refusal in the view, and never changes a customer's data. Other POSTs are stopped in the proxy.
 */
export async function getWorkspace(options?: { read: true }): Promise<Workspace> {
  const workspace = await loadWorkspace();
  if (workspace.viewAs && !options?.read) {
    const request = await headers();
    if (request.has("next-action")) redirect(refusedPath(request.get("referer")));
  }
  return workspace;
}

/** Back to the page the action came from, which then says that nothing was saved. Same site only. */
function refusedPath(referer: string | null) {
  try {
    return `${new URL(referer ?? "").pathname}?readOnly=1`;
  } catch {
    return "/home?readOnly=1";
  }
}

/** For the super-admin console: the signed-in user, who must hold the platform role. */
export const requireSuperAdmin = cache(async () => {
  const session = await getSession();
  if (!session) redirect(await signedOutPath());
  if (session.user.platformRole !== "super_admin") redirect("/home");
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});
