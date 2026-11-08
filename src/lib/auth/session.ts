import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { acceptInvites } from "@/lib/team/members";
import { countClerkSessions, revokeClerkSessions } from "./clerk";
import { clerkEnabled, ORG_COOKIE, SESSION_COOKIE, VIEW_AS_COOKIE } from "./constants";
import { findUserByClerkId, getUser, linkClerkUser, syncBootstrapRole, updateUser, type User } from "./users";

// Sessions. With Clerk (clerkEnabled()), Clerk's session cookie is the session and the picked org
// is a cookie checked against memberships on every request. Without it, local sessions: the cookie
// holds a random token and only its SHA-256 is stored, so a leaked database can't be replayed and
// super admins can revoke sessions.

const MAX_AGE_S = 60 * 60 * 24 * 30;
const { sessions } = schema;

const digest = (token: string) => createHash("sha256").update(token).digest("base64url");

export async function createSession(userId: string, orgId: string | null) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(sessions).where(lte(sessions.expiresAt, now.toISOString()));
  await db.insert(sessions).values({
    id: randomUUID(),
    tokenHash: digest(token),
    userId,
    orgId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MAX_AGE_S * 1000).toISOString(),
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

async function currentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date().toISOString())));
  return session ?? null;
}

/** The signed-in, active user and their session, once per request. */
export const getSession = cache(async (): Promise<{ user: User; orgId: string | null } | null> => {
  // Sessions are per request: opt out of prerendering (runtime prefetch has cookies but not the clock).
  await connection();
  if (clerkEnabled()) return clerkSession();
  const session = await currentSession();
  if (!session) return null;
  const user = await getUser(session.userId);
  if (!user || user.status !== "active") return null;
  return { user, orgId: session.orgId };
});

async function clerkSession() {
  const { userId: clerkUserId, sessionId } = await auth();
  if (!clerkUserId || !sessionId) return null;
  let user = (await findUserByClerkId(clerkUserId)) ?? (await linkClerkUser(clerkUserId));
  if (!user) return null;
  if (user.lastSessionId !== sessionId) user = await noteClerkSignIn(user, sessionId);
  if (user.status !== "active") return null;
  return { user, orgId: (await cookies()).get(ORG_COOKIE)?.value ?? null };
}

/** First request of a new Clerk session: what the local signIn/signUp actions do. */
async function noteClerkSignIn(user: User, sessionId: string) {
  const updated = (await updateUser(user.id, { lastSessionId: sessionId, lastSignInAt: new Date().toISOString() })) ?? user;
  const pending = await db
    .select({ orgId: schema.members.orgId })
    .from(schema.members)
    .where(and(eq(schema.members.status, "invited"), eq(sql`lower(${schema.members.email})`, user.email)));
  if (pending.length) {
    await acceptInvites(user);
    for (const { orgId } of pending) await recordAudit({ orgId, action: "member.added", actor: user.name, target: user.email, meta: { via: "invitation" } });
  }
  return syncBootstrapRole(updated);
}

/**
 * Where to send a request without a usable session: sign-in, or /blocked when Clerk has signed the
 * person in but their account here is disabled or has no verified email (sign-in would loop).
 */
export async function signedOutPath() {
  if (clerkEnabled() && (await auth()).userId) return "/blocked?reason=account";
  return "/sign-in";
}

export async function setSessionOrg(orgId: string) {
  if (clerkEnabled()) {
    (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return;
  }
  const session = await currentSession();
  if (!session) return;
  await db.update(sessions).set({ orgId }).where(eq(sessions.id, session.id));
}

export async function endSession() {
  const session = await currentSession();
  if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(VIEW_AS_COOKIE);
}

/** Signs a user out everywhere (disable, password reset, "force sign-out"). */
export async function revokeUserSessions(userId: string) {
  if (clerkEnabled()) {
    const user = await getUser(userId);
    return user?.clerkUserId ? revokeClerkSessions(user.clerkUserId) : 0;
  }
  return (await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id })).length;
}

/** Active sessions per user id. */
export async function countActiveSessions() {
  if (clerkEnabled()) {
    const linked = await db.select({ id: schema.users.id, clerkUserId: schema.users.clerkUserId }).from(schema.users).where(isNotNull(schema.users.clerkUserId));
    const counts = await countClerkSessions(linked.map((u) => u.clerkUserId!));
    return new Map(linked.map((u) => [u.id, counts.get(u.clerkUserId!) ?? 0]));
  }
  const rows = await db
    .select({ userId: sessions.userId, n: count() })
    .from(sessions)
    .where(gt(sessions.expiresAt, new Date().toISOString()))
    .groupBy(sessions.userId);
  return new Map(rows.map((r) => [r.userId, r.n]));
}
