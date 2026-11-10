"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import { recordAudit } from "@/lib/audit";
import { countCharacters, deleteCharacterRow, getCharacter, insertCharacter, listCharacters, type Character } from "@/lib/characters/characters";
import {
  CHARACTER_DESCRIPTION_MAX,
  CHARACTER_IMAGE_MAX_BYTES,
  CHARACTER_IMAGE_TYPES,
  CHARACTER_MAX_IMAGES,
  CHARACTER_NAME_MAX,
  MAX_CHARACTERS_PER_ORG,
  type CharacterImage,
  type CharacterView,
} from "@/lib/characters/limits";
import { reportError } from "@/lib/observability/report";
import { assetUrl, deleteAsset, saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { getWorkspace, type Workspace } from "@/lib/workspace";

// Saved characters (B13): the team's recurring people or mascots, reused by the AI Director so the
// same character appears in every scene. Members create; the creator or an admin deletes; viewers
// and a read-only org view look. Photos of a real person need the uploader's confirmation of rights
// and consent, which is recorded and audited and travels with the character to the videos made from it.

export type CharacterError = ProviderErrorCode | "forbidden" | "invalid_input" | "not_found" | "consent_required" | "too_many";

const canEdit = (workspace: Workspace) => workspace.role !== "viewer" && !workspace.viewAs;
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "").slice(0, max + 1);

function toView(c: Character, workspace: Workspace): CharacterView {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    source: c.source,
    images: c.images.map((i) => ({ ...i, url: assetUrl(i.assetId) })),
    consentedAt: c.consentedAt ?? null,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    canDelete: canEdit(workspace) && (workspace.role === "admin" || c.createdById === workspace.user.id),
  };
}

export async function getCharacters(): Promise<{ characters: CharacterView[]; canEdit: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return { characters: (await listCharacters(workspace.orgId)).map((c) => toView(c, workspace)), canEdit: canEdit(workspace) };
}

type Result = { ok: true; character: CharacterView } | { ok: false; error: CharacterError };

async function gate(): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: CharacterError }> {
  const workspace = await getWorkspace();
  if (!canEdit(workspace)) return { ok: false, error: "forbidden" };
  if ((await countCharacters(workspace.orgId)) >= MAX_CHARACTERS_PER_ORG) return { ok: false, error: "too_many" };
  return { ok: true, workspace };
}

/** A character from 1–3 photos. The uploader confirms they have the rights and the person's consent. */
export async function createCharacterFromPhotos(formData: FormData): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const { workspace } = g;
  const name = clean(formData.get("name"), CHARACTER_NAME_MAX);
  const description = clean(formData.get("description"), CHARACTER_DESCRIPTION_MAX);
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  const valid =
    name.length > 0 &&
    name.length <= CHARACTER_NAME_MAX &&
    description.length <= CHARACTER_DESCRIPTION_MAX &&
    files.length >= 1 &&
    files.length <= CHARACTER_MAX_IMAGES &&
    files.every((f) => (CHARACTER_IMAGE_TYPES as readonly string[]).includes(f.type) && f.size <= CHARACTER_IMAGE_MAX_BYTES);
  if (!valid) return { ok: false, error: "invalid_input" };
  if (formData.get("consent") !== "yes") return { ok: false, error: "consent_required" };

  const images: CharacterImage[] = [];
  for (const file of files) {
    images.push({ assetId: await saveAsset(workspace.orgId, new Uint8Array(await file.arrayBuffer()), file.type, "character"), mimeType: file.type });
  }
  const now = new Date().toISOString();
  const character = await insertCharacter({
    orgId: workspace.orgId,
    name,
    description,
    source: "upload",
    images,
    consentedAt: now,
    consentedBy: workspace.user.name,
    createdBy: workspace.user.name,
    createdById: workspace.user.id,
  });
  await recordAudit({ orgId: workspace.orgId, action: "character.consent_given", actor: workspace.user.name, target: name, meta: { character: character.id } });
  return { ok: true, character: toView(character, workspace) };
}

/** A character from a description: one AI portrait (a Studio image job), so no real person and no consent. */
export async function createCharacterFromDescription(input: { name: string; description: string }): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const { workspace } = g;
  const name = clean(input?.name, CHARACTER_NAME_MAX);
  const description = clean(input?.description, CHARACTER_DESCRIPTION_MAX);
  if (!name || name.length > CHARACTER_NAME_MAX || description.length < 10 || description.length > CHARACTER_DESCRIPTION_MAX) return { ok: false, error: "invalid_input" };

  try {
    const provider = await getImageProvider(workspace, "create");
    const image = await provider.createImage({
      prompt: `Character reference portrait of a fictional person, ${description}. Head and shoulders plus a full-body view side by side, neutral pose, plain light background, soft even studio light, photorealistic. No text.`,
      aspectRatio: "1:1",
      resolution: "HD",
      references: [],
    });
    const decoded = await decodeImage(image.url);
    if (!decoded) return { ok: false, error: "generation_failed" };
    const assetId = await saveAsset(workspace.orgId, decoded.bytes, decoded.mimeType, "character");
    const character = await insertCharacter({
      orgId: workspace.orgId,
      name,
      description,
      source: "generated",
      images: [{ assetId, mimeType: decoded.mimeType }],
      consentedAt: null,
      consentedBy: null,
      createdBy: workspace.user.name,
      createdById: workspace.user.id,
    });
    await recordAudit({ orgId: workspace.orgId, action: "character.created", actor: workspace.user.name, target: name, meta: { character: character.id } });
    return { ok: true, character: toView(character, workspace) };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("character portrait failed", error, { orgId: workspace.orgId, feature: "create" });
    return { ok: false, error: "generation_failed" };
  }
}

/** Deletes a character and its images (videos already made keep their frames). Its creator or an admin. */
export async function deleteCharacter(id: string): Promise<{ ok: true } | { ok: false; error: CharacterError }> {
  const workspace = await getWorkspace();
  if (!canEdit(workspace)) return { ok: false, error: "forbidden" };
  const character = await getCharacter(workspace.orgId, String(id));
  if (!character) return { ok: false, error: "not_found" };
  if (workspace.role !== "admin" && character.createdById !== workspace.user.id) return { ok: false, error: "forbidden" };
  await deleteCharacterRow(workspace.orgId, character.id);
  for (const image of character.images) await deleteAsset(workspace.orgId, image.assetId, image.mimeType).catch(() => undefined);
  await recordAudit({ orgId: workspace.orgId, action: "character.deleted", actor: workspace.user.name, target: character.name, meta: { character: character.id } });
  return { ok: true };
}
