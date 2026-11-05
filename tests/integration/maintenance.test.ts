import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderKeys, saveProviderKey } from "@/lib/ai/provider-keys";
import { listAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { closeStaleJobs, revalidateAllKeys } from "@/lib/jobs/maintenance";
import { makeOrg } from "../helpers";

afterEach(() => vi.unstubAllEnvs());

describe("scheduled maintenance", () => {
  it("re-validates keys: rejected keys flip to invalid, only changes are audited", async () => {
    vi.stubEnv("IMAGINE_DEMO", "1"); // demo-… keys are checked offline
    const { org } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "openai", key: "demo-good-key-123456", models: ["gpt-image-1"], createdBy: "t" });
    await saveProviderKey({ orgId: org.id, provider: "gemini", key: "demo-bad-key-1234567", models: ["gemini-2.5-flash-image"], createdBy: "t" });

    const first = await revalidateAllKeys();
    expect(first.failed).toBe(0);
    const keys = await listProviderKeys(org.id);
    expect(keys.find((k) => k.provider === "openai")?.status).toBe("valid");
    expect(keys.find((k) => k.provider === "gemini")?.status).toBe("invalid");
    const audit = (await listAudit(org.id, { prefix: "provider_key.validated" })).filter((a) => a.meta?.via === "scheduled");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ target: "gemini", actor: "Imagine AI", meta: { result: "invalid_key" } });

    await revalidateAllKeys();
    expect((await listAudit(org.id, { prefix: "provider_key.validated" })).filter((a) => a.meta?.via === "scheduled")).toHaveLength(1);
  });

  it("closes running jobs older than 15 minutes only", async () => {
    const { org, user } = await makeOrg();
    const insert = (id: string, minutesAgo: number) =>
      db.$client`insert into usage_events (id, org_id, feature, user_id, user_name, provider, status, at) values (${id}, ${org.id}, 'generate', ${user.id}, 'T', 'openai', 'running', now() - make_interval(mins => ${minutesAgo}))`;
    await insert(`${org.id}-stale`, 20);
    await insert(`${org.id}-fresh`, 1);
    expect((await closeStaleJobs()).closed).toBeGreaterThanOrEqual(1);
    const rows = await db.$client`select id, status, error from usage_events where org_id = ${org.id} order by id`;
    expect(rows.find((r) => r.id.endsWith("-stale"))).toMatchObject({ status: "error", error: "timed_out" });
    expect(rows.find((r) => r.id.endsWith("-fresh"))).toMatchObject({ status: "running" });
  });
});
