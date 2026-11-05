import { afterEach, describe, expect, it, vi } from "vitest";
import { planForPrice, priceId, trialDays } from "@/lib/billing/stripe";
import { isPaidPlan, PLANS } from "@/lib/plans";

afterEach(() => vi.unstubAllEnvs());

describe("plans and Stripe prices", () => {
  it("maps configured price ids both ways", () => {
    vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_sm");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_py");
    expect(priceId("starter", "month")).toBe("price_sm");
    expect(priceId("pro", "month")).toBeNull();
    expect(planForPrice("price_py")).toEqual({ plan: "pro", interval: "year" });
    expect(planForPrice("price_unknown")).toBeNull();
  });

  it("trial defaults to 14 days, 0 turns it off, capped at 90", () => {
    expect(trialDays()).toBe(14);
    vi.stubEnv("STRIPE_TRIAL_DAYS", "0");
    expect(trialDays()).toBe(0);
    vi.stubEnv("STRIPE_TRIAL_DAYS", "365");
    expect(trialDays()).toBe(90);
    vi.stubEnv("STRIPE_TRIAL_DAYS", "abc");
    expect(trialDays()).toBe(0);
  });

  it("only Starter and Pro are sold through Checkout", () => {
    expect(["free", "starter", "pro", "enterprise"].filter(isPaidPlan)).toEqual(["starter", "pro"]);
    expect(PLANS.enterprise.seats).toBeNull();
  });
});
