import "server-only";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, type EncryptedSecret } from "@/lib/crypto/secrets";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { AiProviderId, KeyError, KeyStatus } from "./providers-info";

// Repository for org AI provider keys (the provider_credentials table). One key per provider per
// org; saving again rotates it. The key is envelope-encrypted and only decrypted server-side.

type StoredKey = {
  id: string;
  orgId: string;
  provider: AiProviderId;
  secret: EncryptedSecret;
  hint: string;
  status: KeyStatus;
  lastError: KeyError | null;
  models: string[] | null;
  validatedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Safe to send to the browser. */
export type ProviderKeyView = Omit<StoredKey, "orgId" | "secret" | "models"> & { modelCount: number | null; models: string[] };

const { providerCredentials } = schema;

const toView = (k: StoredKey): ProviderKeyView => ({
  id: k.id,
  provider: k.provider,
  hint: k.hint,
  status: k.status,
  lastError: k.lastError,
  validatedAt: k.validatedAt,
  createdBy: k.createdBy,
  createdAt: k.createdAt,
  updatedAt: k.updatedAt,
  modelCount: k.models?.length ?? null,
  models: (k.models ?? []).slice(0, 12),
});

const mine = (orgId: string) => db.forOrg(orgId).select(providerCredentials, undefined, { orderBy: [asc(providerCredentials.createdAt)] });
const one = (orgId: string, provider: AiProviderId) => db.forOrg(orgId).first(providerCredentials, eq(providerCredentials.provider, provider));

export async function listProviderKeys(orgId: string): Promise<ProviderKeyView[]> {
  return (await mine(orgId)).map(toView);
}

export async function hasProviderKey(orgId: string, provider: AiProviderId) {
  return (await one(orgId, provider)) !== null;
}

/** Server-only: the plaintext key for a provider call or re-validation. */
export async function revealProviderKey(orgId: string, provider: AiProviderId): Promise<string | null> {
  const row = await one(orgId, provider);
  return row ? decryptSecret(row.secret) : null;
}

export async function saveProviderKey(input: { orgId: string; provider: AiProviderId; key: string; models: string[] | null; createdBy: string }) {
  const now = new Date().toISOString();
  const values = {
    secret: encryptSecret(input.key),
    hint: maskSecret(input.key),
    status: "valid" as const,
    lastError: null,
    models: input.models,
    validatedAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
  };
  // Saving again rotates the key in place: id and createdAt are kept.
  const [row] = await db
    .insert(providerCredentials)
    .values({ id: randomUUID(), orgId: input.orgId, provider: input.provider, ...values })
    .onConflictDoUpdate({ target: [providerCredentials.orgId, providerCredentials.provider], set: values })
    .returning();
  return toView(row);
}

export async function recordKeyCheck(orgId: string, provider: AiProviderId, check: { ok: true; models: string[] | null } | { ok: false; error: KeyError }) {
  const row = await one(orgId, provider);
  if (!row) return null;
  const now = new Date().toISOString();
  const patch = check.ok
    ? { status: "valid" as const, lastError: null, models: check.models, validatedAt: now }
    : // A transient failure keeps the last known status; only a rejected key turns invalid.
      { status: check.error === "invalid_key" ? ("invalid" as const) : row.status, lastError: check.error, validatedAt: now };
  const [updated] = await db.forOrg(orgId).update(providerCredentials, patch, eq(providerCredentials.id, row.id));
  return updated ? toView(updated) : null;
}

export async function removeProviderKey(orgId: string, provider: AiProviderId) {
  await db.forOrg(orgId).delete(providerCredentials, eq(providerCredentials.provider, provider));
}

/** Server-only: everything the registry needs to route a job (plaintext key, status, full model list). */
export async function loadProviderKey(orgId: string, provider: AiProviderId) {
  const row = await one(orgId, provider);
  return row ? { key: decryptSecret(row.secret), status: row.status, models: row.models } : null;
}

/**
 * Every stored key's org, provider and last result, across orgs: platform scope, for the worker's
 * scheduled re-validation only (each check then goes through the org-scoped functions above).
 */
export async function listAllKeyRefs() {
  return db
    .select({ orgId: providerCredentials.orgId, provider: providerCredentials.provider, status: providerCredentials.status, lastError: providerCredentials.lastError })
    .from(providerCredentials);
}

/** Server-only: full model lists of the org's valid keys, for the model pickers. */
export async function listKeyModels(orgId: string): Promise<Partial<Record<AiProviderId, string[] | null>>> {
  return Object.fromEntries((await mine(orgId)).filter((k) => k.status === "valid").map((k) => [k.provider, k.models]));
}
