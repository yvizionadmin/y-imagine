import "server-only";
import { safeFetch } from "@/lib/safe-fetch";
import { CatalogError } from "./types";

const MAX_JSON_BYTES = 4 * 1024 * 1024;

/** JSON request to a store API through the SSRF guard. 404 → null; auth/network failures → CatalogError. */
export async function fetchJson(
  url: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string | FormData } = {},
): Promise<unknown | null> {
  const response = await safeFetch(url, {
    maxBytes: MAX_JSON_BYTES,
    method: init.method,
    body: init.body,
    headers: { accept: "application/json", ...init.headers },
  });
  if (!response.ok) {
    if (response.error === "http_error" && response.status === 404) return null;
    if (response.error === "http_error" && (response.status === 401 || response.status === 403)) {
      throw new CatalogError("auth_failed");
    }
    if (response.error === "http_error" && response.status === 429) throw new CatalogError("rate_limited");
    if (response.error === "invalid_url" || response.error === "blocked_address") throw new CatalogError("misconfigured");
    throw new CatalogError(response.error === "network" ? "unreachable" : "bad_response");
  }
  if (response.result.bytes.length === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(response.result.bytes));
  } catch {
    throw new CatalogError("bad_response");
  }
}

/**
 * A multipart form POST whose answer isn't JSON (a storage bucket's upload URL, e.g. Shopify's staged
 * uploads, which answer 201 with XML or 204 with nothing). Any 2xx is success.
 */
export async function postForm(url: string, form: FormData): Promise<void> {
  const response = await safeFetch(url, { maxBytes: 64 * 1024, method: "POST", body: form });
  if (response.ok) return;
  if (response.error === "http_error" && response.status === 429) throw new CatalogError("rate_limited");
  // A refused signed upload (expired or mismatched policy) is about this file, not the store's credentials.
  if (response.error === "invalid_url" || response.error === "blocked_address") throw new CatalogError("misconfigured");
  throw new CatalogError(response.error === "network" ? "unreachable" : "media_rejected");
}

/** Read a dotted path such as "data.items.0.title"; "" returns the value itself. */
export function getPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

export const asText = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

/** Resolve possibly-relative image references against the store's base URL; keep https only. */
export function absoluteImages(values: unknown[], base: string) {
  const urls: string[] = [];
  for (const value of values) {
    const ref = asText(value);
    if (!ref) continue;
    try {
      const url = new URL(ref, base);
      if (url.protocol === "https:" && !urls.includes(url.href)) urls.push(url.href);
    } catch {
      // skip malformed entries
    }
  }
  return urls;
}

export function normaliseBaseUrl(raw: string) {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") throw new CatalogError("misconfigured");
  return url.href.replace(/\/+$/, "");
}
