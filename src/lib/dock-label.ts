/** Strips the old step numbers ("2. Scene Settings", "٢. …") and required stars so prompt-dock chips read as plain names. */
export function chipLabel(title: string) {
  return title.replace(/^\s*[\d٠-٩]+[.)]\s*/, "").replace(/\s*\*\s*$/, "");
}

/** A short preview of free text for a chip ("soft morning light, oak fl…"), or null when empty. */
export function shorten(text: string, max = 24) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
