import "server-only";
import type { ImageInput } from "@/lib/ai/types";
import { safeFetch } from "@/lib/safe-fetch";

/** Fetch a merchant-supplied image URL through the SSRF guard; null for anything that fails it. */
export async function fetchRemoteImage(rawUrl: string, maxBytes: number, types: string[]): Promise<ImageInput | null> {
  const response = await safeFetch(rawUrl, { maxBytes, types });
  if (!response.ok) return null;
  const { bytes, contentType, url } = response.result;
  return { bytes, mimeType: contentType, name: url.pathname.split("/").pop() || "remote-image" };
}
