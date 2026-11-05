import "server-only";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, type EncryptedSecret } from "@/lib/crypto/secrets";
import { asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CatalogErrorCode, ConnectorSettings, ConnectorType } from "./types";

// Repository for org catalog connections (the catalog_connections table). Secrets stay encrypted at rest and never leave the server.

type StoredConnection = {
  id: string;
  orgId: string;
  type: ConnectorType;
  name: string;
  config: Record<string, string>;
  secret: EncryptedSecret | null;
  /** Masked secret values for display, e.g. { accessToken: "••••a1b2" } */
  secretHints: Record<string, string>;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  lastTest: { ok: boolean; at: string; error?: CatalogErrorCode | "not_found" } | null;
};

/** Safe to send to the browser. */
export type ConnectionView = Omit<StoredConnection, "orgId" | "secret">;

const { catalogConnections } = schema;

const toView = (c: StoredConnection): ConnectionView => ({
  id: c.id,
  type: c.type,
  name: c.name,
  config: c.config,
  secretHints: c.secretHints,
  isDefault: c.isDefault,
  createdBy: c.createdBy,
  createdAt: c.createdAt,
  lastTest: c.lastTest,
});

const oldestFirst = { orderBy: [asc(catalogConnections.createdAt)] };

export async function listConnections(orgId: string): Promise<ConnectionView[]> {
  return (await db.forOrg(orgId).select(catalogConnections, undefined, oldestFirst)).map(toView);
}

async function find(orgId: string, id?: string): Promise<StoredConnection | null> {
  if (id) return db.forOrg(orgId).first(catalogConnections, eq(catalogConnections.id, id));
  const all = await db.forOrg(orgId).select(catalogConnections, undefined, oldestFirst);
  return all.find((c) => c.isDefault) ?? all[0] ?? null;
}

/** Connection plus decrypted settings, for server-side connector use only. */
export async function loadConnection(orgId: string, id?: string) {
  const connection = await find(orgId, id);
  if (!connection) return null;
  const secrets = connection.secret ? (JSON.parse(decryptSecret(connection.secret)) as Record<string, string>) : {};
  return { connection: toView(connection), settings: { config: connection.config, secrets } satisfies ConnectorSettings };
}

export async function insertConnection(input: {
  orgId: string;
  type: ConnectorType;
  name: string;
  settings: ConnectorSettings;
  createdBy: string;
  lastTest: StoredConnection["lastTest"];
}): Promise<ConnectionView> {
  const hasSecrets = Object.keys(input.settings.secrets).length > 0;
  return db.transaction(async (tx) => {
    const org = db.forOrg(input.orgId, tx);
    // The org's first connection becomes its default.
    const isDefault = !(await org.first(catalogConnections));
    const [row] = await org.insert(catalogConnections, {
      id: randomUUID(),
      type: input.type,
      name: input.name,
      config: input.settings.config,
      secret: hasSecrets ? encryptSecret(JSON.stringify(input.settings.secrets)) : null,
      secretHints: Object.fromEntries(Object.entries(input.settings.secrets).map(([k, v]) => [k, maskSecret(v)])),
      isDefault,
      createdBy: input.createdBy,
      lastTest: input.lastTest,
    });
    return toView(row);
  });
}

export async function removeConnection(orgId: string, id: string) {
  await db.transaction(async (tx) => {
    const org = db.forOrg(orgId, tx);
    const [removed] = await org.delete(catalogConnections, eq(catalogConnections.id, id));
    if (!removed?.isDefault) return;
    const next = await org.first(catalogConnections);
    if (next) await org.update(catalogConnections, { isDefault: true }, eq(catalogConnections.id, next.id));
  });
}

export async function setDefaultConnection(orgId: string, id: string) {
  await db.transaction(async (tx) => {
    const org = db.forOrg(orgId, tx);
    if (!(await org.first(catalogConnections, eq(catalogConnections.id, id)))) return;
    await org.update(catalogConnections, { isDefault: false }, ne(catalogConnections.id, id));
    await org.update(catalogConnections, { isDefault: true }, eq(catalogConnections.id, id));
  });
}

export async function recordTest(orgId: string, id: string, lastTest: NonNullable<StoredConnection["lastTest"]>) {
  await db.forOrg(orgId).update(catalogConnections, { lastTest }, eq(catalogConnections.id, id));
}
