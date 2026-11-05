import type { AplusLayout } from "@/lib/ai/types";

/** Plan-quota jobs consumed by one A+ image. */
export const APLUS_COST = 1;

export const FEATURE_RANGE = { min: 2, max: 4 } as const;

export const TEXT_LIMITS = { title: 60, subtitle: 120, featureTitle: 40, featureDescription: 120 } as const;

/** Reference layouts offered in "Pick from scene library". */
export const layoutPresets: AplusLayout[] = ["bento", "gallery"];
