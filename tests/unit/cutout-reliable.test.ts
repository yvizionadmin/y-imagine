import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cutOutProduct } from "@/lib/image/cutout";

// Looks: a cut-out that lost the product must be caught before anyone pays for a result.

const demo = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public/demo", name)));
const drawn = async (body: string) =>
  new Uint8Array(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#ffffff"/>${body}</svg>`)).png().toBuffer());
const reliable = async (bytes: Uint8Array) => (await cutOutProduct(bytes, 1024, 1024)).reliable;

describe("is this cut-out usable?", () => {
  it("accepts products on a plain background", async () => {
    expect(await reliable(demo("sofa-source.png"))).toBe(true);
    expect(await reliable(demo("sofa-grey-base.png"))).toBe(true);
    expect(await reliable(await drawn('<rect x="200" y="200" width="400" height="300" fill="#555"/><rect x="220" y="500" width="10" height="200" fill="#555"/>'))).toBe(true);
  });

  it("accepts thin, small and multi-part products", async () => {
    expect(await reliable(await drawn('<rect x="395" y="100" width="10" height="600" fill="#222"/>'))).toBe(true);
    expect(await reliable(await drawn('<circle cx="400" cy="400" r="60" fill="none" stroke="#333" stroke-width="14"/>'))).toBe(true);
    expect(await reliable(await drawn('<rect x="100" y="300" width="200" height="200" fill="#a33"/><rect x="500" y="300" width="200" height="200" fill="#3a3"/><rect x="300" y="550" width="200" height="200" fill="#33a"/>'))).toBe(true);
  });

  it("accepts one product cropped by the frame", async () => {
    expect(await reliable(await drawn('<rect x="200" y="300" width="400" height="500" fill="#555"/>'))).toBe(true);
  });

  it("accepts a transparent PNG as it is", async () => {
    const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 4, background: "#884422" } }).png().toBuffer(), left: 100, top: 100 }])
      .png()
      .toBuffer();
    expect(await reliable(new Uint8Array(png))).toBe(true);
  });

  it("refuses a product that melted into a similar background", async () => {
    expect(await reliable(demo("source-chair.png"))).toBe(false);
  });

  it("refuses a room photo, where nothing could be removed", async () => {
    expect(await reliable(demo("lifestyle-living-room.png"))).toBe(false);
  });
});
