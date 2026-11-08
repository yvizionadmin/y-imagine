import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { findUserByEmail, insertUser } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { ensureMembership } from "@/lib/team/members";
import type { Workspace } from "@/lib/workspace";
import { makeOrg, uniqueEmail } from "../helpers";

// Emails through the local outbox transport (EMAIL_OUTBOX_DIR, set in vitest.config.mts): team
// invitations, local-login password reset, and copy review notices.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("next/headers", async (original) => ({
  ...(await original<typeof import("next/headers")>()),
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("@/lib/copy/batch-queue", async (original) => ({ ...(await original<typeof import("@/lib/copy/batch-queue")>()), dispatchItems: async () => {} }));

const { inviteMember, resendInvite } = await import("@/features/team/actions");
const { requestPasswordReset, resetPassword } = await import("@/features/auth/actions");
const { generateProductCopy, reviewCopy } = await import("@/features/copy/actions");
const { listMembers } = await import("@/lib/team/members");

const OUTBOX = path.resolve(".data/test-outbox");
type Sent = { to: string; subject: string; html: string; text: string };

async function outbox(): Promise<Sent[]> {
  // Skips macOS "._" metadata files (the repo can live on an exFAT drive).
  const files = (await readdir(OUTBOX).catch(() => [])).filter((f) => !f.startsWith(".")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(OUTBOX, f), "utf8")) as Sent));
}

type Made = Awaited<ReturnType<typeof makeOrg>>;
const as = (made: Made, role: Workspace["role"], user = made.user) => {
  workspace = { orgId: made.org.id, orgName: made.org.name, role, plan: made.org.plan, user: { id: user.id, name: user.name, email: user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
};

beforeEach(async () => {
  await rm(OUTBOX, { recursive: true, force: true });
  await mkdir(OUTBOX, { recursive: true });
  vi.stubEnv("IMAGINE_DEMO", "1");
});

describe("invitation emails", () => {
  it("emails a sign-up link to new people and a sign-in link to existing accounts", async () => {
    const made = await makeOrg("pro");
    as(made, "admin");
    const newcomer = uniqueEmail("new");
    expect(await inviteMember({ email: newcomer, role: "editor", department: "" })).toEqual({ ok: true, emailed: true });

    const existing = await insertUser({ name: "Existing Person", email: uniqueEmail("old"), password: "test-password-1", createdBy: "test" });
    expect(await inviteMember({ email: existing.email, role: "viewer", department: "" })).toEqual({ ok: true, emailed: true });

    const [toNew, toExisting] = await outbox();
    expect(toNew.to).toBe(newcomer);
    expect(toNew.subject).toBe(`${made.user.name} invited you to ${made.org.name} on Imagine AI`);
    expect(toNew.text).toContain(`https://app.test/en/sign-up?email=${encodeURIComponent(newcomer)}`);
    expect(toNew.html).toContain('dir="ltr"');
    expect(toExisting.text).toContain("https://app.test/en/sign-in");

    const invite = (await listMembers({ orgId: made.org.id })).find((m) => m.email === newcomer)!;
    expect(await resendInvite(invite.id)).toEqual({ ok: true, emailed: true });
    expect(await outbox()).toHaveLength(3);
  });

  it("says when no email could be sent (production without a transport)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_OUTBOX_DIR", "");
    const made = await makeOrg("pro");
    as(made, "admin");
    expect(await inviteMember({ email: uniqueEmail(), role: "editor", department: "" })).toEqual({ ok: true, emailed: false });
    expect(await outbox()).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});

describe("password reset (local login)", () => {
  it("emails a one-time link that sets a new password", async () => {
    const made = await makeOrg("pro");
    expect(await requestPasswordReset({ email: made.user.email.toUpperCase() })).toEqual({ ok: true });
    const [mail] = await outbox();
    expect(mail.to).toBe(made.user.email);
    const token = /reset-password\?token=([\w-]+)/.exec(mail.text)![1];

    expect(await resetPassword({ token, password: "short" })).toEqual({ ok: false, error: "weak_password" });
    expect(await resetPassword({ token, password: "brand-new-password" })).toEqual({ ok: true });
    expect(await verifyPassword("brand-new-password", (await findUserByEmail(made.user.email))!.passwordHash!)).toBe(true);
    // One use only.
    expect(await resetPassword({ token, password: "another-password-2" })).toEqual({ ok: false, error: "invalid_token" });
    expect((await listAudit(made.org.id, { prefix: "auth." })).map((e) => e.action)).toContain("auth.password_reset");
  });

  it("answers the same for unknown emails and caps emails per address", async () => {
    expect(await requestPasswordReset({ email: uniqueEmail("nobody") })).toEqual({ ok: true });
    expect(await outbox()).toHaveLength(0);

    const made = await makeOrg("pro");
    for (let i = 0; i < 5; i++) expect(await requestPasswordReset({ email: made.user.email })).toEqual({ ok: true });
    const mails = await outbox();
    expect(mails).toHaveLength(3);
    // A newer link replaces the older ones.
    const first = /token=([\w-]+)/.exec(mails[0].text)![1];
    expect(await resetPassword({ token: first, password: "brand-new-password" })).toEqual({ ok: false, error: "invalid_token" });
  });
});

describe("copy review notices", () => {
  it("tells admins about copy sent for review, and the author about the decision", async () => {
    const made = await makeOrg("pro");
    const writer = await insertUser({ name: "Copy Writer", email: uniqueEmail("writer"), password: "test-password-1", createdBy: "test" });
    await ensureMembership({ orgId: made.org.id, userId: writer.id, name: writer.name, email: writer.email, role: "editor", invitedBy: null });

    as(made, "editor", writer);
    const data = new FormData();
    for (const [k, v] of Object.entries({ sku: "LAMP-1", productName: "Arc Lamp", category: "furniture", details: "Brass", keywords: "", tone: "friendly", length: "short", channel: "website", languages: "en" })) data.append(k, v);
    const written = await generateProductCopy(data);
    if (!written.ok) throw new Error(written.error);
    expect((await reviewCopy(written.copy.id, "submit")).ok).toBe(true);

    as(made, "admin");
    expect((await reviewCopy(written.copy.id, "request_changes", "Mention the dimmer")).ok).toBe(true);

    const [toAdmin, toWriter] = await outbox();
    expect(toAdmin).toMatchObject({ to: made.user.email, subject: "Copy Writer sent 1 product for review" });
    expect(toWriter).toMatchObject({ to: writer.email, subject: "Changes requested: Arc Lamp" });
    expect(toWriter.text).toContain("> Mention the dimmer");
    expect(toWriter.text).toContain(`https://app.test/en/copy?copy=${written.copy.id}`);
  });
});
