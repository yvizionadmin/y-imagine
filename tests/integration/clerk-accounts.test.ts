import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uniqueEmail } from "../helpers";

// Account operations with Clerk on (keys set), against a stubbed Clerk Backend API.

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
const clerkUsers = new Map<string, { email: string; verified: boolean; first: string; last: string | null }>();
let nextError: { status: number; code: string } | null = null;
let seq = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const userJson = (id: string) => {
  const u = clerkUsers.get(id)!;
  const email = { object: "email_address", id: `idn_${id}`, email_address: u.email, verification: { status: u.verified ? "verified" : "unverified", strategy: "email_code" }, linked_to: [] };
  return { object: "user", id, first_name: u.first, last_name: u.last, primary_email_address_id: `idn_${id}`, email_addresses: [email], phone_numbers: [], web3_wallets: [], external_accounts: [], saml_accounts: [], enterprise_accounts: [], public_metadata: {}, private_metadata: {}, unsafe_metadata: {}, banned: false };
};
const sessionJson = (id: string, userId: string) => ({ object: "session", id, user_id: userId, client_id: "client_1", status: "active", last_active_at: 0, expire_at: 0, abandon_at: 0, created_at: 0, updated_at: 0 });

async function fakeClerk(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = init?.method ?? "GET";
  const path = url.pathname.replace(/^\/v1/, "");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ method, path, body });
  if (nextError) {
    const { status, code } = nextError;
    nextError = null;
    return json({ errors: [{ code, message: code, long_message: code, meta: {} }] }, status);
  }
  let m: RegExpMatchArray | null;
  if (method === "POST" && path === "/users") {
    const id = `user_${++seq}`;
    clerkUsers.set(id, { email: body.email_address[0], verified: true, first: body.first_name, last: body.last_name ?? null });
    return json(userJson(id));
  }
  if ((m = path.match(/^\/users\/([^/]+)$/))) return method === "DELETE" ? json({ object: "user", id: m[1], deleted: true }) : json(userJson(m[1]));
  if ((m = path.match(/^\/users\/([^/]+)\/(ban|unban)$/))) return json(userJson(m[1]));
  if (method === "GET" && path === "/sessions") {
    const userId = url.searchParams.get("user_id")!;
    const data = [sessionJson(`sess_${userId}_a`, userId), sessionJson(`sess_${userId}_b`, userId)];
    return json(url.searchParams.get("paginated") === "true" ? { data, total_count: data.length } : data);
  }
  if ((m = path.match(/^\/sessions\/([^/]+)\/revoke$/))) return json({ ...sessionJson(m[1], "x"), status: "revoked" });
  if (method === "POST" && path === "/invitations") return json({ object: "invitation", id: "inv_1", email_address: body.email_address, status: "pending", public_metadata: {}, created_at: 0, updated_at: 0 });
  return json({ errors: [{ code: "not_stubbed", message: path }] }, 404);
}

let users: typeof import("@/lib/auth/users");
let clerk: typeof import("@/lib/auth/clerk");
let db: typeof import("@/lib/db");
const last = () => calls[calls.length - 1];

beforeAll(async () => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_stub");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_" + Buffer.from("stub.clerk.accounts.dev$").toString("base64"));
  vi.stubGlobal("fetch", fakeClerk);
  // Imported after the stubs: Clerk's client picks up fetch when it's created.
  users = await import("@/lib/auth/users");
  clerk = await import("@/lib/auth/clerk");
  db = await import("@/lib/db");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  calls.length = 0;
});

