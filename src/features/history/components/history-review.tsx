"use client";

import { useState } from "react";
import { CircleCheck, Loader2, MessageSquareWarning, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ReviewBadge } from "@/features/copy/components/review-bar";
import { REVIEW_FROM, REVIEW_NOTE_MAX, type ReviewAction } from "@/lib/copy/review-status";
import { LATN } from "@/lib/format";
import { reviewImages } from "../actions";
import type { HistoryItem } from "../types";

const isolate = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

/** Approval state of one image and the review steps the user may take, in the details drawer. */
export function HistoryReview({ item, canSubmit, canApprove, onChanged }: { item: HistoryItem; canSubmit: boolean; canApprove: boolean; onChanged: () => Promise<void> }) {
  const t = useTranslations("History.review");
  const format = useFormatter();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const status = item.reviewStatus;
  const can = (action: ReviewAction) => (action === "submit" ? canSubmit : canApprove) && REVIEW_FROM[action].includes(status);

  async function run(action: ReviewAction) {
    setBusy(action);
    setError(false);
    const result = await reviewImages([item.id], action, action === "request_changes" ? note : undefined);
    if (result.ok && result.changed > 0) {
      setAsking(false);
      setNote("");
      await onChanged();
    } else {
      setError(true);
    }
    setBusy(null);
  }

  const reviewed = item.reviewedBy && item.reviewedAt ? { name: item.reviewedBy, at: format.dateTime(new Date(item.reviewedAt), { dateStyle: "medium", timeStyle: "short", ...LATN }) } : null;
  const noteId = `image-review-note-${item.id}`;

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-label={t("label")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase">{t("label")}</h3>
        <ReviewBadge status={status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {/* Name and date isolated, so a Latin name and the date don't reorder each other in RTL. */}
        {status === "approved" && reviewed
          ? t.rich("approvedBy", { ...reviewed, b: isolate })
          : status === "changes_requested" && reviewed
            ? t.rich("changesBy", { ...reviewed, b: isolate })
            : t(`hint.${status}`)}
      </p>

      {status === "changes_requested" && item.reviewNote && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs whitespace-pre-line text-danger" dir="auto">
          {item.reviewNote}
        </p>
      )}

      {asking ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("request_changes");
          }}
        >
          <label htmlFor={noteId} className="text-xs font-semibold">
            {t("noteLabel")}
          </label>
          <Textarea id={noteId} rows={2} value={note} dir={note ? "auto" : undefined} maxLength={REVIEW_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null || !note.trim()}>
              {busy === "request_changes" && <Loader2 className="animate-spin" aria-hidden />}
              {t("sendNote")}
            </Button>
          </div>
        </form>
      ) : (
        (can("submit") || can("approve") || can("request_changes")) && (
          <div className="flex flex-wrap gap-2">
            {can("approve") && (
              <Button size="sm" onClick={() => run("approve")} disabled={busy !== null}>
                {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : <CircleCheck aria-hidden />}
                {t("approve")}
              </Button>
            )}
            {can("submit") && (
              <Button variant={can("approve") ? "outline" : "default"} size="sm" onClick={() => run("submit")} disabled={busy !== null}>
                {busy === "submit" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {t("submit")}
              </Button>
            )}
            {can("request_changes") && (
              <Button variant="outline" size="sm" onClick={() => setAsking(true)} disabled={busy !== null}>
                <MessageSquareWarning aria-hidden />
                {t("requestChanges")}
              </Button>
            )}
          </div>
        )
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {t("error")}
        </p>
      )}
    </section>
  );
}
