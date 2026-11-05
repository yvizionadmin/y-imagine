import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// A provider result as bytes: providers return a data URL, the demo provider a bundled public image.

const PUBLIC_IMAGE = /^\/(demo|scenes)\/[a-z0-9-]+\.png$/;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

export async function decodeImage(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const data = DATA_URL.exec(imageUrl);
  if (data) return { bytes: new Uint8Array(Buffer.from(data[2], "base64")), mimeType: data[1] };
  if (PUBLIC_IMAGE.test(imageUrl)) {
    return { bytes: new Uint8Array(await readFile(path.join(process.cwd(), "public", imageUrl))), mimeType: "image/png" };
  }
  return null;
}
