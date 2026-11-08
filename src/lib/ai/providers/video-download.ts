import "server-only";
import { safeFetch } from "@/lib/safe-fetch";
import { ProviderError } from "../errors";

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/** A finished clip from a provider's signed link (provider-supplied URL, so through safeFetch). */
export async function downloadVideo(url: string): Promise<Uint8Array> {
  const response = await safeFetch(url, { maxBytes: MAX_VIDEO_BYTES, types: ["video/mp4", "application/octet-stream", "binary/octet-stream"], timeoutMs: 120_000 });
  if (!response.ok || response.result.bytes.byteLength === 0) throw new ProviderError("generation_failed");
  return response.result.bytes;
}
