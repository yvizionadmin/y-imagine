import "server-only";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, type EncryptedSecret } from "@/lib/crypto/secrets";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// The org's Bitly connection (token envelope-encrypted, one per org) and the short links created
// through the app (`bitly_connections` + `short_links` tables).

type StoredConnection = {
  orgId: string;
  secret: EncryptedSecret;
  hint: string;
  login: string;
  groupGuid: string;
  createdBy: string;
  createdAt: string;
};

export type BitlyConnectionView = { hint: string; login: string; createdBy: string; createdAt: string };

export type ShortLink = {
  id: string;
  orgId: string;
  bitlinkId: string;
  shortUrl: string;
  longUrl: string;
  title: string;
  clicks: number | null;
  clicksCheckedAt: string | null;
  createdBy: string;
  createdAt: string;
};

const { bitlyConnections, shortLinks } = schema;

const toConnectionView = (row: StoredConnection): BitlyConnectionView => ({ hint: row.hint, login: row.login, createdBy: row.createdBy, createdAt: row.createdAt });

export async function getConnection(orgId: string): Promise<BitlyConnectionView | null> {
  const row = await db.forOrg(orgId).first(bitlyConnections);
  return row ? toConnectionView(row) : null;
}

/** Server-only: token + group for an API call. */
export async function revealConnection(orgId: string) {
  const row = await db.forOrg(orgId).first(bitlyConnections);
  return row ? { token: decryptSecret(row.secret), groupGuid: row.groupGuid } : null;
}

export async function saveConnection(input: { orgId: string; token: string; login: string; groupGuid: string; createdBy: string }) {
  const values = {
    secret: encryptSecret(input.token),
    hint: maskSecret(input.token),
    login: input.login,
    groupGuid: input.groupGuid,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };
  const [row] = await db
    .insert(bitlyConnections)
    .values({ orgId: input.orgId, ...values })
    .onConflictDoUpdate({ target: bitlyConnections.orgId, set: values })
    .returning();
  return toConnectionView(row);
}

export async function removeConnection(orgId: string) {
  await db.forOrg(orgId).delete(bitlyConnections);
}

export async function listLinks(orgId: string): Promise<ShortLink[]> {
  return db.forOrg(orgId).select(shortLinks, undefined, { orderBy: [desc(shortLinks.createdAt)] });
}

export async function insertLink(input: Omit<ShortLink, "id" | "clicks" | "clicksCheckedAt" | "createdAt">): Promise<ShortLink> {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(shortLinks, { ...values, id: randomUUID() });
  return row;
}

export async function setClicks(orgId: string, counts: Map<string, number>) {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const org = db.forOrg(orgId, tx);
    for (const [id, clicks] of counts) await org.update(shortLinks, { clicks, clicksCheckedAt: now }, eq(shortLinks.id, id));
  });
}

export async function removeLink(orgId: string, id: string) {
  await db.forOrg(orgId).delete(shortLinks, eq(shortLinks.id, id));
}
