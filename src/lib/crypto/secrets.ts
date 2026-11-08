import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";

// Envelope encryption for org secrets (AI provider keys, store credentials): each secret gets its
// own random data key (DEK); the DEK is wrapped with the key-encryption key (KEK) from the
// environment. Rotating the KEK only requires re-wrapping DEKs, not re-encrypting every secret.

export type EncryptedSecret = {
  v: 1;
  /** DEK wrapped with the KEK: iv.tag.ciphertext (base64) */
  dek: string;
  /** Secret encrypted with the DEK: iv.tag.ciphertext (base64) */
  data: string;
};

function kek(): Buffer {
  const raw = process.env.KEY_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) {
    throw new Error("KEY_ENCRYPTION_KEY must be set to 32 random bytes, base64-encoded");
  }
  return key;
}

/** A key for signing, derived from the KEK so a signature can never be used to attack the encrypted secrets. */
export const signingKey = (purpose: string) => Buffer.from(hkdfSync("sha256", kek(), "", purpose, 32));

function seal(key: Buffer, plaintext: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(".");
}

function open(key: Buffer, sealed: string) {
  const [iv, tag, ciphertext] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const dek = randomBytes(32);
  return { v: 1, dek: seal(kek(), dek), data: seal(dek, Buffer.from(plaintext, "utf8")) };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const dek = open(kek(), secret.dek);
  return open(dek, secret.data).toString("utf8");
}

/** "sk-live-abcd1234" → "••••1234", safe to show in the UI. */
export function maskSecret(plaintext: string) {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}
