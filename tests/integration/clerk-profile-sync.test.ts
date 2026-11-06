import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { getUser, insertUser } from "@/lib/auth/users";
import { listMembers } from "@/lib/team/members";
import { makeOrg, uniqueEmail } from "../helpers";

// Clerk `user.updated` → our user row and memberships. Clerk is stubbed: the profile it returns
// is set per test, and webhook requests are signed like Clerk (svix) does.

let profile: { name: string; email: string | null } = { name: "", email: null };
vi.mock("@/lib/auth/clerk", async (original) => ({
  ...(await original<typeof import("@/lib/auth/clerk")>()),
  getClerkProfile: async () => profile,
}));

const { syncClerkProfile } = await import("@/lib/auth/profile-sync");
const { POST } = await import("@/app/api/clerk/webhook/route");

async function clerkUserInOrg() {
  const made = await makeOrg("pro");
  const clerkUserId = `user_${randomUUID().slice(0, 12)}`;
  const user = await insertUser({ name: "Sam Lee", email: uniqueEmail("sam"), clerkUserId, createdBy: "test" });
  const { ensureMembership } = await import("@/lib/team/members");
  await ensureMembership({ orgId: made.org.id, userId: user.id, name: user.name, email: user.email, role: "editor", invitedBy: null });
  return { made, user, clerkUserId };
}

const SECRET_BYTES = Buffer.from("imagine-test-webhook-secret-32by");
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signed(body: unknown, secretBytes = SECRET_BYTES) {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify(body);
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return new NextRequest("https://app.test/api/clerk/webhook", {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
  });
}

/** Clerk on, for the webhook (test users are created before, so no Clerk account is made for them). */
function clerkOn() {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SIGNING_SECRET);
}
afterEach(() => vi.unstubAllEnvs());

describe("Clerk profile sync", () => {
  it("copies a new name and verified email to the user and every membership", async () => {
    const { made, user, clerkUserId } = await clerkUserInOrg();
    const email = uniqueEmail("samuel");
    profile = { name: "Samuel Lee", email: email.toUpperCase() };
    expect(await syncClerkProfile(clerkUserId)).toBe("updated");

    expect(await getUser(user.id)).toMatchObject({ name: "Samuel Lee", email });
    expect((await listMembers({ orgId: made.org.id })).find((m) => m.userId === user.id)).toMatchObject({ name: "Samuel Lee", email });
    expect((await listAudit(made.org.id, { prefix: "member." }))[0]).toMatchObject({ action: "member.profile_updated", target: email });
    expect(await syncClerkProfile(clerkUserId)).toBe("unchanged");
  });

  it("keeps the old email when it is unverified or used by another account", async () => {
    const { user, clerkUserId } = await clerkUserInOrg();
    profile = { name: "Sam Lee", email: null };
    expect(await syncClerkProfile(clerkUserId)).toBe("unchanged");

    const other = await insertUser({ name: "Other", email: uniqueEmail("other"), password: "test-password-1", createdBy: "test" });
    profile = { name: "Sam L.", email: other.email };
    expect(await syncClerkProfile(clerkUserId)).toBe("updated");
    expect(await getUser(user.id)).toMatchObject({ name: "Sam L.", email: user.email });
    expect(await syncClerkProfile("user_never_seen")).toBe("unknown_user");
  });
});

describe("Clerk webhook", () => {
  it("syncs on a signed user.updated event and ignores other events", async () => {
    const { user, clerkUserId } = await clerkUserInOrg();
    clerkOn();
    profile = { name: "Webhook Name", email: null };
    expect((await POST(signed({ type: "user.updated", data: { id: clerkUserId }, object: "event" }))).status).toBe(204);
    expect((await getUser(user.id))?.name).toBe("Webhook Name");

    profile = { name: "Ignored", email: null };
    expect((await POST(signed({ type: "session.created", data: { id: "sess_1" }, object: "event" }))).status).toBe(204);
    expect((await getUser(user.id))?.name).toBe("Webhook Name");
  });

  it("refuses bad signatures and answers 404 when not configured", async () => {
    clerkOn();
    expect((await POST(signed({ type: "user.updated", data: { id: "user_x" } }, Buffer.from("wrong-secret-wrong-secret-wrong!")))).status).toBe(400);
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    expect((await POST(signed({ type: "user.updated", data: { id: "user_x" } }))).status).toBe(404);
  });
});
