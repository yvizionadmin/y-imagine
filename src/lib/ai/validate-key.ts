import "server-only";
import { safeFetch } from "@/lib/safe-fetch";
import { MODELARK_BASE_URL } from "./providers/byteplus-video";
import type { AiProviderId, KeyError } from "./providers-info";

// Checks a key with a cheap authenticated read (list models, OpenRouter's key endpoint, or one page
// of BytePlus ModelArk's video tasks, which needs no model to be activated). The key
// only travels in request headers, never in a URL, so it can't end up in proxy or access logs.

const REQUESTS: Record<AiProviderId, (key: string) => { url: string; headers: Record<string, string> }> = {
  openai: (key) => ({ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` } }),
  anthropic: (key) => ({
    url: "https://api.anthropic.com/v1/models?limit=1000",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }),
  gemini: (key) => ({ url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers: { "x-goog-api-key": key } }),
  openrouter: (key) => ({ url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${key}` } }),
  byteplus: (key) => ({ url: `${MODELARK_BASE_URL}/contents/generations/tasks?page_num=1&page_size=1`, headers: { authorization: `Bearer ${key}` } }),
};

const DEMO_MODELS: Record<AiProviderId, string[]> = {
  openai: ["gpt-image-1", "gpt-5", "gpt-5-mini"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  gemini: ["gemini-3-pro", "gemini-3-flash-image"],
  openrouter: [],
  byteplus: [],
};

export type KeyCheck = { ok: true; models: string[] | null } | { ok: false; error: KeyError };

function modelIds(provider: AiProviderId, json: unknown): string[] | null {
  // Neither lists models: OpenRouter routes to many, ModelArk's preferred Seedance id is assumed.
  if (provider === "openrouter" || provider === "byteplus") return null;
  const body = json as { data?: { id?: unknown }[]; models?: { name?: unknown }[] };
  const ids =
    provider === "gemini"
      ? (body.models ?? []).map((m) => String(m.name ?? "").replace(/^models\//, ""))
      : (body.data ?? []).map((m) => String(m.id ?? ""));
  return ids.filter(Boolean).sort();
}

export async function checkProviderKey(provider: AiProviderId, key: string): Promise<KeyCheck> {
  // Offline keys for local review and tests: "demo-…" passes, "demo-bad…" fails.
  if (process.env.IMAGINE_DEMO === "1" && key.startsWith("demo-")) {
    return key.startsWith("demo-bad") ? { ok: false, error: "invalid_key" } : { ok: true, models: DEMO_MODELS[provider] };
  }

  const { url, headers } = REQUESTS[provider](key);
  const response = await safeFetch(url, { maxBytes: 4 * 1024 * 1024, types: ["application/json"], headers, timeoutMs: 15_000 });
  if (!response.ok) {
    if (response.error !== "http_error") return { ok: false, error: "unreachable" };
    const status = response.status ?? 0;
    if (status === 401 || status === 403 || (provider === "gemini" && status === 400)) return { ok: false, error: "invalid_key" };
    if (status === 402) return { ok: false, error: "no_credits" };
    if (status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "provider_error" };
  }
  try {
    return { ok: true, models: modelIds(provider, JSON.parse(new TextDecoder().decode(response.result.bytes))) };
  } catch {
    return { ok: false, error: "provider_error" };
  }
}
