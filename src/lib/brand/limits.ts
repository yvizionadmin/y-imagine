// Brand kit shape and field limits, shared by the settings form and the server.

export type BrandKit = {
  /** Brand name as it should appear in copy. */
  name: string;
  /** What the brand sells and stands for, in a few sentences. */
  about: string;
  /** How the copy should sound, e.g. "warm, confident, never pushy". */
  voice: string;
  /** Who the copy is written for. */
  audience: string;
  /** Words and phrases the brand likes to use. */
  useWords: string[];
  /** Words and phrases the copy must never use. */
  avoidWords: string[];
  /** Any other house style rules, one per line. */
  rules: string;
};

export const BRAND_LIMITS = { name: 80, about: 600, voice: 300, audience: 300, rules: 1200, words: 30, word: 60 } as const;

export const EMPTY_BRAND_KIT: BrandKit = { name: "", about: "", voice: "", audience: "", useWords: [], avoidWords: [], rules: "" };
