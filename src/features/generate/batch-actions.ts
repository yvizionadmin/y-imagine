"use server";

import { categoryPresets, CUSTOM_SCENE_MAX, findScene, PRODUCT_SIZE_MAX } from "@/lib/catalog-presets";
import { parseCatalogImage, parseImageRows, type GenerateBatchSettings } from "@/lib/image-batch/rows";
import { beginImageBatch, imageBatchProblem, type ImageBatchFailure, type ImageBatchView } from "@/lib/image-batch/start";
import { aspectRatios, type AspectRatio } from "@/lib/image-formats";
import { getWorkspace } from "@/lib/workspace";
import { resolveProductType } from "@/lib/catalog/org-catalog";

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Same rules as single Generate; a library scene or a description, never both. */
async function cleanSettings(orgId: string, input: Partial<Record<keyof GenerateBatchSettings, unknown>>): Promise<GenerateBatchSettings | null> {
  const category = categoryPresets.find((c) => c.key === input.category);
  const subcategory = str(input.subcategory, 80) || null;
  const scene = str(input.scene, 80) || null;
  const customScene = str(input.customScene, CUSTOM_SCENE_MAX + 1) || null;
  const style = str(input.style, 80) || null;
  const aspectRatio = aspectRatios.find((r) => r.key === input.aspectRatio)?.key as AspectRatio | undefined;
  const resolution = input.resolution === "HD" || input.resolution === "2K" ? input.resolution : null;
  const catalogImage = parseCatalogImage(input.catalogImage);
  if (!category || !aspectRatio || !resolution || catalogImage === null) return null;
  // The org's own types (custom:<id>) are stored by name, which the runner gives the model.
  const productType = await resolveProductType(orgId, category.key, subcategory);
  if (productType === undefined) return null;
  if (scene && !findScene(scene)) return null;
  if (customScene && (scene || customScene.length > CUSTOM_SCENE_MAX)) return null;
  if (style && !category.styles.includes(style)) return null;
  return { category: category.key, subcategory: productType, scene, customScene, style, aspectRatio, resolution, instructions: str(input.instructions, 2000), title: str(input.title, 120), catalogImage };
}

/**
 * Starts a bulk Generate run from a SKU list. Every product photo comes from the org's default
 * catalog, and every image costs one credit when it is made, so the run must fit in the credits
 * left this month. Items run on the queue and land in History.
 */
export async function startImageBatch(input: { text: string; name?: string; settings: Partial<Record<keyof GenerateBatchSettings, unknown>> }): Promise<{ ok: true; batch: ImageBatchView } | ImageBatchFailure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  if (typeof input?.text !== "string" || input.text.length > 100_000) return { ok: false, error: "invalid_input" };
  const settings = await cleanSettings(workspace.orgId, input.settings ?? {});
  if (!settings) return { ok: false, error: "invalid_input" };
  const { rows } = parseImageRows(input.text, PRODUCT_SIZE_MAX);
  const problem = await imageBatchProblem(workspace, "generate", rows.length);
  if (problem) return { ok: false, error: problem };
  return { ok: true, batch: await beginImageBatch(workspace, { tool: "generate", name: str(input.name, 120), settings, rows }) };
}
