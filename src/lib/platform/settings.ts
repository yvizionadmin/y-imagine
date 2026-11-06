import "server-only";
import { db, schema } from "@/lib/db";
import type { Feature } from "@/lib/ai/types";
import { DEFAULT_CREDIT_RULES, toStored, withDefaults, type CreditRules } from "@/lib/credits";
import type { PlanId } from "@/lib/plans";

// Platform-wide switches owned by super admins (the one-row `platform_settings` table; cache it
// in Redis once that lands). Enforced in getWorkspace (maintenance), signUp (sign-ups, default
// plan) and the AI registry (disabled features).

export type PlatformSettings = {
  maintenance: { enabled: boolean; message: string };
  signupsEnabled: boolean;
  defaultPlan: PlanId;
  disabledFeatures: Feature[];
  /** Plan credits, per-tool costs and plan access (Admin → Credits). */
  creditRules: CreditRules;
  updatedAt: string | null;
  updatedBy: string | null;
};

const { platformSettings } = schema;

export const DEFAULT_SETTINGS: PlatformSettings = {
  maintenance: { enabled: false, message: "" },
  signupsEnabled: true,
  defaultPlan: "free",
  disabledFeatures: [],
  creditRules: DEFAULT_CREDIT_RULES,
  updatedAt: null,
  updatedBy: null,
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const [row] = await db.select().from(platformSettings);
  if (!row) return DEFAULT_SETTINGS;
  const { id, creditRules, ...settings } = row;
  return (void id, { ...settings, creditRules: withDefaults(creditRules) });
}

/** Saves the switches; credit rules are kept as they are unless the patch carries new ones. */
export async function savePlatformSettings(patch: Omit<PlatformSettings, "updatedAt" | "updatedBy" | "creditRules"> & { creditRules?: CreditRules }, actor: string) {
  const creditRules = patch.creditRules ?? (await getPlatformSettings()).creditRules;
  const next: PlatformSettings = { ...patch, creditRules, updatedAt: new Date().toISOString(), updatedBy: actor };
  await db
    .insert(platformSettings)
    .values({ id: 1, ...next, creditRules: toStored(next.creditRules) })
    .onConflictDoUpdate({ target: platformSettings.id, set: { ...next, creditRules: toStored(next.creditRules) } });
  return next;
}
