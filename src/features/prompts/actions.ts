"use server";

import { ProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import { getTextProvider } from "@/lib/ai/registry";
import { COPY_LANGUAGES, PROMPT_TOOLS, type CopyLanguage, type PromptTool } from "@/lib/ai/types";
import { categoryPresets, CUSTOM_SCENE_MAX, findScene } from "@/lib/catalog-presets";
import { reportError } from "@/lib/observability/report";
import { getWorkspace } from "@/lib/workspace";

/** Same cap as the instruction boxes in Generate and Recolor. */
const TEXT_MAX = 2000;

export type ImprovePromptResult = { ok: true; text: string } | { ok: false; error: ProviderErrorCode | "invalid_input" };

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * "Improve with AI" for the instruction boxes: rewrites the merchant's text through the org's own
 * text model (the Copy tool's provider and model). Free and not a job; rate-limited per user.
 */
export async function improvePrompt(input: { tool: PromptTool; text: string; category: string; scene?: string | null; customScene?: string | null; language: CopyLanguage }): Promise<ImprovePromptResult> {
  const workspace = await getWorkspace();
  const preset = categoryPresets.find((c) => c.key === input?.category);
  const scene = typeof input?.scene === "string" ? findScene(input.scene) : undefined;
  const customScene = typeof input?.customScene === "string" ? input.customScene.trim() : "";
  const valid =
    (PROMPT_TOOLS as readonly unknown[]).includes(input?.tool) &&
    typeof input.text === "string" &&
    input.text.length <= TEXT_MAX &&
    preset !== undefined &&
    (input.scene == null || scene !== undefined) &&
    customScene.length <= CUSTOM_SCENE_MAX &&
    (COPY_LANGUAGES as readonly unknown[]).includes(input.language);
  if (!valid) return { ok: false, error: "invalid_input" };

  const context = input.tool === "recolor" ? `${preset.recolorKind} (${words(preset.key)})` : customScene || (scene ? words(scene.key) : null);
  const provider = await getTextProvider(workspace, "copy");
  try {
    const { text } = await provider.improvePrompt({ tool: input.tool, text: input.text.trim(), category: preset.key, context, language: input.language });
    return { ok: true, text: text.slice(0, TEXT_MAX) };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.code };
    reportError("improvePrompt failed", error, { orgId: workspace.orgId, provider: provider.id });
    return { ok: false, error: "generation_failed" };
  }
}
