import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Local-first password hashing (scrypt, per-user salt). Clerk owns passwords once it lands;
// this only backs the demo auth so sign-up / sign-in work offline.

const run = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 32;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await run(password, salt, KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await run(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}
