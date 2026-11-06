"use server";

import { getLocale } from "next-intl/server";
import { appUrl } from "@/lib/app-url";
import { recordAudit } from "@/lib/audit";
import { changePlan, createCheckout, createPortal, hasLiveSubscription, setCancelAtPeriodEnd } from "@/lib/billing/billing";
import { billingEnabled, planPrices, priceId, trialDays, type Interval, type PlanPrice } from "@/lib/billing/stripe";
import { getOrganization } from "@/lib/platform/organizations";
import { getPlatformSettings } from "@/lib/platform/settings";
import { isPaidPlan, PAID_PLANS, type BillingStatus, type PaidPlanId, type PlanId } from "@/lib/plans";
import { listMembers } from "@/lib/team/members";
import { getWorkspace } from "@/lib/workspace";
import { reportError } from "@/lib/observability/report";

export type BillingView = {
  plan: PlanId;
  status: BillingStatus | null;
  interval: Interval | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  hasCustomer: boolean;
  creditsMonthly: number;
  creditsRemaining: number;
  /** Monthly credits each plan includes (Admin → Credits). */
  planCredits: Record<PlanId, number>;
  seatsUsed: number;
  canManage: boolean;
  /** Stripe configured on this deployment. */
  enabled: boolean;
  /** Trial length offered on a first subscription (0: none or already used). */
  trialDays: number;
  /** Plans and intervals that can be bought, with their Stripe prices when they could be loaded. */
  prices: Partial<Record<PaidPlanId, Partial<Record<Interval, PlanPrice | null>>>>;
};

type Failure = { ok: false; error: "forbidden" | "invalid_input" | "not_configured" | "billing_failed" };

async function requireAdmin() {
  const workspace = await getWorkspace();
  return workspace.role === "admin" ? workspace : null;
}

const billingUrl = async () => `${await appUrl()}/${await getLocale()}/settings/billing`;

export async function getBilling(): Promise<BillingView> {
  const workspace = await getWorkspace();
  const [org, members, settings] = await Promise.all([getOrganization(workspace.orgId), listMembers(workspace), getPlatformSettings()]);
  const enabled = billingEnabled();
  // Prices come from Stripe; the page still works (without amounts) if Stripe can't be reached.
  const loaded = enabled ? await planPrices().catch(() => null) : null;
  const prices: BillingView["prices"] = {};
  if (enabled) {
    for (const plan of PAID_PLANS) {
      for (const interval of ["month", "year"] as const) {
        if (priceId(plan, interval)) (prices[plan] ??= {})[interval] = loaded?.[plan]?.[interval] ?? null;
      }
    }
  }
  return {
    plan: org!.plan,
    status: org!.billingStatus,
    interval: org!.billingInterval,
    periodEnd: org!.billingPeriodEnd,
    cancelAtPeriodEnd: org!.cancelAtPeriodEnd,
    hasSubscription: hasLiveSubscription(org!),
    hasCustomer: !!org!.stripeCustomerId,
    creditsMonthly: workspace.creditsMonthly,
    creditsRemaining: workspace.creditsRemaining,
    planCredits: settings.creditRules.planCredits,
    seatsUsed: members.length,
    canManage: workspace.role === "admin",
    enabled,
    trialDays: org!.billingStatus === null ? trialDays() : 0,
    prices,
  };
}

/**
 * Moves the org to a plan. Paid plan without a subscription → Stripe Checkout URL; with one → the
 * subscription switches now (prorated). Free → the subscription cancels at the end of the period.
 */
export async function choosePlan(plan: string, interval: string): Promise<{ ok: true; url?: string } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!billingEnabled()) return { ok: false, error: "not_configured" };
  const org = (await getOrganization(workspace.orgId))!;
  if (plan !== "free" && !(isPaidPlan(plan) && (interval === "month" || interval === "year") && priceId(plan, interval))) {
    return { ok: false, error: "invalid_input" };
  }
  try {
    if (plan === "free") {
      if (!hasLiveSubscription(org)) return { ok: true };
      await setCancelAtPeriodEnd(org, true);
      await recordAudit({ orgId: org.id, action: "billing.cancel_requested", actor: workspace.user.name, target: org.name, meta: { plan: org.plan } });
      return { ok: true };
    }
    const paid = plan as PaidPlanId;
    const every = interval as Interval;
    if (hasLiveSubscription(org)) {
      await changePlan(org, paid, every);
      return { ok: true };
    }
    const url = await createCheckout({ org, plan: paid, interval: every, email: workspace.user.email, returnUrl: await billingUrl() });
    await recordAudit({ orgId: org.id, action: "billing.checkout_started", actor: workspace.user.name, target: org.name, meta: { plan: paid, interval: every } });
    return { ok: true, url };
  } catch (error) {
    reportError("choosePlan failed", error, { orgId: org.id });
    return { ok: false, error: "billing_failed" };
  }
}

/** Keeps a subscription that was set to cancel at the end of its period. */
export async function resumePlan(): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!billingEnabled()) return { ok: false, error: "not_configured" };
  const org = (await getOrganization(workspace.orgId))!;
  if (!hasLiveSubscription(org) || !org.cancelAtPeriodEnd) return { ok: false, error: "invalid_input" };
  try {
    await setCancelAtPeriodEnd(org, false);
    await recordAudit({ orgId: org.id, action: "billing.resumed", actor: workspace.user.name, target: org.name, meta: { plan: org.plan } });
    return { ok: true };
  } catch (error) {
    reportError("resumePlan failed", error, { orgId: org.id });
    return { ok: false, error: "billing_failed" };
  }
}

/** Stripe's customer portal (payment method, invoices). */
export async function openBillingPortal(): Promise<{ ok: true; url: string } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!billingEnabled()) return { ok: false, error: "not_configured" };
  const org = (await getOrganization(workspace.orgId))!;
  if (!org.stripeCustomerId) return { ok: false, error: "invalid_input" };
  try {
    return { ok: true, url: await createPortal(org, await billingUrl()) };
  } catch (error) {
    reportError("openBillingPortal failed", error, { orgId: org.id });
    return { ok: false, error: "billing_failed" };
  }
}

