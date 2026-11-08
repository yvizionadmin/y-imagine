import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/assets/[id]/route";
import { saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { makeOrg } from "../helpers";

let workspace: Workspace;
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const get = (id: string, query = "", range?: string) =>
  GET(new Request(`http://app.test/api/assets/${id}${query}`, { headers: range ? { range } : {} }), { params: Promise.resolve({ id }) });

const photo = () => sharp({ create: { width: 1200, height: 800, channels: 3, background: "#884422" } }).png().toBuffer();

describe("asset thumbnails", () => {
  let orgId: string;
  beforeEach(async () => {
    orgId = (await makeOrg()).org.id;
    workspace = { orgId } as Workspace;
  });

  it("serves a small WebP when asked, and the untouched original otherwise", async () => {
    const original = await photo();
    const id = await saveAsset(orgId, original, "image/png");

    const small = await get(id, "?w=256");
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/webp");
    expect(small.headers.get("cache-control")).toContain("private");
    const bytes = Buffer.from(await small.arrayBuffer());
    expect((await sharp(bytes).metadata()).width).toBe(256);
    expect(small.headers.get("content-length")).toBe(String(bytes.length));

    const full = await get(id);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await full.arrayBuffer()).equals(original)).toBe(true);
  });

  it("ignores a width that isn't on the list", async () => {
    const id = await saveAsset(orgId, await photo(), "image/png");
    expect((await get(id, "?w=4000")).headers.get("content-type")).toBe("image/png");
  });

  it("is still private to the org that owns the asset", async () => {
    const id = await saveAsset(orgId, await photo(), "image/png");
    workspace = { orgId: (await makeOrg()).org.id } as Workspace;
    expect((await get(id, "?w=256")).status).toBe(404);
  });

  it("leaves videos alone, ranges included", async () => {
    const id = await saveAsset(orgId, new Uint8Array([1, 2, 3, 4]), "video/mp4");
    const response = await get(id, "?w=256", "bytes=0-1");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("falls back to the original if the file can't be resized", async () => {
    const broken = new Uint8Array([1, 2, 3]);
    const id = await saveAsset(orgId, broken, "image/png");
    const response = await get(id, "?w=96");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
