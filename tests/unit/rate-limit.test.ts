import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const limit = { limit: 3, windowMs: 2_000 };
const id = () => `t-${Math.random().toString(36).slice(2)}`;

describe.each([
  ["in memory", ""],
  ["redis", process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15"],
])("rate limits (%s)", (_name, url) => {
  let rl: typeof import("@/lib/rate-limit");
  let available = true;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("REDIS_URL", url);
    rl = await import("@/lib/rate-limit");
    if (url) {
      const { getRedis } = await import("@/lib/redis");
      available = await getRedis()!.ping().then(() => true, () => false);
    }
  });
  afterAll(async () => {
    if (url) (await import("@/lib/redis")).getRedis()?.disconnect();
    vi.unstubAllEnvs();
  });

  it("allows the limit, then blocks with a retry time", async ({ skip }) => {
    if (!available) skip("redis not running");
    const key = id();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rl.hit("test", key, limit));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[4].retryAfterMs).toBeGreaterThan(0);
    expect(results[4].retryAfterMs).toBeLessThanOrEqual(2_000);
  });

  it("peeks without counting, and clears", async ({ skip }) => {
    if (!available) skip("redis not running");
    const key = id();
    expect(await rl.isLimited("test", key, limit)).toBe(false);
    for (let i = 0; i < 3; i++) await rl.hit("test", key, limit);
    expect(await rl.isLimited("test", key, limit)).toBe(true);
    expect(await rl.isLimited("test", key, limit)).toBe(true);
    await rl.clearLimit("test", key);
    expect(await rl.isLimited("test", key, limit)).toBe(false);
  });

  it("starts a new window after it expires", async ({ skip }) => {
    if (!available) skip("redis not running");
    const key = id();
    const short = { limit: 1, windowMs: 300 };
    expect((await rl.hit("test", key, short)).ok).toBe(true);
    expect((await rl.hit("test", key, short)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 400));
    expect((await rl.hit("test", key, short)).ok).toBe(true);
  });
});

describe("rate limits when redis is down", () => {
  it("fail open instead of locking everyone out", async () => {
    vi.resetModules();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    const rl = await import("@/lib/rate-limit");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) expect((await rl.hit("test", "down", { limit: 1, windowMs: 1000 })).ok).toBe(true);
    expect(errors).toHaveBeenCalled();
    (await import("@/lib/redis")).getRedis()?.disconnect();
    vi.unstubAllEnvs();
  });
});
