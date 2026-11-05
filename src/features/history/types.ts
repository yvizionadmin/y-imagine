import type { GenerationMode, PublishStatus } from "@/lib/generations";

export type { GenerationMode, PublishStatus };

export const HISTORY_PAGE_SIZES = [12, 24, 48];

export type HistoryFilters = {
  sku?: string;
  /** yyyy-mm-dd, inclusive, in the org time zone */
  from?: string;
  to?: string;
  mode?: GenerationMode;
  status?: PublishStatus;
  sort: "newest" | "oldest";
  page: number;
  pageSize: number;
};

/** Browser-safe view of a saved generation. */
export type HistoryItem = {
  id: string;
  mode: GenerationMode;
  sku: string;
  title: string;
  imageUrl: string;
  width: number;
  height: number;
  settings: Record<string, string | null>;
  provider: string;
  model: string;
  status: PublishStatus;
  publishedTo: string | null;
  publishedAt: string | null;
  publishError: string | null;
  createdBy: string;
  createdAt: string;
};
