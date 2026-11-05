import type { ImprovePromptRequest } from "./types";

// "Improve with AI": rewrites the merchant's free-text instructions for an image tool into wording
// image models follow well. The rules mirror the tips in src/lib/prompt-hints.ts (no drawn text or
// logos, no reshaping the product, concrete and short), so a rewrite never triggers a tip.

export const IMPROVED_PROMPT_MAX_WORDS = 50;

const TOOL_BRIEF: Record<ImprovePromptRequest["tool"], (context: string | null) => string> = {
  generate: (context) =>
    `The instruction is added to a request that places the merchant's product photo into a lifestyle scene${context ? ` (scene: ${context})` : ""}. Improve the scene, lighting, camera angle and mood around the product.`,
  recolor: (context) =>
    `The instruction is added to a request that recolours the merchant's product photo to a swatch colour${context ? ` (what is recoloured: ${context})` : ""}. Only say which parts change colour and which must stay as they are; never change the background, scene or lighting.`,
};

const LANGUAGE_NAME = { en: "English", ar: "Modern Standard Arabic (Western digits)" } as const;

export function improvePromptText(request: ImprovePromptRequest, words: (key: string) => string) {
  return [
    "You improve instructions that an e-commerce merchant writes for an AI image model.",
    `Product category: ${words(request.category)}.`,
    TOOL_BRIEF[request.tool](request.context),
    request.text
      ? `The merchant wrote:\n${request.text}\n\nKeep their intent and every concrete detail they gave; make it clearer and more specific. Write in the same language they used.`
      : `The merchant wrote nothing yet. Write a short starting instruction that fits the category and context, in ${LANGUAGE_NAME[request.language]}.`,
    "Use concrete visual words (light direction and softness, camera angle, materials, colours, mood) in one or two plain sentences.",
    "Never ask for text, captions, logos or watermarks in the image. Never ask to resize, reshape or redesign the product, and never invent product features, brands or people.",
    `At most ${IMPROVED_PROMPT_MAX_WORDS} words. Reply with the instruction only: no quotes, no Markdown, no explanation.`,
  ].join("\n\n");
}

/** Strips quotes, Markdown and labels a chatty model may add, and caps the length for the text box. */
export function tidyPrompt(text: string, max: number) {
  const clean = text
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    .replace(/^\s*(improved (instruction|prompt)|instruction|prompt)\s*:\s*/i, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/^["“'«]+|["”'»]+$/g, "")
    .trim();
  return clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, "") : clean;
}
