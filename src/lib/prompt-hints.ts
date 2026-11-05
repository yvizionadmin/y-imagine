// Prompt help for the image tools: suggestion chips (phrases come from messages, `PromptHints`) and
// instant tips for wording that gives poor image results. Pure rules, no model call, no credit.
// Phrases and rules should follow what scores well in `npm run eval:images`.

export type PromptTip = "text" | "productChange" | "tooShort" | "tooLong";

/** Whole Arabic words (with an optional و / ال / بال prefix); JS \b doesn't work for Arabic letters. */
const arabicWords = (words: string) => `(?:^|[^\u0600-\u06FF])(?:و|ف|ب)?(?:ال)?(?:${words})(?=$|[^\u0600-\u06FF])`;

/** Words that ask the model to draw text, which image models misspell. */
const TEXT = new RegExp(
  String.raw`\b(logos?|text|write|writing|words?|caption|slogan|sale|discount|price|watermark)\b|` + arabicWords("شعار|نص|اكتب|كتابة|كلمة|عبارة|خصم|تخفيض|سعر|علامة مائية"),
  "i",
);
/** Requests to resize, reshape or add/remove parts of the product, which makes the photo inaccurate. */
const PRODUCT_CHANGE = new RegExp(
  String.raw`\b(bigger|smaller|larger|resize|reshape|redesign|(change|modify|alter)\s+(the\s+)?(shape|legs?|design|handles?|buttons?|size)|(remove|add)\s+(the\s+|a\s+|an\s+)?(legs?|handles?|buttons?|drawers?|pockets?|arms?))\b|` +
    arabicWords("أكبر|أصغر|تكبير|تصغير|غي[ّ]?ر\\s+(?:شكل|الأرجل|التصميم|المقبض|الحجم)|(?:أزل|احذف|أضف)\\s+(?:الأرجل|المقبض|الأزرار|درج)"),
  "i",
);

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Tips for what the merchant typed, most important first. `checkShort` is for a scene description,
 * where a couple of words gives the model too little; short extra instructions are fine.
 */
export function promptTips(text: string, { checkShort = false } = {}): PromptTip[] {
  const value = text.trim();
  if (!value) return [];
  const tips: PromptTip[] = [];
  if (PRODUCT_CHANGE.test(value)) tips.push("productChange");
  if (TEXT.test(value)) tips.push("text");
  const words = wordCount(value);
  if (checkShort && words <= 3) tips.push("tooShort");
  if (words > 60) tips.push("tooLong");
  return tips;
}

/** Adds a phrase to the text as a comma-separated detail; null when it wouldn't fit in `max`. */
export function appendPhrase(value: string, phrase: string, max: number): string | null {
  const base = value.trimEnd();
  // Arabic phrases join with the Arabic comma.
  const separator = !base ? "" : /[,.،؛;:]$/.test(base) ? " " : /[\u0600-\u06FF]/.test(phrase) ? "، " : ", ";
  const next = base + separator + phrase;
  return next.length <= max ? next : null;
}

/** Chips not already in the text (case-insensitive), so a used suggestion disappears. */
export function unusedChips(chips: readonly string[], value: string) {
  const lower = value.toLowerCase();
  return chips.filter((chip) => !lower.includes(chip.toLowerCase()));
}
