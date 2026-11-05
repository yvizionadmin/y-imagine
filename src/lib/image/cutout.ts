import "server-only";
import sharp from "sharp";

/**
 * Product layer for compositing. Transparent PNGs are used as-is; otherwise the studio background is
 * removed by flood-filling from the image border with the corner colour, so only background that is
 * connected to the edges disappears (product areas of a similar colour survive).
 */
export async function cutOutProduct(bytes: Uint8Array, maxW: number, maxH: number) {
  const { data, info } = await sharp(bytes)
    .resize({ width: maxW, height: maxH, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x: number, y: number) => (y * w + x) * 4;

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
  }

  return { buffer: await sharp(data, { raw: info }).png().toBuffer(), width: w, height: h };
}

