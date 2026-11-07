/** A download file name for an image: its base name plus the extension its MIME type implies. */
export function imageFileName(base: string, mimeType: string) {
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : mimeType === "image/gif" ? "gif" : "webp";
  const clean = base.trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
  return `${clean}.${ext}`;
}

/** Saves an image (data URL or same-origin asset URL) with a file name. */
export async function downloadImage(src: string, base: string) {
  const blob = await (await fetch(src)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = imageFileName(base, blob.type);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shares an image through the system share sheet (as a file, so it works in WhatsApp, Mail…). Without file
 * sharing, a stored image's link is shared or copied; data URLs can't be linked, so they report "unsupported".
 */
export async function shareImage(src: string, base: string, title: string): Promise<"shared" | "copied" | "cancelled" | "unsupported"> {
  try {
    if (typeof navigator.canShare === "function") {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], imageFileName(base, blob.type), { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return "shared";
      }
    }
    if (src.startsWith("data:")) return "unsupported";
    const link = new URL(src, location.href).href;
    if (typeof navigator.share === "function") {
      await navigator.share({ url: link, title });
      return "shared";
    }
    await navigator.clipboard.writeText(link);
    return "copied";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "unsupported";
  }
}
