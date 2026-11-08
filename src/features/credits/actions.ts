"use server";

import type { PricedFeature } from "@/lib/credits";
import { getPlatformSettings } from "@/lib/platform/settings";
import { getWorkspace } from "@/lib/workspace";

/** Credits one job of each tool costs (Admin → Credits), for the cost shown before Generate. */
export async function getJobCosts(): Promise<Record<PricedFeature, number>> {
  await getWorkspace({ read: true });
  return (await getPlatformSettings()).creditRules.featureCosts;
}
