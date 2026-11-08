import "server-only";
import sharp from "sharp";

/**
 * Product layer for compositing. Transparent PNGs are used as-is; otherwise the studio background is
 * removed by flood-filling from the image border with the corner colour, so only background that is
 * connected to the edges disappears (product areas of a similar colour survive). That can't work on
 * every photo, so `reliable` says whether the result looks like a product (see `cutoutLooksRight`).
 */
export async function cutOutProduct(bytes: Uint8Array, maxW: number, maxH: number) {
  const { data, info } = await sharp(bytes)
    .resize({ width: maxW, height: maxH, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x: number, y: number) => (y * w + x) * 4;

  let reliable = true;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  if (transparent < (w * h) / 50) {
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const bg = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + data[i + c], 0) / 4);
    const distance = (i: number) =>
      Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));

    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1);
    while (queue.length) {
      const p = queue.pop()!;
      if (visited[p]) continue;
      visited[p] = 1;
      const d = distance(p * 4);
      if (d >= 36) continue;
      data[p * 4 + 3] = d < 16 ? 0 : Math.round(data[p * 4 + 3] * ((d - 16) / 20));
      if (d >= 22) continue;
      const x = p % w;
      if (x > 0) queue.push(p - 1);
      if (x < w - 1) queue.push(p + 1);
      if (p >= w) queue.push(p - w);
      if (p < w * (h - 1)) queue.push(p + w);
    }
    reliable = cutoutLooksRight(data, w, h);
  }

  return { buffer: await sharp(data, { raw: info }).png().toBuffer(), width: w, height: h, reliable };
}

const BORDER_MOSTLY_KEPT = 0.5;
const BORDER_TOUCHED = 0.001;
const MAIN_PIECE_SHARE = 0.8;

/**
 * Whether a removed background left something usable (RGBA pixels). Two failures matter:
 * almost none of the photo's edge was removed (a room, not a studio shot), or the background ran into
 * the product (similar colours), leaving pieces with no main one and scraps reaching the photo's edge.
 * A set of separate items on a plain background has no main piece either, but stays clear of the edge,
 * and one product cropped by the frame touches the edge but is one piece: both are fine.
 */
export function cutoutLooksRight(rgba: Uint8Array | Buffer, w: number, h: number) {
  const opaque = (p: number) => rgba[p * 4 + 3] >= 128;
  let border = 0;
  let touching = 0;
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    if (x !== 0 && x !== w - 1 && p >= w && p < w * (h - 1)) continue;
    border++;
    if (opaque(p)) touching++;
  }
  if (touching / border > BORDER_MOSTLY_KEPT) return false;
  if (touching / border < BORDER_TOUCHED) return true;

  const seen = new Uint8Array(w * h);
  let total = 0;
  let largest = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !opaque(start)) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || !opaque(next)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    total += size;
    if (size > largest) largest = size;
  }
  return total > 0 && largest / total >= MAIN_PIECE_SHARE;
}

