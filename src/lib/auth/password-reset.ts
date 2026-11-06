import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Password reset links for the local login (Clerk resets its own passwords). The link carries a
// random token; only its SHA-256 is stored. A link works once, for an hour, and asking again
// replaces any older link for that person.

const { passwordResets } = schema;
export const RESET_TTL_MS = 60 * 60 * 1000;

const digest = (token: string) => createHash("sha256").update(token).digest("base64url");

/** A fresh reset token for the user (older ones stop working). */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(passwordResets).where(or(eq(passwordResets.userId, userId), lte(passwordResets.expiresAt, now.toISOString())));
  await db.insert(passwordResets).values({
    id: randomUUID(),
    tokenHash: digest(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESET_TTL_MS).toISOString(),
  });
  return token;
}

/** Marks the token used and returns its user id, or null if it is unknown, used or expired. */
export async function consumeResetToken(token: string): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const now = new Date().toISOString();
  const [row] = await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(and(eq(passwordResets.tokenHash, digest(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
    .returning({ userId: passwordResets.userId });
  return row?.userId ?? null;
}

/** Whether a token would still work (to show the form or the "expired" message). */
export async function resetTokenValid(token: string): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return false;
  const [row] = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, digest(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date().toISOString())));
  return !!row;
}
