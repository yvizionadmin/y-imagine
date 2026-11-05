import "server-only";
import { db, schema } from "@/lib/db";
import { BRAND_LIMITS, type BrandKit } from "./limits";

// The org's brand kit (brand_kits, one row per org): how its product copy should sound. The Copy
// tool adds it to the prompt when "Use brand kit" is on. Only admins change it (see actions).

export type SavedBrandKit = BrandKit & { updatedBy: string; updatedAt: string };

const { brandKits } = schema;

export async function getBrandKit(orgId: string): Promise<SavedBrandKit | null> {
  const row = await db.forOrg(orgId).first(brandKits);
  if (!row) return null;
  const { name, about, voice, audience, useWords, avoidWords, rules, updatedBy, updatedAt } = row;
  return { name, about, voice, audience, useWords, avoidWords, rules, updatedBy, updatedAt };
}

/** Saves the kit, or removes it when null (copy is then written without a brand voice). */
export async function setBrandKit(orgId: string, kit: BrandKit | null, actor: string) {
  if (!kit) {
    await db.forOrg(orgId).delete(brandKits);
    return;
  }
  const values = { ...kit, updatedBy: actor, updatedAt: new Date().toISOString() };
  await db.insert(brandKits).values({ orgId, ...values }).onConflictDoUpdate({ target: brandKits.orgId, set: values });
}

/** Trims, de-duplicates and caps what the form sent; null when the shape is wrong or nothing is filled in. */
export function cleanBrandKit(input: unknown): BrandKit | null | "invalid" {
  const k = input as Partial<Record<keyof BrandKit, unknown>> | null;
  if (!k || typeof k !== "object") return "invalid";
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null);
  const list = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? [...new Set(v.map((x: string) => x.trim().slice(0, BRAND_LIMITS.word)).filter(Boolean))].slice(0, BRAND_LIMITS.words)
      : null;
  const kit = {
    name: str(k.name, BRAND_LIMITS.name),
    about: str(k.about, BRAND_LIMITS.about),
    voice: str(k.voice, BRAND_LIMITS.voice),
    audience: str(k.audience, BRAND_LIMITS.audience),
    useWords: list(k.useWords),
    avoidWords: list(k.avoidWords),
    rules: str(k.rules, BRAND_LIMITS.rules),
  };
  if (Object.values(kit).some((v) => v === null)) return "invalid";
  return isEmptyBrandKit(kit as BrandKit) ? null : (kit as BrandKit);
}

export function isEmptyBrandKit(kit: BrandKit) {
  return !kit.name && !kit.about && !kit.voice && !kit.audience && !kit.useWords.length && !kit.avoidWords.length && !kit.rules;
}
