"use client";

import { useState } from "react";
import { CircleCheck, Loader2, MessageSquareWarning, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LATN } from "@/lib/format";
import { REVIEW_FROM, REVIEW_NOTE_MAX, type ReviewAction, type ReviewStatus } from "@/lib/copy/review-status";
import { reviewCopy, type CopyView, type ReviewRights } from "../actions";

const BADGE: Record<ReviewStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_review: "bg-amber-50 text-amber-700",
  changes_requested: "bg-red-50 text-danger",
  approved: "bg-emerald-50 text-emerald-700",
};

const isolate = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

export function ReviewBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const t = useTranslations("Copy");
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", BADGE[status], className)}>{t(`review.status.${status}`)}</span>;
}

/** Approval state of one product's copy and the review steps the user may take. */
export function ReviewBar({ copy, rights, dirty, onReviewed }: { copy: CopyView; rights: ReviewRights | null; dirty: boolean; onReviewed: (copy: CopyView) => void }) {
  const t = useTranslations("Copy");
  const format = useFormatter();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const status = copy.reviewStatus;
  const can = (action: ReviewAction) => Boolean(rights && (action === "submit" ? rights.submit : rights.approve) && REVIEW_FROM[action].includes(status));

  async function run(action: ReviewAction) {
    setBusy(action);
    setError(false);
    const result = await reviewCopy(copy.id, action, action === "request_changes" ? note : undefined);
    setBusy(null);
    if (!result.ok) return setError(true);
    setAsking(false);
    setNote("");
    onReviewed(result.copy);
  }

  const reviewed = copy.reviewedBy && copy.reviewedAt ? { name: copy.reviewedBy, at: format.dateTime(new Date(copy.reviewedAt), { dateStyle: "medium", timeStyle: "short", ...LATN }) } : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-3" aria-label={t("review.label")} role="region">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <ReviewBadge status={status} className="text-[11px]" />
          <span className="text-muted-foreground">
            {/* Name and date isolated, so a Latin name and the date don't reorder each other in RTL. */}
            {status === "approved" && reviewed
              ? t.rich("review.approvedBy", { ...reviewed, b: isolate })
              : status === "changes_requested" && reviewed
                ? t.rich("review.changesBy", { ...reviewed, b: isolate })
                : t(`review.hint.${status}`)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (can("submit") || can("approve")) && <span className="text-[11px] text-muted-foreground">{t("review.saveFirst")}</span>}
          {can("request_changes") && !asking && (
            <Button variant="outline" size="sm" onClick={() => setAsking(true)} disabled={busy !== null}>
              <MessageSquareWarning aria-hidden />
              {t("review.requestChanges")}
            </Button>
          )}
          {can("submit") && (
            <Button variant={can("approve") ? "outline" : "default"} size="sm" onClick={() => run("submit")} disabled={busy !== null || dirty}>
              {busy === "submit" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {t("review.submit")}
            </Button>
          )}
          {can("approve") && (
            <Button size="sm" onClick={() => run("approve")} disabled={busy !== null || dirty}>
              {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : <CircleCheck aria-hidden />}
              {t("review.approve")}
            </Button>
          )}
        </div>
      </div>

      {status === "changes_requested" && copy.reviewNote && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs whitespace-pre-line text-danger" dir="auto">
          {copy.reviewNote}
        </p>
      )}

      {asking && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("request_changes");
          }}
        >
          <label htmlFor="review-note" className="text-xs font-semibold">
            {t("review.noteLabel")}
          </label>
          <Textarea id="review-note" rows={2} value={note} dir={note ? "auto" : undefined} maxLength={REVIEW_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={t("review.notePlaceholder")} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={busy !== null}>
              {t("review.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null || !note.trim()}>
              {busy === "request_changes" && <Loader2 className="animate-spin" aria-hidden />}
              {t("review.sendNote")}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {t("review.error")}
        </p>
      )}
    </div>
  );
}
