import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { listGenerations } from "@/lib/generations";
import { saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

// Upscale from the image viewer: a generated image (data URL or a stored History asset of this org) goes to the
// org's provider, comes back at 2K / 4K, and is saved to History next to the tool it came from.

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
const { upscaleImage } = await import("@/features/upscale/actions");

const png = async (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#88aacc" } }).png().toBuffer();

async function signedIn() {
  const made = await makeOrg("pro");
  workspace = { orgId: made.org.id, orgName: made.org.name, role: "admin", plan: "pro", user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
  await saveProviderKey({ orgId: made.org.id, provider: "openai", key: "demo-upscale-key-123456", models: [], createdBy: "t" });
  return made;
}

beforeEach(() => vi.stubEnv("IMAGINE_DEMO", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("upscaleImage", () => {
  it("upscales a result to 2K and saves it to History under the source tool", async () => {
    const made = await signedIn();
    const dataUrl = `data:image/png;base64,${(await png(600, 400)).toString("base64")}`;
    const result = await upscaleImage({ imageUrl: dataUrl, size: "2K", sku: "SOFA-1", title: "Living Room", mode: "lifestyle" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.image.width, result.image.height]).toEqual([2048, 1365]);
    expect(result.image.url).toMatch(/^\/api\/assets\//);
    const [saved] = await listGenerations(made.org.id);
    expect(saved).toMatchObject({ id: result.id, mode: "lifestyle", sku: "SOFA-1", title: "Living Room · 2K", settings: { upscaled: "2K" } });
  });

  it("reads a stored asset of this org (also from a full URL), never another org's", async () => {
    const made = await signedIn();
    const assetId = await saveAsset(made.org.id, new Uint8Array(await png(300, 300)), "image/png", "generation");
    const own = await upscaleImage({ imageUrl: `http://localhost:3100/api/assets/${assetId}`, size: "4K" });
    expect(own.ok && [own.image.width, own.image.height]).toEqual([4096, 4096]);

    await signedIn(); // another org
    expect(await upscaleImage({ imageUrl: `/api/assets/${assetId}`, size: "2K" })).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses unknown sizes and remote URLs", async () => {
    await signedIn();
    const dataUrl = `data:image/png;base64,${(await png(10, 10)).toString("base64")}`;
    expect(await upscaleImage({ imageUrl: dataUrl, size: "8K" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await upscaleImage({ imageUrl: "https://example.com/cat.png", size: "2K" })).toEqual({ ok: false, error: "invalid_input" });
  });
});
