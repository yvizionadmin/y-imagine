import { describe, expect, it } from "vitest";
import { listProviderKeys, recordKeyCheck, removeProviderKey, revealProviderKey, saveProviderKey } from "@/lib/ai/provider-keys";
import { listAllAudit, listAudit, recordAudit } from "@/lib/audit";
import { findUserByEmail, insertUser } from "@/lib/auth/users";
import { insertConnection, listConnections, loadConnection, removeConnection, setDefaultConnection } from "@/lib/catalog/connections";
import { db, schema } from "@/lib/db";
import { insertGeneration, listGenerations, removeGenerations, updateGenerations } from "@/lib/generations";
import { listRoomBackgrounds, resolveLookBackground } from "@/lib/looks/room-backgrounds";
import { getOrganization, updateOrganization } from "@/lib/platform/organizations";
import { getPlatformSettings, savePlatformSettings } from "@/lib/platform/settings";
import { deleteAsset, getAsset, saveAsset } from "@/lib/storage/assets";
import { acceptInvites, ensureMembership, insertInvite, listMembers, listMembershipsForUser, updateMember } from "@/lib/team/members";
import { makeOrg, uniqueEmail } from "../helpers";

describe("tenant isolation (db.forOrg)", () => {
  it("never returns or changes another org's rows", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const assetId = await saveAsset(a.org.id, new Uint8Array([1, 2, 3]), "image/png");
    expect(await getAsset(b.org.id, assetId)).toBeNull();
    expect((await getAsset(a.org.id, assetId))?.bytes.length).toBe(3);

    const [member] = await listMembers({ orgId: a.org.id });
    expect(await updateMember(b.org.id, member.id, { department: "Nope" })).toBeNull();

    await saveProviderKey({ orgId: a.org.id, provider: "openai", key: "sk-test-aaaa1111", models: null, createdBy: "t" });
    expect(await revealProviderKey(b.org.id, "openai")).toBeNull();

    const gen = await insertGeneration({ orgId: a.org.id, mode: "lifestyle", sku: "S", title: "T", assetId, mimeType: "image/png", width: 1, height: 1, settings: {}, provider: "demo", model: "m", createdBy: "t" });
    expect(await removeGenerations(b.org.id, [gen.id])).toHaveLength(0);
    expect(await listGenerations(b.org.id)).toHaveLength(0);
  });

  it("forOrg inserts always carry the scoped org id", async () => {
    const { org } = await makeOrg();
    const [row] = await db.forOrg(org.id).insert(schema.auditLog, { id: crypto.randomUUID(), action: "org.updated", actor: "t", target: "x", meta: null, orgId: "someone-else" } as never);
    expect(row.orgId).toBe(org.id);
  });
});

