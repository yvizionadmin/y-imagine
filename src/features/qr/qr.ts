import QRCode, { type QRCodeErrorCorrectionLevel } from "qrcode";

// QR rendering shared by the preview, SVG download and PNG download, so all three are identical.
// Runs in the browser; nothing is sent to the server.

export type QrLevel = QRCodeErrorCorrectionLevel & ("L" | "M" | "Q" | "H");
export const QR_LEVELS: QrLevel[] = ["L", "M", "Q", "H"];
export const QR_SIZES = [512, 1024, 2048] as const;
export const QR_MARGINS = [0, 2, 4] as const;
/** Logo width as a share of the code; with level H up to ~25% still scans reliably. */
export const LOGO_SCALE = { min: 0.12, max: 0.24, default: 0.2 } as const;
export const MAX_TEXT = 1200;

export type QrStyle = { fg: string; bg: string; margin: number; level: QrLevel; logo: { url: string; scale: number } | null };
export type QrMatrix = { size: number; version: number; dark: (row: number, col: number) => boolean };

export type QrError = "empty" | "too_long";

export function buildMatrix(text: string, level: QrLevel): { ok: true; matrix: QrMatrix } | { ok: false; error: QrError } {
  if (!text) return { ok: false, error: "empty" };
  try {
    const code = QRCode.create(text, { errorCorrectionLevel: level });
    const { size, data } = code.modules;
    return { ok: true, matrix: { size, version: code.version, dark: (row, col) => data[row * size + col] === 1 } };
  } catch {
    return { ok: false, error: "too_long" };
  }
}

/** Square area in module units that the logo covers (modules under it are cleared). */
function logoBox(matrix: QrMatrix, style: QrStyle) {
  if (!style.logo) return null;
  const side = Math.round(matrix.size * style.logo.scale);
  const start = Math.floor((matrix.size - side) / 2);
  return { start, side, pad: 0.5 };
}

const covered = (box: ReturnType<typeof logoBox>, row: number, col: number) =>
  !!box && row >= box.start - 1 && row < box.start + box.side + 1 && col >= box.start - 1 && col < box.start + box.side + 1;

export function toSvg(matrix: QrMatrix, style: QrStyle) {
  const total = matrix.size + style.margin * 2;
  const box = logoBox(matrix, style);
  let path = "";
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.dark(row, col) && !covered(box, row, col)) path += `M${col + style.margin} ${row + style.margin}h1v1h-1z`;
    }
  }
  const logo = box
    ? `<image href="${escapeAttr(style.logo!.url)}" x="${box.start + style.margin}" y="${box.start + style.margin}" width="${box.side}" height="${box.side}" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${style.bg}"/>` +
    `<path d="${path}" fill="${style.fg}"/>${logo}</svg>`
  );
}

export async function toPng(matrix: QrMatrix, style: QrStyle, px: number): Promise<Blob> {
  const total = matrix.size + style.margin * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const unit = px / total;
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = style.fg;
  const box = logoBox(matrix, style);
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.dark(row, col) || covered(box, row, col)) continue;
      // Rounded edges avoid hairline gaps between neighbouring modules.
      const x = Math.floor((col + style.margin) * unit);
      const y = Math.floor((row + style.margin) * unit);
      ctx.fillRect(x, y, Math.ceil((col + style.margin + 1) * unit) - x, Math.ceil((row + style.margin + 1) * unit) - y);
    }
  }
  if (box && style.logo) {
    const img = await loadImage(style.logo.url);
    const side = box.side * unit;
    const scale = Math.min(side / img.naturalWidth, side / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const origin = (box.start + style.margin) * unit;
    ctx.drawImage(img, origin + (side - w) / 2, origin + (side - h) / 2, w, h);
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png"));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Scanners need clearly darker modules on a lighter background. */
export function scanCheck(fg: string, bg: string): "ok" | "low_contrast" | "inverted" {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a > b) return "inverted";
  return (b + 0.05) / (a + 0.05) < 4 ? "low_contrast" : "ok";
}

export const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** Batch input: one code per line, "name, content" or just the content. */
export function parseBatch(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(",");
      const name = comma > 0 && !/^[a-z]+:\/\//i.test(line.slice(0, comma)) ? line.slice(0, comma).trim() : "";
      const text = (name ? line.slice(comma + 1) : line).trim();
      return { name, text };
    });
}

export function safeFileName(value: string, fallback: string) {
  const cleaned = value
    .replace(/^https?:\/\//i, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}
