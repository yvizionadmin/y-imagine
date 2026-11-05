import "server-only";
import { redisUrl } from "@/lib/redis";

// BullMQ queues. Platform maintenance runs on schedules registered by the worker at start-up
// (BullMQ job schedulers are idempotent and shared, so several workers don't duplicate them).
// Bulk Copy runs one job per product on its own queue.

export const MAINTENANCE_QUEUE = "maintenance";
export const COPY_BATCH_QUEUE = "copy-batch";

export type CopyItemJob = { orgId: string; itemId: string };

export const IMAGE_BATCH_QUEUE = "image-batch";

export type ImageItemJob = { orgId: string; itemId: string };

export const SCHEDULES = {
  /** Daily at 03:00 UTC. */
  "revalidate-keys": { pattern: "0 3 * * *", tz: "UTC" },
  /** Every 5 minutes. */
  "close-stale-jobs": { every: 5 * 60_000 },
} as const;

export type MaintenanceJob = keyof typeof SCHEDULES;

/** BullMQ connection options; workers need blocking commands, so no per-request retry limit. */
export function queueConnection() {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is required for the job queue and worker");
  return { url, maxRetriesPerRequest: null };
}