describe("creating accounts", () => {
  it("creates a Clerk account and a linked row without a local password", async () => {
    const email = uniqueEmail("ada");
    const user = await users.insertUser({ name: "Ada Lovelace", email, password: "correct-horse-9", createdBy: "t" });
    const create = calls.find((c) => c.method === "POST" && c.path === "/users")!;
    expect(create.body).toMatchObject({ password: "correct-horse-9", email_address: [email], first_name: "Ada", last_name: "Lovelace" });
    expect(user.clerkUserId).toBeTruthy();
    expect(user.passwordHash).toBeNull();
  });

  it.each([
    ["form_identifier_exists", "email_taken"],
    ["form_password_pwned", "weak_password"],
  ])("maps Clerk %s to %s and leaves no row", async (code, expected) => {
    const email = uniqueEmail(code);
    nextError = { status: 422, code };
    const error = await users.insertUser({ name: "X", email, password: "password1234", createdBy: "t" }).catch((e) => e);
    expect(error).toBeInstanceOf(clerk.IdentityError);
    expect(error.code).toBe(expected);
    expect(await users.findUserByEmail(email)).toBeNull();
  });

  it("deletes the Clerk account again when the row can't be written", async () => {
    const first = await users.insertUser({ name: "A", email: uniqueEmail(), password: "password1234", createdBy: "t" });
    const error = await users.insertUser({ id: first.id, name: "B", email: uniqueEmail(), password: "password1234", createdBy: "t" }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(last()).toMatchObject({ method: "DELETE" });
    expect(last().path).toMatch(/^\/users\/user_/);
  });
});

describe("first Clerk sign-in", () => {
  it("links an existing row by verified email", async () => {
    const email = uniqueEmail("local");
    const [local] = await db.db.insert(db.schema.users).values({ id: crypto.randomUUID(), name: "Local", email, passwordHash: "scrypt$x$y", createdBy: "t" }).returning();
    clerkUsers.set("user_ext_local", { email, verified: true, first: "Local", last: null });
    expect(await users.linkClerkUser("user_ext_local")).toMatchObject({ id: local.id, clerkUserId: "user_ext_local" });
  });

  it("ignores an unverified email", async () => {
    const email = uniqueEmail("unverified");
    clerkUsers.set("user_ext_unverified", { email, verified: false, first: "U", last: null });
    expect(await users.linkClerkUser("user_ext_unverified")).toBeNull();
    expect(await users.findUserByEmail(email)).toBeNull();
  });

  it("creates a row for a new person", async () => {
    clerkUsers.set("user_ext_new", { email: uniqueEmail("new"), verified: true, first: "Grace", last: "Hopper" });
    expect(await users.linkClerkUser("user_ext_new")).toMatchObject({ name: "Grace Hopper", clerkUserId: "user_ext_new", passwordHash: null });
  });

  it("bans the Clerk account of a row that was disabled before", async () => {
    const email = uniqueEmail("off");
    await db.db.insert(db.schema.users).values({ id: crypto.randomUUID(), name: "Off", email, passwordHash: null, status: "disabled", createdBy: "t" });
    clerkUsers.set("user_ext_off", { email, verified: true, first: "Off", last: null });
    await users.linkClerkUser("user_ext_off");
    expect(calls.some((c) => c.method === "POST" && c.path === "/users/user_ext_off/ban")).toBe(true);
  });
});

describe("console operations", () => {
  it("disable/enable bans and unbans", async () => {
    const user = await users.insertUser({ name: "Target", email: uniqueEmail(), password: "password1234", createdBy: "t" });
    await users.setUserStatus(user, "disabled");
    expect(last().path).toBe(`/users/${user.clerkUserId}/ban`);
    expect((await users.getUser(user.id))?.status).toBe("disabled");
    await users.setUserStatus(user, "active");
    expect(last().path).toBe(`/users/${user.clerkUserId}/unban`);
  });

  it("password reset signs out other sessions; weak passwords map; unlinked users get an account", async () => {
    const user = await users.insertUser({ name: "Target", email: uniqueEmail(), password: "password1234", createdBy: "t" });
    await users.setUserPassword(user, "another-pass-77");
    expect(last()).toMatchObject({ method: "PATCH", body: { password: "another-pass-77", sign_out_of_other_sessions: true } });

    nextError = { status: 422, code: "form_password_length_too_short" };
    expect(await users.setUserPassword(user, "short").catch((e) => e.code)).toBe("weak_password");

    const [unlinked] = await db.db.insert(db.schema.users).values({ id: crypto.randomUUID(), name: "Old", email: uniqueEmail("old"), passwordHash: "scrypt$x$y", createdBy: "t" }).returning();
    expect((await users.setUserPassword(unlinked as never, "brand-new-pass-1"))?.clerkUserId).toBeTruthy();
  });

  it("revokes and counts sessions", async () => {
    expect(await clerk.revokeClerkSessions("user_x")).toBe(2);
    expect(calls.filter((c) => c.path.endsWith("/revoke"))).toHaveLength(2);
    const counts = await clerk.countClerkSessions(["a", "b", "c", "d", "e", "f"]);
    expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("sends invitation emails with the sign-up link", async () => {
    await clerk.sendClerkInvitation("invitee@test.local", "https://app.example.com/ar/sign-up");
    expect(last()).toMatchObject({ path: "/invitations", body: { redirect_url: "https://app.example.com/ar/sign-up", notify: true, ignore_existing: true } });
  });
});
