import "server-only";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { cutOutProduct } from "./cutout";
import type { AplusRequest } from "@/lib/ai/types";

// A+ composer: lays out the Figma A+ card (98:4379, designed at 480px wide) at full resolution with
// sharp. The demo builds the hero from the scene + cut-out product; real providers pass an
// AI-generated hero. Copy is always drawn here as vector text, because image models garble text
// (Arabic especially), so titles and features stay exact in both languages.

const BASE = 480;
const WIDTH = { HD: 1200, "2K": 2048 } as const;
const FONT = "Helvetica Neue, Helvetica, Arial, Geeza Pro, sans-serif";
const ARABIC = /[؀-ۿ]/;

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

function wrap(text: string, maxChars: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, "")}…`;
  }
  return lines;
}

/** Text block anchored to a box edge; flips to right-aligned for Arabic copy. */
function textBlock(lines: string[], x: number, y: number, width: number, size: number, lineHeight: number, attrs: string) {
  const rtl = lines.some((l) => ARABIC.test(l));
  // In SVG, text-anchor "start" is the right edge when direction is rtl.
  const anchorX = rtl ? x + width : x;
  return lines
    .map(
      (l, i) =>
        `<text x="${anchorX}" y="${y + i * lineHeight}" font-size="${size}" font-family="${FONT}" ${attrs} ${
          rtl ? 'direction="rtl" text-anchor="start"' : ""
        }>${escapeXml(l)}</text>`,
    )
    .join("");
}

function frame(request: Pick<AplusRequest, "resolution" | "aspectRatio" | "reference">) {
  const W = WIDTH[request.resolution];
  const [rw, rh] = request.aspectRatio.split(":").map(Number);
  const H = Math.round((W * rh) / rw);
  const u = W / BASE; // Figma unit → pixels
  const layout = request.reference?.kind === "library" ? request.reference.layout : request.reference ? "gallery" : "bento";
  const heroH = Math.round(H * (280 / 480));
  const margin = layout === "gallery" ? Math.round(12 * u) : 0;
  const thumbW = layout === "gallery" ? Math.round(84 * u) : 0;
  const heroW = W - margin * 2 - (thumbW ? thumbW + margin : 0);
  return { W, H, u, layout, heroH, margin, thumbW, heroW, heroInnerH: heroH - margin };
}

/** Pixel size of the hero photo inside the card, so a model can be asked for a matching shape. */
/** Which top corner of the hero the title box covers: right for an Arabic title, else left. */
export const aplusTitleSide = (request: Pick<AplusRequest, "title">) => (ARABIC.test(request.title) ? "right" : "left");

export function aplusHeroSize(request: Pick<AplusRequest, "resolution" | "aspectRatio" | "reference">) {
  const { heroW, heroInnerH } = frame(request);
  return { width: heroW, height: heroInnerH };
}

export async function composeAplus(request: AplusRequest, aiHero?: Uint8Array) {
  const { W, H, u, layout, heroH, margin, thumbW, heroW, heroInnerH } = frame(request);

  const hero = aiHero
    ? await sharp(aiHero).resize(heroW, heroInnerH, { fit: "cover" }).png().toBuffer()
    : await demoHero(request, heroW, heroInnerH, u);

  const layers: OverlayOptions[] = [{ input: hero, left: margin, top: margin }];

  if (layout === "gallery") {
    const gap = Math.round(8 * u);
    const thumbH = Math.floor((heroInnerH - gap * 2) / 3);
    const crops = [
      { left: 0, top: 0, width: Math.round(heroW * 0.4), height: Math.round(heroInnerH * 0.6) },
      { left: Math.round(heroW * 0.3), top: Math.round(heroInnerH * 0.35), width: Math.round(heroW * 0.4), height: Math.round(heroInnerH * 0.6) },
      { left: Math.round(heroW * 0.6), top: Math.round(heroInnerH * 0.4), width: Math.round(heroW * 0.4), height: Math.round(heroInnerH * 0.6) },
    ];
    for (const [i, crop] of crops.entries()) {
      const thumb = await sharp(hero).extract(crop).resize(thumbW, thumbH, { fit: "cover" }).png().toBuffer();
      layers.push({ input: thumb, left: margin + heroW + margin, top: margin + i * (thumbH + gap) });
    }
  }

  // Copy overlay: title box on the hero + feature row below it.
  const titleSize = 18 * u;
  const subSize = 12 * u;
  const pad = 8 * u;
  const boxMaxW = heroW - 40 * u;
  const titleLines = wrap(request.title, Math.floor(boxMaxW / (titleSize * 0.56)), 2);
  const subLines = request.subtitle ? wrap(request.subtitle, Math.floor(boxMaxW / (subSize * 0.5)), 2) : [];
  const longest = Math.max(...titleLines.map((l) => l.length * titleSize * 0.56), ...subLines.map((l) => l.length * subSize * 0.5));
  const boxW = Math.min(boxMaxW, longest + pad * 2);
  const boxH = pad * 2 + titleLines.length * titleSize * 1.2 + (subLines.length ? 4 * u + subLines.length * subSize * 1.35 : 0);
  const rtlTitle = aplusTitleSide(request) === "right";
  const boxX = rtlTitle ? margin + heroW - 20 * u - boxW : margin + 20 * u;
  const boxY = margin + 20 * u;

  let svg = `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${8 * u}" fill="#ffffff" fill-opacity="0.82"/>`;
  svg += textBlock(titleLines, boxX + pad, boxY + pad + titleSize * 0.95, boxW - pad * 2, titleSize, titleSize * 1.2, 'font-weight="700" fill="#0f172a"');
  svg += textBlock(
    subLines,
    boxX + pad,
    boxY + pad + titleLines.length * titleSize * 1.2 + 4 * u + subSize * 0.95,
    boxW - pad * 2,
    subSize,
    subSize * 1.35,
    'fill="#475569"',
  );

  const rowY = heroH + (layout === "gallery" ? margin : 0);
  const colW = W / request.features.length;
  const rtlRow = request.features.some((f) => ARABIC.test(f.title + f.description));
  svg += `<line x1="0" y1="${rowY}" x2="${W}" y2="${rowY}" stroke="#e5e7eb" stroke-width="${u}"/>`;
  for (const [i, feature] of request.features.entries()) {
    if (i > 0) svg += `<line x1="${i * colW}" y1="${rowY}" x2="${i * colW}" y2="${H}" stroke="#e5e7eb" stroke-width="${u}"/>`;
    // Arabic copy reads right-to-left, so the first feature goes in the rightmost column.
    const x = rtlRow ? W - (i + 1) * colW : i * colW;
    const inner = colW - 32 * u;
    const eyebrow = wrap(feature.title.toUpperCase(), Math.floor(inner / (11 * u * 0.62)), 2);
    const body = wrap(feature.description, Math.floor(inner / (13 * u * 0.52)), 4);
    svg += textBlock(eyebrow, x + 16 * u, rowY + 16 * u + 11 * u, inner, 11 * u, 14 * u, 'font-weight="700" fill="#4f46e5" letter-spacing="0.4"');
    svg += textBlock(body, x + 16 * u, rowY + 16 * u + eyebrow.length * 14 * u + 8 * u + 13 * u, inner, 13 * u, 17 * u, 'font-weight="600" fill="#0f172a"');
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`), left: 0, top: 0 });

  const data = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .webp({ quality: 90 })
    .toBuffer();
  return { url: `data:image/webp;base64,${data.toString("base64")}`, width: W, height: H };
}

/** Demo hero: scene (or soft gradient) with the cut-out product grounded near the bottom. */
async function demoHero(request: AplusRequest, heroW: number, heroInnerH: number, u: number) {
  const sceneLayer = request.scene
    ? await sharp(path.join(process.cwd(), "public", request.scene)).resize(heroW, heroInnerH, { fit: "cover" }).toBuffer()
    : await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${heroW}" height="${heroInnerH}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#e2e8f0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
        ),
      )
        .png()
        .toBuffer();
  const product = await cutOutProduct(request.product.bytes, Math.round(heroW * 0.55), Math.round(heroInnerH * 0.72));
  return sharp(sceneLayer)
    .composite([
      {
        input: product.buffer,
        left: Math.round((heroW - product.width) / 2),
        top: Math.max(0, heroInnerH - product.height - Math.round(14 * u)),
      },
    ])
    .png()
    .toBuffer();
}
