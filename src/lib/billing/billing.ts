import "server-only";
import type Stripe from "stripe";
import { recordAudit } from "@/lib/audit";
import { findOrganizationByCustomer, getOrganization, updateOrganization, type Organization } from "@/lib/platform/organizations";
import type { BillingStatus, PaidPlanId } from "@/lib/plans";
import { planForPrice, priceId, stripe, trialDays, type Interval } from "./stripe";

// Org subscriptions. Stripe is the source of truth: our org row (plan, status, period) is only
// written by syncSubscription, from webhooks or right after a change we made through the API.

/** Statuses that keep the paid plan (past_due: Stripe is still retrying the card). */
const LIVE: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
/** Statuses after which the org falls back to Free. */
const ENDED: ReadonlySet<string> = new Set(["canceled", "unpaid", "incomplete_expired"]);

export const hasLiveSubscription = (org: Pick<Organization, "stripeSubscriptionId" | "billingStatus">) =>
  !!org.stripeSubscriptionId && !!org.billingStatus && LIVE.has(org.billingStatus);

async function ensureCustomer(org: Organization, email: string) {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  // Idempotency key: two admins clicking at once still get one customer.
  const customer = await stripe().customers.create({ name: org.name, email, metadata: { orgId: org.id } }, { idempotencyKey: `customer:${org.id}` });
  await updateOrganization(org.id, { stripeCustomerId: customer.id });
  return customer.id;
}

/** Stripe Checkout for an org without a live subscription. Trial only on the first subscription. */
export async function createCheckout(input: { org: Organization; plan: PaidPlanId; interval: Interval; email: string; returnUrl: string }) {
  const price = priceId(input.plan, input.interval);
  if (!price) throw new Error(`no Stripe price for ${input.plan}/${input.interval}`);
  const customer = await ensureCustomer(input.org, input.email);
  const trial = input.org.billingStatus === null ? trialDays() : 0;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.org.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { orgId: input.org.id }, ...(trial ? { trial_period_days: trial } : {}) },
    metadata: { orgId: input.org.id },
    allow_promotion_codes: true,
    success_url: `${input.returnUrl}?checkout=success`,
    cancel_url: `${input.returnUrl}?checkout=canceled`,
  });
  if (!session.url) throw new Error("checkout session without url");
  return session.url;
}

/** Switches a live subscription to another plan/interval now, prorated; also undoes a pending cancel. */
export async function changePlan(org: Organization, plan: PaidPlanId, interval: Interval) {
  const price = priceId(plan, interval);
  if (!price || !org.stripeSubscriptionId) throw new Error("no subscription or price");
  const current = await stripe().subscriptions.retrieve(org.stripeSubscriptionId);
  const updated = await stripe().subscriptions.update(current.id, {
    items: [{ id: current.items.data[0].id, price }],
    proration_behavior: "create_prorations",
    cancel_at_period_end: false,
    metadata: { orgId: org.id },
  });
  return syncSubscription(updated);
}

/** Cancels at the end of the paid period (the org keeps its plan until then), or undoes that. */
export async function setCancelAtPeriodEnd(org: Organization, cancel: boolean) {
  if (!org.stripeSubscriptionId) throw new Error("no subscription");
  return syncSubscription(await stripe().subscriptions.update(org.stripeSubscriptionId, { cancel_at_period_end: cancel }));
}

/** Stripe's customer portal: payment method, invoices, billing details. */
export async function createPortal(org: Organization, returnUrl: string) {
  if (!org.stripeCustomerId) throw new Error("no customer");
  return (await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: returnUrl })).url;
}

/**
 * Writes a subscription's state onto its org: plan from the price while it's live, Free once it has
 * ended, unchanged while incomplete/paused. Updates for an older subscription than the org's current
 * one are ignored, so a resubscribe isn't undone by a late "deleted" event.
 */
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  let org = await findOrganizationByCustomer(customerId);
  if (!org && sub.metadata.orgId) {
    const tagged = await getOrganization(sub.metadata.orgId);
    // Metadata alone can't move an org onto someone else's customer.
    if (tagged && (!tagged.stripeCustomerId || tagged.stripeCustomerId === customerId)) org = tagged;
  }
  if (!org) return null;
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id && !LIVE.has(sub.status)) return org;

  const item = sub.items.data[0];
  const mapped = item ? planForPrice(item.price.id) : null;
  const ended = ENDED.has(sub.status);
  const plan = LIVE.has(sub.status) && mapped ? mapped.plan : ended ? "free" : org.plan;
  const updated = await updateOrganization(org.id, {
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: ended ? null : sub.id,
    billingStatus: sub.status as BillingStatus,
    billingInterval: mapped?.interval ?? org.billingInterval,
    billingPeriodEnd: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !ended && sub.cancel_at_period_end,
  });
  if (plan !== org.plan) {
    await recordAudit({ orgId: org.id, action: "billing.plan_changed", actor: "Stripe", target: org.name, meta: { from: org.plan, to: plan, status: sub.status } });
  }
  return updated;
}
