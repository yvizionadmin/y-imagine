import { afterEach, describe, expect, it, vi } from "vitest";

// Only the browser tests raise the sign-in/up limit per address; real deployments keep the default.

const authPerIp = async () => {
  vi.resetModules();
  return (await import("@/lib/rate-limit")).LIMITS.authPerIp.limit;
};

afterEach(() => vi.unstubAllEnvs());

describe("auth limit per IP", () => {
  it("is 30 unless set", async () => {
    vi.stubEnv("AUTH_LIMIT_PER_IP", "");
    expect(await authPerIp()).toBe(30);
  });

  it("falls back to 30 on a value that isn't a positive number, so it can't switch the limit off", async () => {
    for (const value of ["abc", "0"]) {
      vi.stubEnv("AUTH_LIMIT_PER_IP", value);
      expect(await authPerIp(), value).toBe(30);
    }
  });

  it("follows the setting", async () => {
    vi.stubEnv("AUTH_LIMIT_PER_IP", "1000");
    expect(await authPerIp()).toBe(1000);
  });
});
