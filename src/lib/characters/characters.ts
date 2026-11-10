import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ImageInput } from "@/lib/ai/types";
import { readAsset } from "@/lib/storage/assets";
import type { CharacterImage, CharacterSource } from "./limits";

// Saved characters (characters). Tenant data through db.forOrg.

const { characters } = schema;

export type Character = typeof characters.$inferSelect;

export async function insertCharacter(input: {
  orgId: string;
  name: string;
  description: string;
  source: CharacterSource;
  images: CharacterImage[];
  consentedAt: string | null;
  consentedBy: string | null;
  createdBy: string;
  createdById: string;
}) {
  const { orgId, ...values } = input;
  const [row] = await db.forOrg(orgId).insert(characters, { ...values, id: randomUUID() });
  return row;
}

export async function getCharacter(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return db.forOrg(orgId).first(characters, eq(characters.id, id));
}

export async function listCharacters(orgId: string) {
  return db.forOrg(orgId).select(characters, undefined, { orderBy: [desc(characters.updatedAt)], limit: 100 });
}

export async function countCharacters(orgId: string) {
  return (await db.forOrg(orgId).select(characters)).length;
}

export async function deleteCharacterRow(orgId: string, id: string) {
  const [row] = await db.forOrg(orgId).delete(characters, eq(characters.id, id));
  return row ?? null;
}

/** The character's reference images, to pass to an image model (missing files are skipped). */
export async function characterReferences(orgId: string, character: Pick<Character, "images" | "name">): Promise<ImageInput[]> {
  const refs: ImageInput[] = [];
  for (const [i, image] of character.images.entries()) {
    const bytes = await readAsset(orgId, image.assetId, image.mimeType).catch(() => null);
    if (bytes) refs.push({ bytes: new Uint8Array(bytes), mimeType: image.mimeType, name: `${character.name}-${i + 1}` });
  }
  return refs;
}
