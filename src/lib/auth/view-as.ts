import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { signingKey } from "@/lib/crypto/secrets";
import { VIEW_AS_COOKIE } from "./constants";

// "View as org admin" for super admins: a signed cookie, not a second session, so it works the same with Clerk and
// with the local login. It only counts for the super admin it was issued to, whose role is re-checked on every
// request, and it expires by itself. Signing stops anyone extending the time or opening an org without the audit entry.

export const VIEW_AS_MINUTES = 30;

export type ViewAs = { orgId: string; expiresAt: string };

const sign = (body: string) => createHmac("sha256", signingKey("view-as")).update(body).digest("base64url");

export function encodeViewAs(userId: string, orgId: string, expiresAt: number) {
  const body = `${userId}.${orgId}.${expiresAt}`;
  return `${body}.${sign(body)}`;
}

/** The view held by this token, if it is genuine, unexpired and was issued to this user. */
export function decodeViewAs(token: string, userId: string, now = Date.now()): ViewAs | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [owner, orgId, expiry, signature] = parts;
  const expected = Buffer.from(sign(`${owner}.${orgId}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(expiry);
  if (owner !== userId || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { orgId, expiresAt: new Date(expiresAt).toISOString() };
}

export async function readViewAs(userId: string) {
  const token = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  return token ? decodeViewAs(token, userId) : null;
}

export async function beginViewAs(userId: string, orgId: string) {
  const expiresAt = Date.now() + VIEW_AS_MINUTES * 60_000;
  (await cookies()).set(VIEW_AS_COOKIE, encodeViewAs(userId, orgId, expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEW_AS_MINUTES * 60,
  });
}

export async function endViewAs() {
  (await cookies()).delete(VIEW_AS_COOKIE);
}
