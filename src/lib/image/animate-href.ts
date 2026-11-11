const ASSET_PATH = /^\/api\/assets\/([0-9a-f-]{36})$/;

/** The org asset id in a stored image's URL (`/api/assets/<id>`, relative or absolute), or null for anything else. */
export function assetIdOf(src: string): string | null {
  let path: string;
  try {
    path = new URL(src, "http://local").pathname;
  } catch {
    return null;
  }
  return ASSET_PATH.exec(path)?.[1] ?? null;
}

/** Studio in Video mode with this stored image as the start frame ("Animate"); null when it isn't one of ours. */
export function animateHref(src: string): `/home?mode=video&frame=${string}` | null {
  const id = assetIdOf(src);
  return id ? `/home?mode=video&frame=${id}` : null;
}
