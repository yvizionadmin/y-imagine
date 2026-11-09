// Team suggestions for the instruction boxes: short phrases this org keeps using in its own saved
// results (History), kept within the org. Pure ranking; the query lives in src/features/prompts.
import { promptTips } from "@/lib/prompt-hints";

export type TeamPromptRow = {
  /** The saved instructions (Generate) or notes (Recolor). */
  text: string | null;
  category: string | null;
  createdAt: Date | string;
  /** Uploaded to the store. */
  uploaded: boolean;
  approved: boolean;
};

export type TeamPhraseOptions = { category: string; limit?: number };

const SPLIT = /[,.;:!?\n،؛]+/;
const PHRASE_MIN_CHARS = 6;
const PHRASE_MAX_CHARS = 60;
const PHRASE_MIN_WORDS = 2;
const PHRASE_MAX_WORDS = 8;

const normalize = (phrase: string) => phrase.replace(/\s+/g, " ").trim();
const key = (phrase: string) => phrase.toLowerCase();

/** The phrases of one prompt, in the size of a suggestion chip; repeats within it count once. */
export function promptPhrases(text: string): string[] {
  const seen = new Map<string, string>();
  for (const part of text.split(SPLIT)) {
    const phrase = normalize(part);
    const words = phrase.split(" ").length;
    if (phrase.length < PHRASE_MIN_CHARS || phrase.length > PHRASE_MAX_CHARS) continue;
    if (words < PHRASE_MIN_WORDS || words > PHRASE_MAX_WORDS) continue;
    // Never suggest wording the tips warn about (drawn text, changing the product).
    if (promptTips(phrase).some((tip) => tip === "text" || tip === "productChange")) continue;
    if (!seen.has(key(phrase))) seen.set(key(phrase), phrase);
  }
  return [...seen.values()];
}

type Tally = { phrase: string; score: number; prompts: number; endorsed: boolean; sameCategory: boolean; latest: number };

/**
 * Ranks the phrases of the team's saved prompts. Identical prompts count once (a bulk run saves the
 * same text on every item), weighted by their best result: approved 3, uploaded 2, else 1. A phrase is
 * suggested when it is in two different prompts, or in one whose result was approved or uploaded.
 * Phrases from the same category come first, then the higher score, then the most recent.
 */
export function teamPhrases(rows: readonly TeamPromptRow[], { category, limit = 6 }: TeamPhraseOptions): string[] {
  type Prompt = { text: string; weight: number; sameCategory: boolean; latest: number };
  const prompts = new Map<string, Prompt>();
  for (const row of rows) {
    const text = normalize(row.text ?? "");
    if (!text) continue;
    const weight = row.approved ? 3 : row.uploaded ? 2 : 1;
    const time = new Date(row.createdAt).getTime() || 0;
    const sameCategory = row.category === category;
    const prompt = prompts.get(key(text));
    if (!prompt) prompts.set(key(text), { text, weight, sameCategory, latest: time });
    else {
      prompt.weight = Math.max(prompt.weight, weight);
      prompt.sameCategory ||= sameCategory;
      prompt.latest = Math.max(prompt.latest, time);
    }
  }

  const tallies = new Map<string, Tally>();
  for (const prompt of prompts.values()) {
    for (const phrase of promptPhrases(prompt.text)) {
      const tally = tallies.get(key(phrase));
      if (!tally) {
        tallies.set(key(phrase), { phrase, score: prompt.weight, prompts: 1, endorsed: prompt.weight > 1, sameCategory: prompt.sameCategory, latest: prompt.latest });
        continue;
      }
      tally.score += prompt.weight;
      tally.prompts += 1;
      tally.endorsed ||= prompt.weight > 1;
      tally.sameCategory ||= prompt.sameCategory;
      // Show the wording of the most recent use.
      if (prompt.latest > tally.latest) {
        tally.latest = prompt.latest;
        tally.phrase = phrase;
      }
    }
  }

  return [...tallies.values()]
    .filter((t) => t.prompts >= 2 || t.endorsed)
    .sort((a, b) => Number(b.sameCategory) - Number(a.sameCategory) || b.score - a.score || b.latest - a.latest)
    .slice(0, limit)
    .map((t) => t.phrase);
}
