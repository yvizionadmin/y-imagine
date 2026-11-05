/** Plan-quota jobs consumed by one generated look. */
export const LOOK_COST = 1;
export const MAX_LOOK_PRODUCTS = 20;

export const LOOK_STYLES = ["contemporary", "scandinavian", "minimalist", "industrial", "bohemian", "traditional", "luxury"] as const;
export type LookStyle = (typeof LOOK_STYLES)[number];

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
