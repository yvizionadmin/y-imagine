import { categoryPresets, findCategory } from "@/lib/catalog-presets";

export const MAX_LOOK_PRODUCTS = 20;

export const LOOK_STYLES = ["contemporary", "scandinavian", "minimalist", "industrial", "bohemian", "traditional", "luxury"] as const;
export type LookStyle = (typeof LOOK_STYLES)[number];

/** A look's product category (a catalog preset key, as in Generate) when none is picked. */
export const DEFAULT_LOOK_CATEGORY = "furniture";

/** Style chips for a category: furniture keeps the room styles, the others use their preset's styles. */
export const lookStyles = (category: string): readonly string[] =>
  category === DEFAULT_LOOK_CATEGORY ? LOOK_STYLES : (findCategory(category)?.styles ?? LOOK_STYLES);

/** Background id of a preset scene, used while the org has no backgrounds of its own for the category. */
export const sceneBackgroundId = (scene: string) => `scene:${scene}`;

/** Background id of an image the merchant uploaded in the builder (an org asset); not tied to a category. */
export const uploadBackgroundId = (assetId: string) => `upload:${assetId}`;
/** The asset id inside an uploaded background id, else null. */
export const uploadedAssetId = (id: string | null) => (id?.startsWith("upload:") ? id.slice("upload:".length) : null);

/**
 * The category's backgrounds: the org's active ones for it, or the category's preset scenes as
 * starters when it has none (the builder and the render pick from the same list).
 */
export function categoryBackgrounds<T extends { category: string; active: boolean }>(category: string, own: T[]) {
  const mine = own.filter((b) => b.active && b.category === category);
  return { own: mine, scenes: mine.length > 0 ? [] : (findCategory(category)?.scenes ?? []) };
}

export const ROOM_TYPES = ["livingRoom", "bedroom", "dining", "kitchen", "office", "outdoor"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const LOOK_RATIOS = [
  { key: "1:1", label: "square", w: 1200, h: 1200 },
  { key: "4:3", label: "classic", w: 1200, h: 900 },
  { key: "16:9", label: "landscape", w: 1280, h: 720 },
  { key: "3:2", label: "photo", w: 1200, h: 800 },
] as const;
export type LookRatio = (typeof LOOK_RATIOS)[number]["key"];

/** Canvas item; x/y/w/h are fractions of the canvas so layouts survive aspect/zoom changes. */
export type LookItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  assetId: string;
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  hidden: boolean;
};

/** The categories some of these looks were made for, in preset order (for the category filters). */
export const lookCategories = (looks: readonly { category: string }[]): string[] =>
  categoryPresets.filter((c) => looks.some((l) => l.category === c.key)).map((c) => c.key);
