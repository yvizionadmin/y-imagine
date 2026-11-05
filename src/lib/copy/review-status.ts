// Copy approval states, shared by the server and the Copy UI.
// draft → in_review (editors, admins) → approved / changes_requested (admins). Editing approved copy
// sends it back to draft, so what was approved is always what gets exported.

export const REVIEW_STATUSES = ["draft", "in_review", "changes_requested", "approved"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type ReviewAction = "submit" | "approve" | "request_changes";

export const REVIEW_NOTE_MAX = 500;

/** Statuses each action can start from. */
export const REVIEW_FROM: Record<ReviewAction, readonly ReviewStatus[]> = {
  submit: ["draft", "changes_requested"],
  approve: ["draft", "in_review", "changes_requested"],
  request_changes: ["in_review", "approved"],
};

export const REVIEW_TO: Record<ReviewAction, ReviewStatus> = { submit: "in_review", approve: "approved", request_changes: "changes_requested" };
