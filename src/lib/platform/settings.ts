import "server-only";
import { db, schema } from "@/lib/db";
import type { Feature } from "@/lib/ai/types";
import type { PlanId } from "@/lib/plans";

// Platform-wide switches owned by super admins (the one-row `platform_settings` table; cache it
// in Redis once that lands). Enforced in getWorkspace (maintenance), signUp (sign-ups, default
// plan) and the AI registry (disabled features).

export type PlatformSettings = {
  maintenance: { enabled: boolean; message: string };
  signupsEnabled: boolean;
  defaultPlan: PlanId;
  disabledFeatures: Feature[];
  updatedAt: string | null;
  updatedBy: string | null;
};

const { platformSettings } = schema;

export const DEFAULT_SETTINGS: PlatformSettings = {
  maintenance: { enabled: false, message: "" },
  signupsEnabled: true,
  defaultPlan: "free",
  disabledFeatures: [],
  updatedAt: null,
  updatedBy: null,
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const [row] = await db.select().from(platformSettings);
  if (!row) return DEFAULT_SETTINGS;
  const { id, ...settings } = row;
  return (void id, settings);
}

export async function savePlatformSettings(patch: Omit<PlatformSettings, "updatedAt" | "updatedBy">, actor: string) {
  const next: PlatformSettings = { ...patch, updatedAt: new Date().toISOString(), updatedBy: actor };
  await db
    .insert(platformSettings)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({ target: platformSettings.id, set: next });
  return next;
}
