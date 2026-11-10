import { JOB_FEATURES, type JobFeature } from "@/features/analytics/config";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

// Credit rules, edited by super admins in the console (Admin → Credits) and stored on the
// `platform_settings` row. Pure and client-safe: the server charges with these functions and the
// UI shows the same numbers before a job runs. The defaults apply until an admin saves rules.

export const VIDEO_RESOLUTIONS = ["360p", "480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** Tools with a flat per-job cost and a plan-access setting. Video is priced by length and resolution, and plan-gated in code. */
export const PRICED_FEATURES = JOB_FEATURES.filter((f): f is Exclude<JobFeature, "video"> => f !== "video");
export type PricedFeature = Exclude<JobFeature, "video">;

export type CreditRules = {
  /** Monthly credits included in each plan (an org's `creditsOverride` replaces it). */
  planCredits: Record<PlanId, number>;
  /** Credits one job of each tool uses. 0 makes the tool free. */
  featureCosts: Record<PricedFeature, number>;
  /** Video jobs: (base + perSecond × seconds) × resolution multiplier, rounded up. */
  video: { base: number; perSecond: number; resolution: Record<VideoResolution, number> };
  /** Tools each plan can use. A tool missing here is refused before it reaches the provider. */
  planFeatures: Record<PlanId, PricedFeature[]>;
};

/** Video is a paid-plan feature by product decision; no setting can give it to Free. */
export const planHasVideo = (plan: PlanId) => plan !== "free";

export const LIMITS = { planCredits: 1_000_000, cost: 10_000, multiplier: 100 } as const;

export const DEFAULT_CREDIT_RULES: CreditRules = {
  planCredits: Object.fromEntries(PLAN_IDS.map((p) => [p, PLANS[p].creditsMonthly])) as Record<PlanId, number>,
  // A music track is a longer generation than a voice line or an image.
  featureCosts: Object.fromEntries(PRICED_FEATURES.map((f) => [f, f === "music" ? 2 : 1])) as Record<PricedFeature, number>,
  video: { base: 0, perSecond: 2, resolution: { "360p": 0.5, "480p": 0.75, "720p": 1, "1080p": 2 } },
  planFeatures: Object.fromEntries(PLAN_IDS.map((p) => [p, [...PRICED_FEATURES]])) as Record<PlanId, PricedFeature[]>,
};

const isPriced = (f: unknown): f is PricedFeature => (PRICED_FEATURES as readonly unknown[]).includes(f);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A whole number in [0, max], or null when the value isn't one. */
function wholeNumber(value: unknown, max: number) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** A multiplier in (0, max] with at most two decimals, or null. */
function multiplier(value: unknown, max: number) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max && Math.round(n * 100) === n * 100 ? n : null;
}

/**
 * Validates rules from the admin form. Returns null if any value is out of range, so a typo never
 * half-saves. Tools added to the app later than the saved rules get their defaults.
 */
export function parseCreditRules(input: unknown): CreditRules | null {
  const raw = record(input);
  const plans = record(raw.planCredits);
  const costs = record(raw.featureCosts);
  const video = record(raw.video);
  const resolution = record(video.resolution);
  const access = record(raw.planFeatures);

  const planCredits = {} as Record<PlanId, number>;
  for (const p of PLAN_IDS) {
    const n = wholeNumber(plans[p], LIMITS.planCredits);
    if (n === null) return null;
    planCredits[p] = n;
  }
  const featureCosts = {} as Record<PricedFeature, number>;
  for (const f of PRICED_FEATURES) {
    const n = wholeNumber(costs[f], LIMITS.cost);
    if (n === null) return null;
    featureCosts[f] = n;
  }
  const base = wholeNumber(video.base, LIMITS.cost);
  const perSecond = wholeNumber(video.perSecond, LIMITS.cost);
  if (base === null || perSecond === null) return null;
  const multipliers = {} as Record<VideoResolution, number>;
  for (const r of VIDEO_RESOLUTIONS) {
    const m = multiplier(resolution[r], LIMITS.multiplier);
    if (m === null) return null;
    multipliers[r] = m;
  }
  const planFeatures = {} as Record<PlanId, PricedFeature[]>;
  for (const p of PLAN_IDS) {
    if (!Array.isArray(access[p])) return null;
    planFeatures[p] = PRICED_FEATURES.filter((f) => (access[p] as unknown[]).includes(f));
  }
  return { planCredits, featureCosts, video: { base, perSecond, resolution: multipliers }, planFeatures };
}

/** Saved rules merged over the defaults (tolerates rules saved before a tool existed). */
export function withDefaults(saved: unknown): CreditRules {
  if (!saved) return DEFAULT_CREDIT_RULES;
  const raw = record(saved);
  const d = DEFAULT_CREDIT_RULES;
  const savedAccess = record(raw.planFeatures);
  const knownTools = Array.isArray(raw.knownFeatures) ? (raw.knownFeatures as unknown[]) : PRICED_FEATURES;
  const merged = {
    planCredits: { ...d.planCredits, ...record(raw.planCredits) },
    featureCosts: { ...d.featureCosts, ...record(raw.featureCosts) },
    video: { ...d.video, ...record(raw.video), resolution: { ...d.video.resolution, ...record(record(raw.video).resolution) } },
    planFeatures: Object.fromEntries(
      PLAN_IDS.map((p) => {
        const list = savedAccess[p];
        if (!Array.isArray(list)) return [p, d.planFeatures[p]];
        // A tool that didn't exist when the rules were saved is on by default.
        return [p, PRICED_FEATURES.filter((f) => list.includes(f) || !knownTools.includes(f))];
      }),
    ),
  };
  return parseCreditRules(merged) ?? d;
}

/** What rules look like in the database: the tools known at save time travel with them. */
export const toStored = (rules: CreditRules) => ({ ...rules, knownFeatures: [...PRICED_FEATURES] });

export const planCreditsFor = (rules: CreditRules, org: { plan: PlanId; creditsOverride: number | null }) => org.creditsOverride ?? rules.planCredits[org.plan];

/** Flat cost of one job. Video jobs pass their own cost (videoCost) instead. */
export function jobCost(rules: CreditRules, feature: string) {
  return isPriced(feature) ? rules.featureCosts[feature] : 1;
}

export function videoCost(rules: Pick<CreditRules, "video">, input: { seconds: number; resolution: VideoResolution }) {
  const seconds = Math.max(0, Math.ceil(input.seconds));
  return Math.ceil((rules.video.base + rules.video.perSecond * seconds) * rules.video.resolution[input.resolution]);
}

/** Generated voice-over and music are for the video editor, a paid-plan tool; admins can still turn them off per plan. */
export const PAID_ONLY_FEATURES = ["voice", "music"] as const;

/** Video (and editor audio) follow the paid-plan rule; tools without a plan setting are always allowed. */
export function planAllows(rules: CreditRules, plan: PlanId, feature: string) {
  if (feature === "video") return planHasVideo(plan);
  if ((PAID_ONLY_FEATURES as readonly string[]).includes(feature) && !planHasVideo(plan)) return false;
  return !isPriced(feature) || rules.planFeatures[plan].includes(feature);
}
