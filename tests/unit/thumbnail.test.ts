import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeThumbnail, thumbnailWidth } from "@/lib/image/thumbnail";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

const png = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 50, b: 50, alpha } } }).png().toBuffer();

describe("thumbnailUrl", () => {
  it("asks the assets route for a stored image", () => {
    expect(thumbnailUrl("/api/assets/abc", 256)).toBe("/api/assets/abc?w=256");
  });

  it.each([96, 256, 640] as const)("sends public files to the optimizer at %i wide", (width) => {
    expect(thumbnailUrl("/scenes/living-room.png", width)).toBe(`/_next/image?url=%2Fscenes%2Fliving-room.png&w=${width}&q=75`);
  });

  it("leaves everything else alone", () => {
    for (const url of ["https://store.test/a.png", "//store.test/a.png", "data:image/png;base64,AA", "blob:x"]) {
      expect(thumbnailUrl(url, 96)).toBe(url);
    }
    expect(thumbnailUrl(null, 96)).toBeUndefined();
    expect(thumbnailUrl(undefined, 96)).toBeUndefined();
  });
});

describe("thumbnailWidth", () => {
  it("accepts only the listed widths, for still images", () => {
    expect(thumbnailWidth("256", "image/png")).toBe(256);
    for (const requested of ["97", "0", "-96", "99999", "96px", "", null]) expect(thumbnailWidth(requested, "image/png")).toBeNull();
    expect(thumbnailWidth("256", "video/mp4")).toBeNull();
    expect(thumbnailWidth("256", "image/svg+xml")).toBeNull();
  });
});

describe("makeThumbnail", () => {
  it("makes a smaller WebP with the same shape", async () => {
    const meta = await sharp(await makeThumbnail(await png(1600, 800), 256)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 128 });
  });

  it("doesn't scale a small image up", async () => {
    expect((await sharp(await makeThumbnail(await png(50, 50), 640)).metadata()).width).toBe(50);
  });

  it("keeps transparency, which Looks products rely on", async () => {
    const { data } = await sharp(await makeThumbnail(await png(300, 300, 0), 96)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });
});
