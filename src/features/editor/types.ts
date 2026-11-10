import type { EditTimeline } from "@/lib/editor/timeline";
import type { EditorMedia } from "@/lib/editor/media";

export type EditorStatus = "draft" | "pending" | "running" | "ok" | "failed";

export type EditorSetup = {
  /** Paid plans (the same as Studio video). */
  allowed: boolean;
  /** Members who can make videos; viewers and a super admin's read-only view can only look. */
  canEdit: boolean;
  storage: { used: number; limit: number; retentionDays: number; full: boolean };
};

export type EditorProjectSummary = { id: string; name: string; status: EditorStatus; clips: number; updatedAt: string };

export type EditorMediaView = EditorMedia & { url: string };

export type EditorProject = {
  id: string;
  name: string;
  timeline: EditTimeline;
  media: EditorMediaView[];
  status: EditorStatus;
  /** Failure code of the last export. */
  error: string | null;
  output: { url: string; seconds: number | null; renderedAt: string | null } | null;
  updatedAt: string;
};

/** A finished Studio video (from History) that can be added as a clip. */
export type EditorSource = { assetId: string; name: string; url: string; seconds: number | null; createdAt: string };

export type EditorError =
  | "forbidden"
  | "not_in_plan"
  | "invalid_input"
  | "not_found"
  | "too_many_projects"
  | "too_many_renders"
  | "storage_full"
  | "busy"
  | "rate_limited"
  | "unavailable";
