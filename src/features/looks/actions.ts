"use server";

import sharp from "sharp";
import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getImageProvider } from "@/lib/ai/registry";
import type { GeneratedImage } from "@/lib/ai/types";
import { findCategory } from "@/lib/catalog-presets";
import { loadConnection } from "@/lib/catalog/connections";
import { importProductPng, runSearch } from "@/lib/catalog/lookup";
import type { CatalogErrorCode, CatalogProduct } from "@/lib/catalog/types";
import { cutOutProduct } from "@/lib/image/cutout";
import { backgroundInUse, getLook, insertLook, listLooks, removeLook, updateLook, type Look, type LookMode } from "@/lib/looks/looks";
import {
  insertRoomBackground,
  listRoomBackgrounds,
  removeRoomBackground,
  resolveLookBackground,
  storeBackgroundImage,
  toBackgroundView,
  updateRoomBackground,
  type RoomBackgroundView,
} from "@/lib/looks/room-backgrounds";
import { safeFetch } from "@/lib/safe-fetch";
import { assetUrl, deleteAsset, getAsset, saveAsset } from "@/lib/storage/assets";
import { getWorkspace, type Workspace } from "@/lib/workspace";
import { LOOK_RATIOS, MAX_LOOK_PRODUCTS, ROOM_TYPES, lookStyles, uploadBackgroundId, uploadedAssetId, type LookItem } from "./config";
import { reportError } from "@/lib/observability/report";
import { resolveProductType } from "@/lib/catalog/org-catalog";

type SearchError = "no_connection" | CatalogErrorCode;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export async function searchLookProducts(query: string): Promise<{ ok: true; products: CatalogProduct[] } | { ok: false; error: SearchError }> {
  const workspace = await getWorkspace({ read: true });
  const loaded = await loadConnection(workspace.orgId);
  if (!loaded) return { ok: false, error: "no_connection" };
  const result = await runSearch(loaded.connection.type, loaded.settings, text(query, 100));
  return result.ok ? { ok: true, products: result.products.filter((p) => p.images.length > 0) } : result;
}

export type AddedProduct = Pick<LookItem, "sku" | "name" | "category" | "assetId" | "imageUrl"> & { aspect: number };

/** Import a product image (catalog or URL), cut out its studio background and store it for the canvas. */
export async function addLookProduct(
  input: { source: "catalog"; sku: string; imageUrl: string } | { source: "url"; url: string },
): Promise<{ ok: true; product: AddedProduct } | { ok: false; error: SearchError | "invalid_url" | "not_found" | "unusable_photo" }> {
  const workspace = await getWorkspace();
  let png: Buffer;
  let meta: { sku: string; name: string; category: string | null };

  if (input.source === "catalog") {
    const result = await importProductPng(workspace.orgId, text(input.sku, 64), String(input.imageUrl));
    if (!result.ok) return { ok: false, error: result.error };
    png = result.png;
    meta = { sku: result.product.sku, name: result.product.name, category: result.product.category };
  } else {
    const response = await safeFetch(String(input.url), { maxBytes: MAX_IMAGE_BYTES, types: IMAGE_TYPES });
    if (!response.ok) return { ok: false, error: "invalid_url" };
    png = await sharp(response.result.bytes).png().toBuffer();
    const file = response.result.url.pathname.split("/").pop() || "product";
    meta = { sku: `URL-${file.replace(/\.[^.]+$/, "").slice(0, 24).toUpperCase()}`, name: file, category: null };
  }

  const cut = await cutOutProduct(png, 1024, 1024);
  // Said here, while choosing products: otherwise the product goes missing from a paid result.
  if (!cut.reliable) return { ok: false, error: "unusable_photo" };
  const assetId = await saveAsset(workspace.orgId, cut.buffer, "image/png", "look-product");
  return { ok: true, product: { ...meta, assetId, imageUrl: assetUrl(assetId), aspect: cut.width / cut.height } };
}

type LookInput = {
  title: string;
  prompt: string;
  style: string | null;
  aspectRatio: string;
  category: string;
  subcategory: string | null;
  backgroundId: string | null;
  items: LookItem[];
};

const clamp = (n: unknown, min: number, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null);

