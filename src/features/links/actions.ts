"use server";

import { recordAudit } from "@/lib/audit";
import { getAccount, shorten, totalClicks, type BitlyError } from "@/lib/links/bitly";
import {
  getConnection,
  insertLink,
  listLinks,
  removeConnection,
  removeLink,
  revealConnection,
  saveConnection,
  setClicks,
  type BitlyConnectionView,
  type ShortLink,
} from "@/lib/links/store";
import { getWorkspace } from "@/lib/workspace";

export type LinkView = Omit<ShortLink, "orgId">;
type Failure = { ok: false; error: "forbidden" | "invalid_input" | "not_connected" | BitlyError };

const TOKEN_SHAPE = /^[A-Za-z0-9._\-]{16,200}$/;
const CLICK_REFRESH_LIMIT = 50;

const toView = ({ orgId: _orgId, ...link }: ShortLink): LinkView => {
  void _orgId;
  return link;
};

function cleanUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getLinks(): Promise<{ connection: BitlyConnectionView | null; links: LinkView[]; canManage: boolean; canCreate: boolean; demo: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return {
    connection: await getConnection(workspace.orgId),
    links: (await listLinks(workspace.orgId)).map(toView),
    canManage: workspace.role === "admin",
    canCreate: workspace.role !== "viewer",
    demo: process.env.IMAGINE_DEMO === "1",
  };
}

/** Admin only. Checks the token with Bitly before storing it encrypted. */
export async function connectBitly(rawToken: string): Promise<{ ok: true; connection: BitlyConnectionView } | Failure> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!TOKEN_SHAPE.test(token)) return { ok: false, error: "invalid_input" };

  const account = await getAccount(token);
  if (!account.ok) return account;
  const connection = await saveConnection({ orgId: workspace.orgId, token, ...account.account, createdBy: workspace.user.name });
  await recordAudit({ orgId: workspace.orgId, action: "bitly.connected", actor: workspace.user.name, target: "bitly", meta: { hint: connection.hint } });
  return { ok: true, connection };
}

export async function disconnectBitly(): Promise<{ ok: true } | Failure> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const existing = await getConnection(workspace.orgId);
  if (!existing) return { ok: false, error: "not_connected" };
  await removeConnection(workspace.orgId);
  await recordAudit({ orgId: workspace.orgId, action: "bitly.removed", actor: workspace.user.name, target: "bitly", meta: { hint: existing.hint } });
  return { ok: true };
}

export async function createShortLink(input: { longUrl: string; title: string }): Promise<{ ok: true; link: LinkView } | Failure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const longUrl = cleanUrl(input.longUrl);
  if (!longUrl) return { ok: false, error: "invalid_input" };
  const connection = await revealConnection(workspace.orgId);
  if (!connection) return { ok: false, error: "not_connected" };

  const result = await shorten(connection.token, connection.groupGuid, longUrl);
  if (!result.ok) return result;
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  const link = await insertLink({
    orgId: workspace.orgId,
    bitlinkId: result.bitlink.id,
    shortUrl: result.bitlink.link,
    longUrl,
    title,
    createdBy: workspace.user.name,
  });
  return { ok: true, link: toView(link) };
}

/** Refreshes lifetime clicks for the newest links (capped to stay inside Bitly's rate limits). */
export async function refreshClicks(): Promise<{ ok: true; links: LinkView[]; failed: number } | Failure> {
  const workspace = await getWorkspace();
  const connection = await revealConnection(workspace.orgId);
  if (!connection) return { ok: false, error: "not_connected" };

  const links = (await listLinks(workspace.orgId)).slice(0, CLICK_REFRESH_LIMIT);
  const counts = new Map<string, number>();
  let failed = 0;
  for (const link of links) {
    const result = await totalClicks(connection.token, link.bitlinkId);
    if (result.ok) counts.set(link.id, result.clicks);
    else failed++;
  }
  await setClicks(workspace.orgId, counts);
  return { ok: true, links: (await listLinks(workspace.orgId)).map(toView), failed };
}

/** Removes the link from this list only; the Bitly link itself keeps working. */
export async function forgetShortLink(id: string): Promise<{ ok: true } | Failure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  await removeLink(workspace.orgId, id);
  return { ok: true };
}
