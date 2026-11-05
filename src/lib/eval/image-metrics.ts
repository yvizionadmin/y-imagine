import sharp from "sharp";
import { cutOutProduct } from "@/lib/image/cutout";

// Automatic checks for the image eval (`npm run eval:images`). They are approximate and meant for
// comparing models and prompt versions on the same test set, not as absolute quality scores.

/** Foreground mask (1 = product) at exactly width × height, cropped like the provider output (cover). */
export async function productMask(bytes: Uint8Array, width: number, height: number) {
  const fitted = await sharp(bytes).resize(width, height, { fit: "cover" }).png().toBuffer();
  const cut = await cutOutProduct(fitted, width, height);
  const { data } = await sharp(cut.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

/** Intersection over union of two masks of the same size: 1 = identical outline. */
export function maskIoU(a: Uint8Array, b: Uint8Array) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either === 0 ? 1 : both / either;
}

/**
 * Typical colour of the masked pixels: the mean of the mid-luminance band (40th–80th percentile),
 * so deep shadows and specular highlights don't drag it away from the material's colour.
 */
export async function maskedColor(bytes: Uint8Array, mask: Uint8Array, width: number, height: number) {
  const { data } = await sharp(bytes).resize(width, height, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: [number, number, number, number][] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const [r, g, b] = [data[p * 3], data[p * 3 + 1], data[p * 3 + 2]];
    pixels.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
  }
  if (pixels.length === 0) return null;
  pixels.sort((x, y) => x[0] - y[0]);
  const band = pixels.slice(Math.floor(pixels.length * 0.4), Math.max(Math.floor(pixels.length * 0.8), Math.floor(pixels.length * 0.4) + 1));
  const mean = [1, 2, 3].map((c) => Math.round(band.reduce((sum, px) => sum + px[c], 0) / band.length));
  return `#${mean.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hexToLab(hex: string): [number, number, number] {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [x, y, z] = [
    (rgb[0] * 0.4124 + rgb[1] * 0.3576 + rgb[2] * 0.1805) / 0.95047,
    rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722,
    (rgb[0] * 0.0193 + rgb[1] * 0.1192 + rgb[2] * 0.9505) / 1.08883,
  ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 colour difference. Under ~2 is hard to see, under ~5 reads as the same colour. */
export function deltaE2000(hexA: string, hexB: string) {
  const [L1, a1, b1] = hexToLab(hexA);
  const [L2, a2, b2] = hexToLab(hexB);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) hmp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
