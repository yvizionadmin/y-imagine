import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { legalDoc } from "@/features/marketing/legal-content";
import { LEGAL_DETAILS, legalPlaceholders } from "@/features/marketing/legal-details";
import { PLANS } from "@/lib/plans";

const stripe = vi.hoisted(() => ({ enabled: false, prices: vi.fn(), trial: 14 }));
const report = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/stripe", () => ({ billingEnabled: () => stripe.enabled, planPrices: stripe.prices, trialDays: () => stripe.trial }));
vi.mock("@/lib/observability/report", () => ({ reportError: report }));
vi.mock("@/lib/platform/settings", () => ({ getPlatformSettings: async () => ({ creditRules: { planCredits: { free: 50, starter: 200, pro: 500, enterprise: 2000 } } }) }));

const { publicPricing } = await import("@/features/marketing/pricing");

afterEach(() => {
  stripe.enabled = false;
  vi.clearAllMocks();
});

const keys = (value: unknown, prefix = ""): string[] =>
  value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix];

describe("public pricing", () => {
  it("doesn't touch Stripe when billing is off, and offers no trial", async () => {
    expect(await publicPricing()).toEqual({ prices: {}, planCredits: { free: 50, starter: 200, pro: 500, enterprise: 2000 }, trialDays: 0 });
    expect(stripe.prices).not.toHaveBeenCalled();
  });

  it("shows Stripe's amounts and the trial", async () => {
    stripe.enabled = true;
    const prices = { pro: { month: { amount: 49900, currency: "aed" } } };
    stripe.prices.mockResolvedValue(prices);
    expect(await publicPricing()).toMatchObject({ prices, trialDays: 14 });
  });

  it("still lists the plans when Stripe fails, and reports it", async () => {
    stripe.enabled = true;
    stripe.prices.mockRejectedValue(new Error("stripe down"));
    expect((await publicPricing()).prices).toEqual({});
    expect(report).toHaveBeenCalledOnce();
  });
});

describe("marketing text", () => {
  it("has the same keys in English and Arabic", () => {
    expect(keys(ar.Marketing).sort()).toEqual(keys(en.Marketing).sort());
  });

  it("never uses the old brand", () => {
    expect(JSON.stringify(en.Marketing) + JSON.stringify(ar.Marketing)).not.toMatch(/magnific/i);
  });
});

describe("legal pages", () => {
  it.each(["terms", "privacy"] as const)("%s has the same sections in both languages", (kind) => {
    const [a, b] = [legalDoc("en", kind), legalDoc("ar", kind)];
    expect(b.sections.map((s) => s.paragraphs.length)).toEqual(a.sections.map((s) => s.paragraphs.length));
  });

  it("states each plan's real video limits in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const text = JSON.stringify(legalDoc(locale, "terms"));
      for (const plan of ["starter", "pro", "enterprise"] as const) expect(text).toContain(String(PLANS[plan].videoRetentionDays));
    }
  });

  it("uses every placeholder while unreviewed, so nothing is filled in by guesswork", () => {
    for (const locale of ["en", "ar"] as const) {
      const text = JSON.stringify([legalDoc(locale, "terms"), legalDoc(locale, "privacy")]);
      for (const value of Object.values(legalPlaceholders(locale))) expect(text).toContain(value);
    }
    expect(LEGAL_DETAILS.reviewed).toBe(false);
  });
});
