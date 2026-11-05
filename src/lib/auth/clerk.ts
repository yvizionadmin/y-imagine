import "server-only";
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";

// Clerk Backend API calls behind the account operations (only used when clerkEnabled()). Clerk owns
// identity: passwords, email verification, reset emails, MFA, sessions and bans. Orgs, memberships,
// roles and the platform role stay in Postgres.

// Plain Backend API client (no request needed), so this also works from scripts and the worker.
let client: ClerkClient | undefined;
const clerkClient = async () => (client ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }));

export class IdentityError extends Error {
  constructor(readonly code: "email_taken" | "weak_password") {
    super(code);
    this.name = "IdentityError";
  }
}

function toIdentityError(error: unknown): unknown {
  if (!isClerkAPIResponseError(error)) return error;
  const code = error.errors[0]?.code ?? "";
  if (code === "form_identifier_exists") return new IdentityError("email_taken");
  if (code.startsWith("form_password")) return new IdentityError("weak_password");
  return error;
}

const splitName = (name: string) => {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") || undefined };
};

/** Display name and primary email of a Clerk user; email is null until it's verified. */
export async function getClerkProfile(clerkUserId: string) {
  const user = await (await clerkClient()).users.getUser(clerkUserId);
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  const email = primary?.verification?.status === "verified" ? primary.emailAddress : null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || email?.split("@")[0] || "";
  return { email, name };
}

/** Creates a Clerk account with a password set by a super admin (verified email, no invite). */
export async function createClerkUser(input: { name: string; email: string; password: string }) {
  try {
    const user = await (await clerkClient()).users.createUser({ emailAddress: [input.email], password: input.password, ...splitName(input.name) });
    return user.id;
  } catch (error) {
    throw toIdentityError(error);
  }
}

export async function deleteClerkUser(clerkUserId: string) {
  await (await clerkClient()).users.deleteUser(clerkUserId);
}

export async function setClerkPassword(clerkUserId: string, password: string) {
  try {
    await (await clerkClient()).users.updateUser(clerkUserId, { password, signOutOfOtherSessions: true });
  } catch (error) {
    throw toIdentityError(error);
  }
}

/** A ban also ends every session and blocks new sign-ins. */
export async function setClerkBanned(clerkUserId: string, banned: boolean) {
  const users = (await clerkClient()).users;
  await (banned ? users.banUser(clerkUserId) : users.unbanUser(clerkUserId));
}

async function activeSessions(clerkUserId: string) {
  const { data } = await (await clerkClient()).sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 100 });
  return data;
}

export async function revokeClerkSessions(clerkUserId: string) {
  const client = await clerkClient();
  const sessions = await activeSessions(clerkUserId);
  await Promise.all(sessions.map((s) => client.sessions.revokeSession(s.id)));
  return sessions.length;
}

/**
 * Active session counts per Clerk user. Clerk lists sessions per user only, so this is one call per
 * user (5 at a time); fine for the console today, move to session webhooks when users grow.
 */
export async function countClerkSessions(clerkUserIds: string[]) {
  const counts = new Map<string, number>();
  for (let i = 0; i < clerkUserIds.length; i += 5) {
    const batch = clerkUserIds.slice(i, i + 5);
    const sizes = await Promise.all(batch.map((id) => activeSessions(id).then((s) => s.length, () => 0)));
    batch.forEach((id, n) => counts.set(id, sizes[n]));
  }
  return counts;
}

/**
 * Emails a sign-up invitation (Clerk's template). Sent again on resend; the membership itself is our
 * `members` row, accepted when that email signs in.
 */
export async function sendClerkInvitation(email: string, redirectUrl: string) {
  await (await clerkClient()).invitations.createInvitation({ emailAddress: email, redirectUrl, ignoreExisting: true, notify: true });
}
