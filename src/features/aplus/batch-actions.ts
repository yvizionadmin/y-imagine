"use server";

import { findCategory, findSubcategory } from "@/lib/catalog-presets";
import { parseAplusRows, type AplusBatchSettings } from "@/lib/image-batch/rows";
import { beginImageBatch, imageBatchProblem, type ImageBatchFailure, type ImageBatchView } from "@/lib/image-batch/start";
import { isAspectRatio, isResolution } from "@/lib/image-formats";
import { getWorkspace } from "@/lib/workspace";
import { layoutPresets } from "./config";

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Same rules as single A+: a library layout (or none), a scene and style from the category. */
function cleanSettings(input: Partial<Record<keyof AplusBatchSettings, unknown>>): AplusBatchSettings | null {
  const category = findCategory(str(input.category, 40));
  const subcategory = str(input.subcategory, 80) || null;
  const layout = str(input.layout, 20) || null;
  const scene = str(input.scene, 80) || null;
  const style = str(input.style, 80) || null;
  const aspectRatio = str(input.aspectRatio, 10);
  const resolution = str(input.resolution, 4);
  if (!category || !isAspectRatio(aspectRatio) || !isResolution(resolution)) return null;
  if (subcategory && !findSubcategory(category.key, subcategory)) return null;
  if (layout && !layoutPresets.some((l) => l === layout)) return null;
  if (scene && !category.scenes.some((s) => s.key === scene)) return null;
  if (style && !category.styles.includes(style)) return null;
  return { category: category.key, subcategory, layout: layout as AplusBatchSettings["layout"], scene, style, aspectRatio, resolution, title: str(input.title, 120) };
}

/**
 * Starts a bulk A+ run from a CSV: each row brings its own title (or the catalog name), subtitle
 * and 2 to 4 features; layout, scene, style and format are shared. One credit per image.
 */
export async function startAplusBatch(input: { text: string; name?: string; settings: Partial<Record<keyof AplusBatchSettings, unknown>> }): Promise<{ ok: true; batch: ImageBatchView } | ImageBatchFailure> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };
  if (typeof input?.text !== "string" || input.text.length > 500_000) return { ok: false, error: "invalid_input" };
  const settings = cleanSettings(input.settings ?? {});
  if (!settings) return { ok: false, error: "invalid_input" };
  const { rows } = parseAplusRows(input.text);
  const problem = await imageBatchProblem(workspace, "aplus", rows.length);
  if (problem) return { ok: false, error: problem };
  return { ok: true, batch: await beginImageBatch(workspace, { tool: "aplus", name: str(input.name, 120), settings, rows }) };
}
