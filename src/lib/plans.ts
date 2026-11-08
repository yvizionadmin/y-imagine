// SaaS plans. "Credits" are the plan's monthly job quota, not money (BYOK: the org pays its AI
// provider directly). Prices live in Stripe (src/lib/billing/stripe.ts maps plans to price ids);
// an org can carry a credits override.

export const PLAN_IDS = ["free", "starter", "pro", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const isPlan = (value: unknown): value is PlanId => (PLAN_IDS as readonly unknown[]).includes(value);

/** Stripe subscription status as stored on the org (null: never subscribed). */
export type BillingStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused";

/** Plans bought through Stripe Checkout; Free needs no payment and Enterprise is sold by contact. */
export const PAID_PLANS = ["starter", "pro"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLANS)[number];
export const isPaidPlan = (value: unknown): value is PaidPlanId => (PAID_PLANS as readonly unknown[]).includes(value);

/**
 * `videoStorageBytes`: room for Studio clips and their start frames; a new video is refused once it is
 * full. `videoRetentionDays`: clips older than this are removed by the `cleanup-videos` schedule (Free
 * can't make videos, but an org that downgrades keeps its clips for the same time as Starter).
 */
export type Plan = { id: PlanId; creditsMonthly: number; seats: number | null; videoStorageBytes: number; videoRetentionDays: number };

const GB = 1024 ** 3;

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", creditsMonthly: 50, seats: 3, videoStorageBytes: 0, videoRetentionDays: 30 },
  starter: { id: "starter", creditsMonthly: 200, seats: 5, videoStorageBytes: 5 * GB, videoRetentionDays: 30 },
  pro: { id: "pro", creditsMonthly: 500, seats: 15, videoStorageBytes: 25 * GB, videoRetentionDays: 90 },
  enterprise: { id: "enterprise", creditsMonthly: 2000, seats: null, videoStorageBytes: 100 * GB, videoRetentionDays: 365 },
};
