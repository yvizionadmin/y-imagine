import "server-only";
import { headers } from "next/headers";
import { getRedis } from "./redis";

// Fixed-window counters shared by every web instance through Redis, or per process without it.
// If Redis is unreachable a limit fails open (logged): an outage shouldn't lock everyone out.

export type Limit = { limit: number; windowMs: number };

export const LIMITS = {
  /** Failed sign-ins per email, and sign-in/up attempts per IP. */
  signInFailures: { limit: 5, windowMs: 15 * 60_000 },
  // The browser tests sign up many times from one address, so they raise this (playwright.config.ts).
  authPerIp: { limit: Number(process.env.AUTH_LIMIT_PER_IP) || 30, windowMs: 15 * 60_000 },
  /** Password reset emails per address (so the form can't be used to flood an inbox). */
  resetEmailsPerAddress: { limit: 3, windowMs: 60 * 60_000 },
  /** AI jobs: per user, and per org across its members. */
  jobsPerUser: { limit: 12, windowMs: 60_000 },
  jobsPerOrg: { limit: 60, windowMs: 60_000 },
  /** "Improve with AI" prompt rewrites per user (free, so not counted as jobs). */
  promptRewritesPerUser: { limit: 10, windowMs: 60_000 },
  /** Key saves/checks per org (each one calls the provider). */
  keyChecksPerOrg: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, Limit>;

const memory = new Map<string, { count: number; resetAt: number }>();

// INCR, and start the window on the first hit; returns [count, ms left in the window].
const HIT = `local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return {n, redis.call("PTTL", KEYS[1])}`;

async function counter(key: string, windowMs: number, increment: boolean): Promise<{ count: number; resetMs: number }> {
  const redis = getRedis();
  if (redis) {
    try {
      if (!increment) {
        const [count, ttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
        return { count: Number(count ?? 0), resetMs: Math.max(0, ttl) };
      }
      const [count, ttl] = (await redis.eval(HIT, 1, key, windowMs)) as [number, number];
      return { count, resetMs: Math.max(0, ttl) };
    } catch (error) {
      console.error("rate limit: redis unavailable, allowing", { error: (error as Error).message });
      return { count: 0, resetMs: 0 };
    }
  }
  const now = Date.now();
  if (memory.size > 10_000) for (const [k, e] of memory) if (e.resetAt <= now) memory.delete(k);
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
  if (increment) {
    entry.count++;
    memory.set(key, entry);
  }
  return { count: entry.count, resetMs: entry.resetAt - now };
}

/** Counts one attempt; `ok` is false once the window's limit is exceeded. */
export async function hit(name: string, id: string, { limit, windowMs }: Limit) {
  const { count, resetMs } = await counter(`rl:${name}:${id}`, windowMs, true);
  return { ok: count <= limit, retryAfterMs: count <= limit ? 0 : resetMs };
}

/** Whether the limit is already reached, without counting (e.g. failures counted separately). */
export async function isLimited(name: string, id: string, { limit, windowMs }: Limit) {
  return (await counter(`rl:${name}:${id}`, windowMs, false)).count >= limit;
}

export async function clearLimit(name: string, id: string) {
  memory.delete(`rl:${name}:${id}`);
  await getRedis()
    ?.del(`rl:${name}:${id}`)
    .catch(() => undefined);
}

/**
 * The caller's IP. Railway's edge sets X-Real-IP; otherwise the last X-Forwarded-For hop (the one
 * our proxy added; earlier hops are client-supplied and spoofable).
 */
export async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
}