describe("organizations, users and memberships", () => {
  it("updates an org", async () => {
    const { org } = await makeOrg();
    expect((await updateOrganization(org.id, { status: "suspended", suspendedReason: "x" }))?.status).toBe("suspended");
    expect((await getOrganization(org.id))?.suspendedReason).toBe("x");
  });

  it("finds users by email case-insensitively and accepts invitations on join", async () => {
    const { org } = await makeOrg();
    const email = uniqueEmail("invitee");
    await insertInvite({ orgId: org.id, email: email.toUpperCase(), role: "editor", department: "QA", invitedBy: "t" });
    const user = await insertUser({ name: "Invitee", email, password: "test-password-1", createdBy: "t" });
    expect((await findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    expect(user.passwordHash).toMatch(/^scrypt\$/);

    const joined = await acceptInvites(user);
    expect(joined.some((m) => m.orgId === org.id && m.status === "active" && m.role === "editor")).toBe(true);

    const again = await ensureMembership({ orgId: org.id, userId: user.id, name: "Invitee", email, role: "admin", invitedBy: null });
    expect(again.role).toBe("admin");
    expect((await listMembers({ orgId: org.id })).filter((m) => m.email === email)).toHaveLength(1);
    expect(await listMembershipsForUser(user.id)).toHaveLength(1);
  });
});

describe("audit log", () => {
  it("filters by action prefix and org", async () => {
    const { org } = await makeOrg();
    await recordAudit({ orgId: org.id, action: "org.updated", actor: "t", target: "x", meta: { a: "b" } });
    expect(await listAudit(org.id, { prefix: "org." })).toHaveLength(1);
    expect(await listAudit(org.id, { prefix: "user." })).toHaveLength(0);
    expect(await listAllAudit({ orgId: org.id })).toHaveLength(1);
  });

  it("treats LIKE wildcards in the prefix literally", async () => {
    const { org } = await makeOrg();
    await recordAudit({ orgId: org.id, action: "org.updated", actor: "t", target: "x" });
    expect(await listAudit(org.id, { prefix: "%" })).toHaveLength(0);
    expect(await listAudit(org.id, { prefix: "org_" })).toHaveLength(0);
  });
});

describe("provider keys", () => {
  it("rotates in place, keeps transient failures valid, invalidates rejected keys", async () => {
    const { org } = await makeOrg();
    const k1 = await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-aaaa1111", models: ["gpt-x"], createdBy: "t" });
    const k2 = await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-bbbb2222", models: null, createdBy: "t" });
    expect(k2.id).toBe(k1.id);
    expect(k2.hint).toMatch(/2222$/);
    expect(await listProviderKeys(org.id)).toHaveLength(1);
    expect(JSON.stringify(await listProviderKeys(org.id))).not.toContain("bbbb2222");
    expect(await revealProviderKey(org.id, "openai")).toBe("sk-test-bbbb2222");

    expect((await recordKeyCheck(org.id, "openai", { ok: false, error: "rate_limited" }))?.status).toBe("valid");
    expect((await recordKeyCheck(org.id, "openai", { ok: false, error: "invalid_key" }))?.status).toBe("invalid");
    await removeProviderKey(org.id, "openai");
    expect(await listProviderKeys(org.id)).toHaveLength(0);
  });

  it("stores keys encrypted", async () => {
    const { org } = await makeOrg();
    await saveProviderKey({ orgId: org.id, provider: "gemini", key: "AIza-plaintext-check-0000", models: null, createdBy: "t" });
    const [row] = await db.$client`select secret::text from provider_credentials where org_id = ${org.id}`;
    expect(row.secret).not.toContain("plaintext-check");
  });
});

describe("catalog connections", () => {
  it("first is default, default can move, and moves on when it is removed", async () => {
    const { org } = await makeOrg();
    const settings = { config: { url: "https://example.com/{sku}" }, secrets: { token: "secret-1234" } };
    const c1 = await insertConnection({ orgId: org.id, type: "custom-rest", name: "A", settings, createdBy: "t", lastTest: null });
    const c2 = await insertConnection({ orgId: org.id, type: "custom-rest", name: "B", settings, createdBy: "t", lastTest: null });
    expect(c1.isDefault && !c2.isDefault).toBe(true);
    await setDefaultConnection(org.id, c2.id);
    expect((await listConnections(org.id)).find((c) => c.isDefault)?.id).toBe(c2.id);
    expect(JSON.stringify(await listConnections(org.id))).not.toContain("secret-1234");
    expect((await loadConnection(org.id))?.settings.secrets.token).toBe("secret-1234");
    await removeConnection(org.id, c2.id);
    expect((await listConnections(org.id)).find((c) => c.isDefault)?.id).toBe(c1.id);
  });
});

describe("generations, assets, room backgrounds", () => {
  it("updates and removes generations; deletes asset bytes", async () => {
    const { org } = await makeOrg();
    const assetId = await saveAsset(org.id, new Uint8Array([9, 9]), "image/png");
    const gen = await insertGeneration({ orgId: org.id, mode: "lifestyle", sku: "S", title: "T", assetId, mimeType: "image/png", width: 1, height: 1, settings: {}, provider: "demo", model: "m", createdBy: "t" });
    await updateGenerations(org.id, [gen.id], { status: "uploaded", publishedAt: new Date().toISOString() });
    expect((await listGenerations(org.id))[0].status).toBe("uploaded");
    expect(await removeGenerations(org.id, [gen.id])).toHaveLength(1);
    await deleteAsset(org.id, assetId, "image/png");
    expect(await getAsset(org.id, assetId)).toBeNull();
  });

  it("seeds starter room backgrounds once per org", async () => {
    const { org } = await makeOrg();
    const [first, second] = await Promise.all([listRoomBackgrounds(org.id), listRoomBackgrounds(org.id)]);
    expect(Math.max(first.length, second.length)).toBe(3);
    expect(await listRoomBackgrounds(org.id)).toHaveLength(3);
  });

  it("resolves a look's background within its category", async () => {
    const { org } = await makeOrg();
    const seeded = await listRoomBackgrounds(org.id);
    // Furniture uses the org's own (seeded) backgrounds; an unknown id falls back to the first.
    expect((await resolveLookBackground(org.id, "furniture", seeded[1].id))?.id).toBe(seeded[1].id);
    expect((await resolveLookBackground(org.id, "furniture", "scene:urbanStreet"))?.id).toBe(seeded[0].id);
    // Fashion has none of its own, so it renders on the preset scene, read from public/.
    const fashion = await resolveLookBackground(org.id, "fashion", "scene:urbanStreet");
    expect(fashion?.id).toBe("scene:urbanStreet");
    const image = await fashion!.load();
    expect(image?.mimeType).toBe("image/jpeg");
    expect(image?.bytes.length).toBeGreaterThan(0);
  });

  it("resolves an uploaded look background for its own org only", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const assetId = await saveAsset(a.org.id, new Uint8Array([1, 2, 3]), "image/webp", "look-background");
    const own = await resolveLookBackground(a.org.id, "fashion", `upload:${assetId}`);
    expect(own?.id).toBe(`upload:${assetId}`);
    expect((await own!.load())?.mimeType).toBe("image/webp");
    // Another org's asset id falls back to that org's category choices.
    expect((await resolveLookBackground(b.org.id, "fashion", `upload:${assetId}`))?.id).toBe("scene:studioBackdrop");
  });
});

describe("platform settings", () => {
  it("saves and reads back", async () => {
    const before = await getPlatformSettings();
    await savePlatformSettings({ ...before, signupsEnabled: false }, "t");
    expect((await getPlatformSettings()).signupsEnabled).toBe(false);
    await savePlatformSettings({ maintenance: before.maintenance, signupsEnabled: before.signupsEnabled, defaultPlan: before.defaultPlan, disabledFeatures: before.disabledFeatures }, "t");
  });
});
