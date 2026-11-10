// A file uploaded into a video editor project (asset kind editor-media). Studio videos the project
// uses are only referenced; uploads belong to the project and are removed with it.

export type EditorMedia = {
  assetId: string;
  kind: "clip" | "audio";
  mimeType: string;
  name: string;
  byteSize: number;
  /** Length in seconds, read with ffmpeg at upload. */
  seconds: number;
  createdAt: string;
};

/** Projects one org keeps; older ones go with the plan's video retention. */
export const MAX_EDITS_PER_ORG = 100;
/** Uploads one project holds. */
export const MAX_MEDIA_PER_EDIT = 30;
