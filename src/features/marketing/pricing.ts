import "server-only";
import { billingEnabled, planPrices, trialDays, type Interval, type PlanPrice } from "@/lib/billing/stripe";
import { reportError } from "@/lib/observability/report";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { PaidPlanId, PlanId } from "@/lib/plans";

export type PublicPricing = {
  /** Amounts from Stripe (the source of truth); empty when billing is off or Stripe can't be reached. */
  prices: Partial<Record<PaidPlanId, Partial<Record<Interval, PlanPrice>>>>;
  /** Monthly credits, editable in Admin → Credits. */
  planCredits: Record<PlanId, number>;
  trialDays: number;
};

/** What the public pricing page shows. Never fails because of Stripe: the plans still list without amounts. */
export async function publicPricing(): Promise<PublicPricing> {
  const { creditRules } = await getPlatformSettings();
  const enabled = billingEnabled();
  const prices = enabled
    ? await planPrices().catch((error) => {
        reportError("public pricing: Stripe prices failed", error, {});
        return {};
      })
    : {};
  return { prices, planCredits: creditRules.planCredits, trialDays: enabled ? trialDays() : 0 };
}