async function validateLook(orgId: string, input: LookInput) {
  const ratio = LOOK_RATIOS.find((r) => r.key === input.aspectRatio);
  const category = findCategory(String(input.category))?.key;
  if (!category) return null;
  const style = input.style && lookStyles(category).includes(input.style) ? input.style : null;
  // An unknown product type is dropped rather than refused; the org's own become their name.
  const subcategory = (await resolveProductType(orgId, category, typeof input.subcategory === "string" ? input.subcategory : null)) ?? null;
  if (!ratio || !Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_LOOK_PRODUCTS) return null;
  const items: LookItem[] = [];
  for (const item of input.items) {
    const x = clamp(item.x, -1, 2), y = clamp(item.y, -1, 2), w = clamp(item.w, 0.01, 2), h = clamp(item.h, 0.01, 2);
    if (x === null || y === null || w === null || h === null || typeof item.assetId !== "string") return null;
    items.push({
      id: text(item.id, 64),
      sku: text(item.sku, 64),
      name: text(item.name, 120),
      category: item.category ? text(item.category, 80) : null,
      assetId: item.assetId,
      imageUrl: assetUrl(item.assetId),
      x, y, w, h,
      locked: Boolean(item.locked),
      hidden: Boolean(item.hidden),
    });
  }
  return { ratio, style, category, subcategory, items, title: text(input.title, 80), prompt: text(input.prompt, 1000) };
}

type RenderError = ProviderErrorCode | "invalid_input";

