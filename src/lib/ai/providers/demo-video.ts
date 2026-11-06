import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProviderError } from "../errors";
import type { VideoProvider } from "../types";

// Offline stand-in so the whole video flow (queue, credits, storage, playback) runs without a key.
// Returns a short bundled clip. Include "FAIL" in the prompt to exercise the failure state.

const latencyMs = () => Number(process.env.DEMO_VIDEO_LATENCY_MS ?? 3000);

export const demoVideoProvider: VideoProvider = {
  id: "demo",
  model: "demo-video-v1",
  async generateVideo(request) {
    await new Promise((resolve) => setTimeout(resolve, latencyMs()));
    if (request.prompt.toUpperCase().includes("FAIL")) throw new ProviderError("generation_failed");
    const bytes = await readFile(path.join(process.cwd(), "public", "demo", "demo-video.webm"));
    return { bytes: new Uint8Array(bytes), mimeType: "video/webm", provider: "demo", model: "demo-video-v1" };
  },
};
