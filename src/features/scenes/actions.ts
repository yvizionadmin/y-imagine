"use server";

import { ROOM_TYPES, lookStyles } from "@/features/looks/config";
import { findCategory } from "@/lib/catalog-presets";
import { insertRoomBackground, listRoomBackgrounds, storeBackgroundImage } from "@/lib/looks/room-backgrounds";
import { assetUrl } from "@/lib/storage/assets";
import { getWorkspace } from "@/lib/workspace";
import { TEAM_SCENE_NAME_MAX } from "./config";

// Team scenes: the org's own backgrounds (the Room Backgrounds library that Shop the Look uses),
// offered as scenes in Generate. Anyone who can generate can save an uploaded scene for the team;
// admins rename, hide or delete them in Shop the Look → Room Backgrounds.

export type TeamScene = { id: string; name: string; imageUrl: string };

/**
 * The org's active backgrounds for a category, oldest first, leaving out the starter set (copies of
 * the built-in scenes Generate already shows). Reads only (no starter seeding).
 */
export async function listTeamScenes(category: string): Promise<{ scenes: TeamScene[]; canSave: boolean }> {
  const workspace = await getWorkspace({ read: true });
  const canSave = workspace.role !== "viewer" && !workspace.viewAs;
  if (!findCategory(String(category))) return { scenes: [], canSave };
  const all = await listRoomBackgrounds(workspace.orgId, { seed: false });
  return {
    scenes: all.filter((b) => b.active && !b.starter && b.category === category).map((b) => ({ id: b.id, name: b.name, imageUrl: assetUrl(b.assetId) })),
    canSave,
  };
}

/**
 * Saves an uploaded scene to the team's library for one category. The style is the one picked in
 * Generate when the category has it, else the category's first; admins can change both later.
 */
export async function saveTeamScene(formData: FormData): Promise<{ ok: true; scene: TeamScene } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const field = (key: string, max: number) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const name = field("name", TEAM_SCENE_NAME_MAX);
  const category = field("category", 40);
  const roomType = field("roomType", 40);
  const style = field("style", 40);
  if (!name || !findCategory(category) || !(ROOM_TYPES as readonly string[]).includes(roomType)) return { ok: false, error: "invalid_input" };
  const styles = lookStyles(category);
  const assetId = await storeBackgroundImage(workspace.orgId, formData.get("image"), "room-background");
  if (!assetId) return { ok: false, error: "invalid_input" };
  // Seed the starter backgrounds first, as a first visit to Room Backgrounds would: they are only
  // added to an org that has none, so saving a team scene first would otherwise skip them for good.
  await listRoomBackgrounds(workspace.orgId);
  const saved = await insertRoomBackground({
    orgId: workspace.orgId,
    name,
    roomType,
    category,
    style: styles.includes(style) ? style : styles[0],
    assetId,
    mimeType: "image/webp",
    active: true,
  });
  return { ok: true, scene: { id: saved.id, name: saved.name, imageUrl: assetUrl(saved.assetId) } };
}