/** Composite the visible items onto the room background with the org's image provider. */
async function renderLook(
  workspace: Workspace,
  look: {
    items: LookItem[];
    width: number;
    height: number;
    prompt: string;
    style: string | null;
    category: string;
    subcategory: string | null;
    backgroundId: string | null;
  },
): Promise<{ ok: true; image: GeneratedImage } | { ok: false; error: RenderError }> {
  const { orgId } = workspace;
  const background = await (await resolveLookBackground(orgId, look.category, look.backgroundId))?.load();
  if (!background) return { ok: false, error: "invalid_input" };

  const items = [];
  for (const item of look.items.filter((i) => !i.hidden)) {
    const asset = await getAsset(orgId, item.assetId);
    if (!asset) return { ok: false, error: "invalid_input" };
    items.push({ image: { bytes: new Uint8Array(asset.bytes), mimeType: asset.mimeType, name: item.sku }, x: item.x, y: item.y, w: item.w, h: item.h });
  }

  const provider = await getImageProvider(workspace, "looks");
  try {
    const image = await provider.generateLook({
      background,
      items,
      width: look.width,
      height: look.height,
      prompt: look.prompt,
      style: look.style,
      category: look.category,
      subcategory: look.subcategory,
    });
    return { ok: true, image };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("generateLook failed", error, { orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}

export async function generateLook(input: LookInput): Promise<{ ok: true; image: GeneratedImage } | { ok: false; error: RenderError }> {
  const workspace = await getWorkspace();
  const look = await validateLook(workspace.orgId, input);
  if (!look) return { ok: false, error: "invalid_input" };
  return renderLook(workspace, { ...look, width: look.ratio.w, height: look.ratio.h, backgroundId: input.backgroundId });
}

export type LookView = Omit<Look, "orgId" | "resultAssetId" | "mode"> & { mode: LookMode; imageUrl: string; uploadedBackgroundUrl: string | null };
function toLookView(look: Look): LookView {
  const { resultAssetId, ...rest } = look;
  delete (rest as Partial<Look>).orgId;
  const uploaded = uploadedAssetId(look.backgroundId);
  return { ...rest, mode: look.mode ?? "generated", imageUrl: assetUrl(resultAssetId), uploadedBackgroundUrl: uploaded ? assetUrl(uploaded) : null };
}

async function dropAsset(orgId: string, id: string) {
  const asset = await getAsset(orgId, id);
  if (asset) await deleteAsset(orgId, id, asset.mimeType);
}

/** Store a rendered scene as the look's result, replacing (and deleting) the previous one. */
async function replaceResult(orgId: string, look: Look, imageUrl: string, patch: Partial<Look> = {}) {
  const data = DATA_URL.exec(imageUrl);
  if (!data) return null;
  const resultAssetId = await saveAsset(orgId, Buffer.from(data[2], "base64"), data[1], "look");
  await updateLook(orgId, look.id, { ...patch, resultAssetId, mode: "regenerated" });
  await dropAsset(orgId, look.resultAssetId);
  const updated = await getLook(orgId, look.id);
  return updated ? toLookView(updated) : null;
}

/** Save a generated look. With `id`, the existing look is updated in place (Edit Look). */
export async function saveLook(
  input: LookInput & { image: string; asBoard: boolean; id?: string | null },
): Promise<{ ok: true; look: LookView } | { ok: false; error: "invalid_input" | "forbidden" | "not_found" }> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const look = await validateLook(workspace.orgId, input);
  const data = typeof input.image === "string" ? DATA_URL.exec(input.image) : null;
  if (!look || !data) return { ok: false, error: "invalid_input" };

  const background = await resolveLookBackground(workspace.orgId, look.category, input.backgroundId);
  const fields = {
    title: look.title || background?.name || "Untitled look",
    prompt: look.prompt,
    style: look.style,
    aspectRatio: look.ratio.key,
    backgroundId: background?.id ?? null,
    roomType: background?.roomType ?? null,
    category: look.category,
    subcategory: look.subcategory,
    items: look.items,
  };

  if (input.id) {
    const existing = await getLook(workspace.orgId, String(input.id));
    if (!existing) return { ok: false, error: "not_found" };
    const updated = await replaceResult(workspace.orgId, existing, input.image, {
      ...fields,
      isBoard: existing.isBoard || Boolean(input.asBoard),
    });
    return updated ? { ok: true, look: updated } : { ok: false, error: "invalid_input" };
  }

  const resultAssetId = await saveAsset(workspace.orgId, Buffer.from(data[2], "base64"), data[1], "look");
  const saved = await insertLook({
    orgId: workspace.orgId,
    ...fields,
    resultAssetId,
    isBoard: Boolean(input.asBoard),
    mode: "generated",
    createdBy: workspace.user.name,
  });
  return { ok: true, look: toLookView(saved) };
}

export async function getLooks(): Promise<{ looks: LookView[]; canEdit: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return { looks: (await listLooks(workspace.orgId)).map(toLookView), canEdit: workspace.role !== "viewer" };
}

export async function getLookById(id: string): Promise<{ look: LookView; canEdit: boolean } | null> {
  const workspace = await getWorkspace({ read: true });
  const look = await getLook(workspace.orgId, String(id));
  return look ? { look: toLookView(look), canEdit: workspace.role !== "viewer" } : null;
}

type LookMutation = { ok: true; look: LookView } | { ok: false; error: RenderError | "forbidden" | "not_found" };

async function editableLook(id: string): Promise<{ ok: true; workspace: Workspace; look: Look } | { ok: false; error: "forbidden" | "not_found" }> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const look = await getLook(workspace.orgId, String(id));
  return look ? { ok: true, workspace, look } : { ok: false, error: "not_found" };
}

/** Re-render a saved look from its stored arrangement and settings. */
export async function regenerateLook(id: string): Promise<LookMutation> {
  const found = await editableLook(id);
  if (!found.ok) return found;
  const { workspace, look } = found;
  return rerender(workspace, look, look.items);
}

async function rerender(workspace: Workspace, look: Look, items: LookItem[]): Promise<LookMutation> {
  const { orgId } = workspace;
  const ratio = LOOK_RATIOS.find((r) => r.key === look.aspectRatio) ?? LOOK_RATIOS[0];
  const result = await renderLook(workspace, { ...look, items, width: ratio.w, height: ratio.h });
  if (!result.ok) return result;
  const updated = await replaceResult(orgId, look, result.image.url, { items });
  return updated ? { ok: true, look: updated } : { ok: false, error: "generation_failed" };
}

/**
 * Replace one product in a saved look and re-render it. Only the product fields change: the item
 * keeps its id, position, size, lock/hidden state and index in the array (its layer order).
 */
export async function swapLookProduct(id: string, itemId: string, product: AddedProduct): Promise<LookMutation> {
  const found = await editableLook(id);
  if (!found.ok) return found;
  const { workspace, look } = found;
  if (!look.items.some((i) => i.id === itemId) || !(await getAsset(workspace.orgId, String(product.assetId)))) {
    return { ok: false, error: "invalid_input" };
  }
  const items = look.items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          sku: text(product.sku, 64),
          name: text(product.name, 120),
          category: product.category ? text(product.category, 80) : null,
          assetId: product.assetId,
          imageUrl: assetUrl(product.assetId),
        }
      : item,
  );
  return rerender(workspace, look, items);
}

/** Copy a look (with its own copy of the result image) under a new title. */
export async function duplicateLook(id: string, title: string): Promise<{ ok: true; look: LookView } | { ok: false; error: "forbidden" | "not_found" }> {
  const found = await editableLook(id);
  if (!found.ok) return found;
  const { workspace, look } = found;
  const asset = await getAsset(workspace.orgId, look.resultAssetId);
  if (!asset) return { ok: false, error: "not_found" };
  const resultAssetId = await saveAsset(workspace.orgId, asset.bytes, asset.mimeType, "look");
  const copy = await insertLook({
    orgId: look.orgId,
    title: text(title, 80) || look.title,
    prompt: look.prompt,
    style: look.style,
    aspectRatio: look.aspectRatio,
    backgroundId: look.backgroundId,
    roomType: look.roomType,
    category: look.category,
    subcategory: look.subcategory,
    items: look.items,
    resultAssetId,
    isBoard: look.isBoard,
    mode: look.mode,
    createdBy: workspace.user.name,
  });
  return { ok: true, look: toLookView(copy) };
}

