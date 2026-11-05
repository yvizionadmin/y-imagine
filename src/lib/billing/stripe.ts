import "server-only";
import Stripe from "stripe";
import { PAID_PLANS, type PaidPlanId } from "@/lib/plans";

// Stripe client and the plan ↔ price mapping. Prices (amounts, AED, monthly/yearly) live in Stripe;
// the app only knows their ids from the environment (`npm run stripe:setup` creates them). Without
// STRIPE_SECRET_KEY, billing is off: plans are set by super admins in the console.

export type Interval = "month" | "year";

export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY;

/** STRIPE_API_URL points the client at stripe-mock or a test stub; unset in real environments. */
function apiOverride() {
  if (!process.env.STRIPE_API_URL) return {};
  const url = new URL(process.env.STRIPE_API_URL);
  return { host: url.hostname, port: url.port, protocol: url.protocol.replace(":", "") as "http" | "https" };
}

let client: Stripe | undefined;
export const stripe = () => (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20_000, ...apiOverride() }));

const PRICE_ENV: Record<PaidPlanId, Record<Interval, string>> = {
  starter: { month: "STRIPE_PRICE_STARTER_MONTHLY", year: "STRIPE_PRICE_STARTER_YEARLY" },
  pro: { month: "STRIPE_PRICE_PRO_MONTHLY", year: "STRIPE_PRICE_PRO_YEARLY" },
};

export const priceId = (plan: PaidPlanId, interval: Interval) => process.env[PRICE_ENV[plan][interval]] || null;

/** Which plan and interval a Stripe price stands for; null for prices this app doesn't sell. */
export function planForPrice(id: string): { plan: PaidPlanId; interval: Interval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of ["month", "year"] as const) if (priceId(plan, interval) === id) return { plan, interval };
  }
  return null;
}

/** Free trial on an org's first subscription. Default 14 days; 0 turns trials off. */
export const trialDays = () => {
  const days = Number(process.env.STRIPE_TRIAL_DAYS ?? 14);
  return Number.isInteger(days) && days > 0 ? Math.min(days, 90) : 0;
};

export type PlanPrice = { amount: number; currency: string };

let priceCache: { at: number; prices: Partial<Record<PaidPlanId, Partial<Record<Interval, PlanPrice>>>> } | null = null;

/** Display prices of the configured plans (minor units), cached for 10 minutes. */
export async function planPrices() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.prices;
  const prices: Partial<Record<PaidPlanId, Partial<Record<Interval, PlanPrice>>>> = {};
  await Promise.all(
    PAID_PLANS.flatMap((plan) =>
      (["month", "year"] as const).map(async (interval) => {
        const id = priceId(plan, interval);
        if (!id) return;
        const price = await stripe().prices.retrieve(id);
        if (!price.active || price.unit_amount === null) return;
        (prices[plan] ??= {})[interval] = { amount: price.unit_amount, currency: price.currency };
      }),
    ),
  );
  priceCache = { at: Date.now(), prices };
  return prices;
}
