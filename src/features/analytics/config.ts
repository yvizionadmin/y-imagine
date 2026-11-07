import type { Feature } from "@/lib/ai/types";

export const JOB_FEATURES = ["create", "video", "generate", "recolor", "aplus", "looks", "upscale", "copy"] as const satisfies readonly Feature[];
export type JobFeature = (typeof JOB_FEATURES)[number];

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