export async function setLookBoard(id: string, isBoard: boolean): Promise<{ ok: true } | { ok: false; error: "forbidden" | "not_found" }> {
  const found = await editableLook(id);
  if (!found.ok) return found;
  await updateLook(found.workspace.orgId, found.look.id, { isBoard: Boolean(isBoard) });
  return { ok: true };
}

/**
 * Delete a look, its result image and the background the merchant uploaded for it, unless a
 * duplicate still uses that background. Library backgrounds and product cut-outs are kept
 * (duplicates may share cut-outs).
 */
export async function deleteLook(id: string): Promise<{ ok: true } | { ok: false; error: "forbidden" | "not_found" }> {
  const found = await editableLook(id);
  if (!found.ok) return found;
  const { orgId } = found.workspace;
  const { look } = found;
  await removeLook(orgId, look.id);
  await dropAsset(orgId, look.resultAssetId);
  const uploaded = uploadedAssetId(look.backgroundId);
  if (uploaded && look.backgroundId && !(await backgroundInUse(orgId, look.backgroundId, look.id))) await dropAsset(orgId, uploaded);
  return { ok: true };
}

/** Store the merchant's own background image for the builder (any category); returns its background id. */
export async function uploadLookBackground(
  formData: FormData,
): Promise<{ ok: true; background: { id: string; imageUrl: string } } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const assetId = await storeBackgroundImage(workspace.orgId, formData.get("image"), "look-background");
  if (!assetId) return { ok: false, error: "invalid_input" };
  return { ok: true, background: { id: uploadBackgroundId(assetId), imageUrl: assetUrl(assetId) } };
}

// ---- Room backgrounds (admin) ----

export async function getRoomBackgrounds(): Promise<{ backgrounds: RoomBackgroundView[]; canManage: boolean }> {
  const workspace = await getWorkspace({ read: true });
  // The first visit seeds an org's backgrounds, which a read-only view must not do.
  return { backgrounds: (await listRoomBackgrounds(workspace.orgId, { seed: !workspace.viewAs })).map(toBackgroundView), canManage: workspace.role === "admin" };
}

const isRoomType = (v: string) => (ROOM_TYPES as readonly string[]).includes(v);
const isCategory = (v: string) => Boolean(findCategory(v));

export async function uploadRoomBackground(formData: FormData): Promise<{ ok: true } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const file = formData.get("image");
  const name = text(formData.get("name"), 80);
  const roomType = text(formData.get("roomType"), 40);
  const category = text(formData.get("category"), 40);
  const style = text(formData.get("style"), 40);
  if (!name || !isRoomType(roomType) || !isCategory(category) || !lookStyles(category).includes(style)) return { ok: false, error: "invalid_input" };
  const assetId = await storeBackgroundImage(workspace.orgId, file, "room-background");
  if (!assetId) return { ok: false, error: "invalid_input" };
  await insertRoomBackground({ orgId: workspace.orgId, name, roomType, category, style, assetId, mimeType: "image/webp", active: true });
  return { ok: true };
}

export async function editRoomBackground(
  id: string,
  patch: { name?: string; roomType?: string; category?: string; style?: string; active?: boolean },
): Promise<{ ok: true } | { ok: false; error: "forbidden" | "invalid_input" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  const clean: Parameters<typeof updateRoomBackground>[2] = {};
  if (patch.name !== undefined) clean.name = text(patch.name, 80);
  if (patch.roomType !== undefined) {
    if (!isRoomType(patch.roomType)) return { ok: false, error: "invalid_input" };
    clean.roomType = patch.roomType;
  }
  if (patch.category !== undefined || patch.style !== undefined) {
    // A style only exists within a category, so the pair is checked together.
    const current = (await listRoomBackgrounds(workspace.orgId)).find((b) => b.id === String(id));
    const category = patch.category ?? current?.category ?? "";
    const style = patch.style ?? current?.style ?? "";
    if (!isCategory(category) || !lookStyles(category).includes(style)) return { ok: false, error: "invalid_input" };
    clean.category = category;
    clean.style = style;
  }
  if (patch.active !== undefined) clean.active = Boolean(patch.active);
  if (clean.name === "") return { ok: false, error: "invalid_input" };
  await updateRoomBackground(workspace.orgId, String(id), clean);
  return { ok: true };
}

export async function deleteRoomBackground(id: string): Promise<{ ok: true } | { ok: false; error: "forbidden" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  await removeRoomBackground(workspace.orgId, String(id));
  return { ok: true };
}
