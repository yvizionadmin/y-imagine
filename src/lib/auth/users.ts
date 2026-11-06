import "server-only";
import { randomUUID } from "node:crypto";
import { asc, count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { insertOrganization, getOrganization } from "@/lib/platform/organizations";
import { createClerkUser, deleteClerkUser, getClerkProfile, setClerkBanned, setClerkPassword } from "./clerk";
import { clerkEnabled } from "./constants";
import { DEMO_EMAIL } from "./demo";
import { hashPassword } from "./password";

// Platform users. With Clerk, each row links to a Clerk account (`clerkUserId`) that owns the
// password and sessions; without it, `passwordHash` backs the local login. A user joins orgs through
// memberships (src/lib/team/members.ts); `platformRole` is separate from org roles and lives only here.

export type PlatformRole = "super_admin";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  clerkUserId: string | null;
  lastSessionId: string | null;
  platformRole: PlatformRole | null;
  status: "active" | "disabled";
  createdBy: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

/** Safe to send to the browser. */
export type UserView = Omit<User, "passwordHash" | "lastSessionId">;
export const toView = ({ passwordHash, lastSessionId, ...user }: User): UserView => (void passwordHash, void lastSessionId, user);

const { users } = schema;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Emails promoted to super admin on sign-in (bootstrap; never grant this from the browser). */
const superAdminEmails = () =>
  new Set((process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));

export async function listUsers(): Promise<User[]> {
  await ensureSeed();
  return db.select().from(users).orderBy(asc(users.createdAt));
}

export async function getUser(id: string): Promise<User | null> {
  await ensureSeed();
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  await ensureSeed();
  const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return row ?? null;
}

export async function findUserByClerkId(clerkUserId: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId));
  return row ?? null;
}

/**
 * Adds a user. With `clerkUserId` the Clerk account already exists (first Clerk sign-in); otherwise
 * `password` creates one: a Clerk account when Clerk is on, else a local password hash.
 */
export async function insertUser(input: {
  name: string;
  email: string;
  createdBy: string | null;
  password?: string;
  clerkUserId?: string;
  platformRole?: PlatformRole | null;
  id?: string;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  let clerkUserId = input.clerkUserId ?? null;
  let passwordHash: string | null = null;
  if (!clerkUserId) {
    if (!input.password) throw new Error("insertUser needs a password or a Clerk account");
    if (clerkEnabled()) clerkUserId = await createClerkUser({ name, email, password: input.password });
    else passwordHash = await hashPassword(input.password);
  }
  try {
    const [row] = await db
      .insert(users)
      .values({
        id: input.id ?? randomUUID(),
        name,
        email,
        passwordHash,
        clerkUserId,
        platformRole: input.platformRole ?? (superAdminEmails().has(email) ? "super_admin" : null),
        createdBy: input.createdBy,
      })
      .returning();
    return row;
  } catch (error) {
    // Don't leave a Clerk account behind that no user row points to.
    if (clerkUserId && !input.clerkUserId) await deleteClerkUser(clerkUserId).catch(() => undefined);
    throw error;
  }
}

export async function updateUser(id: string, patch: Partial<Pick<User, "name" | "email" | "platformRole" | "status" | "lastSignInAt" | "passwordHash" | "clerkUserId" | "lastSessionId">>): Promise<User | null> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return row ?? null;
}

/**
 * The user row for a Clerk account, created on its first sign-in. An existing row with the same
 * (verified) email is linked instead, so people added locally or by the console keep their orgs.
 * Null while the Clerk account has no verified email.
 */
export async function linkClerkUser(clerkUserId: string): Promise<User | null> {
  const profile = await getClerkProfile(clerkUserId);
  if (!profile.email) return null;
  const existing = await findUserByEmail(profile.email);
  if (existing) {
    const linked = await updateUser(existing.id, { clerkUserId });
    // Disabled before they ever used Clerk: carry the block over.
    if (linked?.status === "disabled") await setClerkBanned(clerkUserId, true).catch(() => undefined);
    return linked;
  }
  try {
    return await insertUser({ name: profile.name, email: profile.email, clerkUserId, createdBy: null });
  } catch (error) {
    // Two first requests raced; the other one created the row.
    const raced = await findUserByClerkId(clerkUserId);
    if (raced) return raced;
    throw error;
  }
}

/** Disabling bans the Clerk account too, which ends its sessions and blocks new sign-ins. */
export async function setUserStatus(user: User, status: User["status"]) {
  if (clerkEnabled() && user.clerkUserId) await setClerkBanned(user.clerkUserId, status === "disabled");
  return updateUser(user.id, { status });
}

/** Sets a password chosen by a super admin. A user who never used Clerk gets a Clerk account with it. */
export async function setUserPassword(user: User, password: string) {
  if (!clerkEnabled()) return updateUser(user.id, { passwordHash: await hashPassword(password) });
  if (user.clerkUserId) {
    await setClerkPassword(user.clerkUserId, password);
    return user;
  }
  return updateUser(user.id, { clerkUserId: await createClerkUser({ name: user.name, email: user.email, password }) });
}

/** Applies the SUPER_ADMIN_EMAILS bootstrap to an existing user. */
export async function syncBootstrapRole(user: User) {
  if (user.platformRole || !superAdminEmails().has(user.email)) return user;
  return (await updateUser(user.id, { platformRole: "super_admin" })) ?? user;
}

// With IMAGINE_DEMO=1 and the local login, an empty database gets the demo org and a super-admin
// account, so the app is usable straight after `npm run db:migrate`. With Clerk, SUPER_ADMIN_EMAILS
// bootstraps the first super admin instead.
export const demoPassword = () => process.env.IMAGINE_DEMO_PASSWORD || "imagine-demo";

let seeded: Promise<void> | null = null;
function ensureSeed() {
  seeded ??= (async () => {
    if (process.env.IMAGINE_DEMO !== "1" || clerkEnabled()) return;
    const [{ n }] = await db.select({ n: count() }).from(users);
    if (n > 0) return;
    if (!(await getOrganization("demo-org"))) {
      await insertOrganization({ id: "demo-org", name: "Demo Store", plan: "pro", createdBy: "seed" });
    }
    await insertUser({ id: "demo-user", name: "Demo User", email: DEMO_EMAIL, password: demoPassword(), createdBy: "seed", platformRole: "super_admin" });
    const { ensureMembership } = await import("@/lib/team/members");
    await ensureMembership({ orgId: "demo-org", userId: "demo-user", name: "Demo User", email: DEMO_EMAIL, role: "admin", invitedBy: null });
  })().catch((error) => {
    seeded = null;
    throw error;
  });
  return seeded;
}
