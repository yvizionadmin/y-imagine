/** Pages with a one-time guide, by exact path (bulk pages and sub-pages have their own screens). */
export const GUIDED_PAGES = {
  "/generate": "generate",
  "/recolor": "recolor",
  "/aplus": "aplus",
  "/looks": "looks",
  "/resize": "resize",
  "/copy": "copy",
  "/chat": "chat",
  "/agents": "agents",
  "/editor": "editor",
  "/editor/director": "director",
  "/editor/characters": "characters",
  "/history": "history",
} as const;
export type GuideKey = (typeof GUIDED_PAGES)[keyof typeof GUIDED_PAGES];

/** The localStorage key that remembers a guide was seen ("Got it"). */
export const guideFlag = (guide: GuideKey) => `imagine.guide.${guide}`;
