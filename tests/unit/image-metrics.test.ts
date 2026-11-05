import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deltaE2000, maskedColor, maskIoU, productMask } from "@/lib/eval/image-metrics";

// A red square on a white studio background, optionally shifted.
const square = (color: string, offset = 0) =>
  sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } })
    .composite([{ input: { create: { width: 50, height: 50, channels: 3, background: color } }, left: 25 + offset, top: 25 }])
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b));

describe("image eval metrics", () => {
  it("deltaE2000: identical is 0, near colours are small, black/white is ~100", () => {
    expect(deltaE2000("#D8C8B5", "#D8C8B5")).toBe(0);
    expect(deltaE2000("#D8C8B5", "#DACAB7")).toBeLessThan(2);
    expect(deltaE2000("#D8C8B5", "#4A6FA5")).toBeGreaterThan(20);
    expect(deltaE2000("#000000", "#FFFFFF")).toBeCloseTo(100, 0);
  });

  it("masks the product and measures its colour, ignoring the background", async () => {
    const red = await square("#cc2222");
    const mask = await productMask(red, 100, 100);
    expect(mask.reduce((a, b) => a + b, 0)).toBeCloseTo(2500, -2);
    expect(await maskedColor(red, mask, 100, 100)).toBe("#CC2222");
  });

  it("shape IoU drops when the product moves", async () => {
    const a = await productMask(await square("#cc2222"), 100, 100);
    expect(maskIoU(a, a)).toBe(1);
    const moved = await productMask(await square("#cc2222", 20), 100, 100);
    expect(maskIoU(a, moved)).toBeLessThan(0.7);
  });
});
