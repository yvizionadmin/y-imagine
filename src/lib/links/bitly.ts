import "server-only";
import { randomBytes } from "node:crypto";
import { safeFetch } from "@/lib/safe-fetch";

// Minimal Bitly v4 client. The org's token travels only in the Authorization header. With
// IMAGINE_DEMO=1, tokens starting with "demo-" work offline ("demo-bad…" is rejected).

const API = "https://api-ssl.bitly.com/v4";

export type BitlyError = "invalid_token" | "forbidden" | "rate_limited" | "invalid_url" | "provider_error" | "unreachable";
export type BitlyAccount = { login: string; groupGuid: string };
export type Bitlink = { id: string; link: string };

const isDemo = (token: string) => process.env.IMAGINE_DEMO === "1" && token.startsWith("demo-");

async function call<T>(token: string, path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: BitlyError }> {
  const response = await safeFetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    maxBytes: 1024 * 1024,
    types: ["application/json"],
    timeoutMs: 15_000,
  });
  if (!response.ok) {
    if (response.error !== "http_error") return { ok: false, error: "unreachable" };
    const status = response.status ?? 0;
    if (status === 401) return { ok: false, error: "invalid_token" };
    if (status === 403) return { ok: false, error: "forbidden" };
    if (status === 429) return { ok: false, error: "rate_limited" };
    if (status === 400 || status === 422) return { ok: false, error: "invalid_url" };
    return { ok: false, error: "provider_error" };
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(response.result.bytes)) as T };
  } catch {
    return { ok: false, error: "provider_error" };
  }
}

export async function getAccount(token: string): Promise<{ ok: true; account: BitlyAccount } | { ok: false; error: BitlyError }> {
  if (isDemo(token)) return token.startsWith("demo-bad") ? { ok: false, error: "invalid_token" } : { ok: true, account: { login: "demo-account", groupGuid: "demo-group" } };
  const result = await call<{ login?: string; default_group_guid?: string }>(token, "/user");
  if (!result.ok) return result;
  if (!result.data.default_group_guid) return { ok: false, error: "provider_error" };
  return { ok: true, account: { login: result.data.login ?? "", groupGuid: result.data.default_group_guid } };
}

export async function shorten(token: string, groupGuid: string, longUrl: string): Promise<{ ok: true; bitlink: Bitlink } | { ok: false; error: BitlyError }> {
  if (isDemo(token)) {
    const id = `bit.ly/demo${randomBytes(3).toString("hex")}`;
    return { ok: true, bitlink: { id, link: `https://${id}` } };
  }
  const result = await call<{ id?: string; link?: string }>(token, "/shorten", { method: "POST", body: { long_url: longUrl, group_guid: groupGuid } });
  if (!result.ok) return result;
  if (!result.data.id || !result.data.link) return { ok: false, error: "provider_error" };
  return { ok: true, bitlink: { id: result.data.id, link: result.data.link } };
}

/** Lifetime clicks. Demo links have no traffic, so they report 0. */
export async function totalClicks(token: string, bitlinkId: string): Promise<{ ok: true; clicks: number } | { ok: false; error: BitlyError }> {
  if (isDemo(token)) return { ok: true, clicks: 0 };
  const result = await call<{ total_clicks?: number }>(token, `/bitlinks/${encodeURIComponent(bitlinkId)}/clicks/summary?unit=day&units=-1`);
  if (!result.ok) return result;
  return { ok: true, clicks: Number(result.data.total_clicks ?? 0) };
}
