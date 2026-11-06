import { describe, expect, it } from "vitest";
import { JOB_FEATURES } from "@/features/analytics/config";
import { DEFAULT_CREDIT_RULES, jobCost, parseCreditRules, planAllows, planCreditsFor, planHasVideo, toStored, videoCost, withDefaults, type CreditRules } from "@/lib/credits";
import { PLANS } from "@/lib/plans";

const rules = (patch: (r: CreditRules) => void = () => {}) => {
  const r = structuredClone(DEFAULT_CREDIT_RULES);
  patch(r);
  return r;
};

describe("credit rules", () => {
  it("defaults match the plans and charge 1 credit per tool", () => {
    expect(DEFAULT_CREDIT_RULES.planCredits.pro).toBe(PLANS.pro.creditsMonthly);
    for (const f of JOB_FEATURES) expect(jobCost(DEFAULT_CREDIT_RULES, f)).toBe(1);
  });

  it("parses form strings and rejects out-of-range values", () => {
    const form = JSON.parse(JSON.stringify(DEFAULT_CREDIT_RULES, (_k, v) => (typeof v === "number" ? String(v) : v)));
    expect(parseCreditRules(form)).toEqual(DEFAULT_CREDIT_RULES);
    expect(parseCreditRules(rules((r) => (r.featureCosts.copy = -1)))).toBeNull();
    expect(parseCreditRules(rules((r) => (r.featureCosts.copy = 1.5)))).toBeNull();
    expect(parseCreditRules(rules((r) => (r.planCredits.free = 2_000_000)))).toBeNull();
    expect(parseCreditRules(rules((r) => (r.video.resolution["720p"] = 0)))).toBeNull();
    expect(parseCreditRules(rules((r) => (r.video.resolution["720p"] = 1.234)))).toBeNull();
    expect(parseCreditRules({ ...DEFAULT_CREDIT_RULES, planFeatures: { ...DEFAULT_CREDIT_RULES.planFeatures, free: "all" } })).toBeNull();
    expect(parseCreditRules(null)).toBeNull();
  });

  it("drops unknown tools from plan access", () => {
    const parsed = parseCreditRules({ ...DEFAULT_CREDIT_RULES, planFeatures: { ...DEFAULT_CREDIT_RULES.planFeatures, free: ["copy", "hack"] } });
    expect(parsed?.planFeatures.free).toEqual(["copy"]);
  });

  it("merges saved rules over defaults; tools added after saving are on", () => {
    const saved = { ...toStored(rules((r) => (r.planFeatures.free = ["copy"]))), knownFeatures: ["copy", "generate"] };
    const merged = withDefaults(saved);
    expect(merged.planFeatures.free).toContain("copy");
    expect(merged.planFeatures.free).not.toContain("generate");
    expect(merged.planFeatures.free).toContain("recolor");
    expect(withDefaults(null)).toEqual(DEFAULT_CREDIT_RULES);
    expect(withDefaults({ planCredits: { pro: "oops" } })).toEqual(DEFAULT_CREDIT_RULES);
  });

  it("prices video by duration and resolution, rounding up", () => {
    const r = rules((x) => (x.video = { base: 1, perSecond: 2, resolution: { "360p": 0.5, "720p": 1, "1080p": 1.5 } }));
    expect(videoCost(r, { seconds: 5, resolution: "720p" })).toBe(11);
    expect(videoCost(r, { seconds: 5, resolution: "360p" })).toBe(6);
    expect(videoCost(r, { seconds: 8, resolution: "1080p" })).toBe(26);
    expect(videoCost(r, { seconds: 4.2, resolution: "720p" })).toBe(11);
  });

  it("uses the org override before the plan, and checks plan access", () => {
    const r = rules((x) => ((x.planCredits.starter = 300), (x.planFeatures.free = ["copy"])));
    expect(planCreditsFor(r, { plan: "starter", creditsOverride: null })).toBe(300);
    expect(planCreditsFor(r, { plan: "starter", creditsOverride: 42 })).toBe(42);
    expect(planAllows(r, "free", "copy")).toBe(true);
    expect(planAllows(r, "free", "generate")).toBe(false);
    expect(planAllows(r, "free", "chat")).toBe(true);
  });

  it("keeps video off the Free plan", () => {
    expect(planHasVideo("free")).toBe(false);
    expect(planHasVideo("starter")).toBe(true);
    expect(planHasVideo("enterprise")).toBe(true);
  });
});
