import "server-only";
import { Redis } from "ioredis";

// Shared Redis (Railway Redis service; locally `brew services start redis`). Optional: without
// REDIS_URL, rate limits fall back to per-process memory and there is no job queue or worker.

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redisUrl = () => process.env.REDIS_URL || null;

/** The app's command connection, or null when Redis isn't configured. */
export function getRedis(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  // Commands wait for the first connect, but give up quickly while Redis is down (one reconnect
  // attempt, 1s per command); callers degrade instead of hanging requests (see rate-limit).
  globalForRedis.redis ??= new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2_000, commandTimeout: 1_000, connectionName: "imagine-web" });
  return globalForRedis.redis;
}
