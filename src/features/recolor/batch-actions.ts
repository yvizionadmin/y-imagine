"use server";

import { RECOLOR_SCOPES, type RecolorScope } from "@/lib/ai/types";
import { findCategory, findSubcategory, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { parseImageRows } from "@/lib/image-batch/rows";
import { beginImageBatch, imageBatchProblem, type ImageBatchFailure, type ImageBatchView } from "@/lib/image-batch/start";
import { isAspectRatio, isResolution } from "@/lib/image-formats";
import { saveAsset } from "@/lib/storage/assets";
import { getWorkspace } from "@/lib/workspace";

const MAX_SWATCH_BYTES = 5 * 1024 * 1024;
const SWATCH_TYPES = ["image/png", "image/jpeg", "image/webp"];
const HEX = /^#[0-9A-F]{6}$/i;

const text = (form: FormData, key: string, max: number) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

/**
 * Starts a bulk Recolor run: one swatch colour applied to every SKU's catalog photo. The swatch is
 * stored with the run (items run later, in the background) and removed when the run is deleted.
 * Same checks as bulk Generate; one credit per image.
 */
export async function startRecolorBatch(form: FormData): Promise<{ ok: true; batch: ImageBatchView } | ImageBatchFailure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  const rowsText = form.get("text");
  const category = findCategory(text(form, "category", 40));
  const subcategory = text(form, "subcategory", 80) || null;
  const hex = text(form, "hex", 7);
  const scope = text(form, "scope", 20) as RecolorScope;
  const aspectRatio = text(form, "aspectRatio", 10);
  const resolution = text(form, "resolution", 4);
  const swatch = form.get("swatch");
  if (
    typeof rowsText !== "string" ||
    rowsText.length > 100_000 ||
    !category ||
    (subcategory !== null && findSubcategory(category.key, subcategory) === null) ||
    !HEX.test(hex) ||
    !RECOLOR_SCOPES.includes(scope) ||
    !isAspectRatio(aspectRatio) ||
    !isResolution(resolution) ||
    !(swatch instanceof File) ||
    swatch.size === 0 ||
    swatch.size > MAX_SWATCH_BYTES ||
    !SWATCH_TYPES.includes(swatch.type)
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const { rows } = parseImageRows(rowsText, PRODUCT_SIZE_MAX);
  const problem = await imageBatchProblem(workspace, "recolor", rows.length);
  if (problem) return { ok: false, error: problem };

  const swatchAssetId = await saveAsset(workspace.orgId, new Uint8Array(await swatch.arrayBuffer()), swatch.type, "swatch");
  const batch = await beginImageBatch(workspace, {
    tool: "recolor",
    name: text(form, "name", 120),
    settings: {
      category: category.key,
      subcategory,
      swatchAssetId,
      swatchMime: swatch.type,
      swatchName: swatch.name.slice(0, 120),
      hex: hex.toUpperCase(),
      scope,
      aspectRatio,
      resolution,
      notes: text(form, "notes", 2000),
      title: text(form, "title", 120),
    },
    rows: rows.map(({ sku }) => ({ sku, productSize: "" })),
  });
  return { ok: true, batch };
}
