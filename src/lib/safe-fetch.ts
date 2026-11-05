import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Server-side fetch of merchant-supplied URLs (product images, store APIs) without letting them
// reach internal services (SSRF): https only, every resolved address must be public, redirects are
// refused, and size/time are capped.

const DEFAULT_TIMEOUT_MS = 10_000;

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7));
    return a === "::" || a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80");
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export type SafeFetchResult = { bytes: Uint8Array; contentType: string; url: URL };

export type SafeFetchError = "invalid_url" | "blocked_address" | "http_error" | "unsupported_type" | "too_large" | "network";

export async function safeFetch(
  rawUrl: string,
  options: {
    maxBytes: number;
    types?: string[];
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string | FormData;
    timeoutMs?: number;
  },
): Promise<{ ok: true; result: SafeFetchResult } | { ok: false; error: SafeFetchError; status?: number }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { ok: false, error: "invalid_url" };

  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      return { ok: false, error: "blocked_address" };
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: "http_error", status: response.status };
    if (!response.body) return { ok: true, result: { bytes: new Uint8Array(), contentType: "", url } };
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (options.types && !options.types.includes(contentType)) return { ok: false, error: "unsupported_type" };
    if (Number(response.headers.get("content-length") ?? 0) > options.maxBytes) return { ok: false, error: "too_large" };

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      total += read.value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(read.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, result: { bytes, contentType, url } };
  } catch {
    return { ok: false, error: "network" };
  }
}
