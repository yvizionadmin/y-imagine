"use client";

import { useEffect, useState } from "react";
import { Ban, CircleCheck, Download, FileSpreadsheet, Layers, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { BatchItemStatus, BatchStatus } from "@/lib/copy/batches";
import { LATN } from "@/lib/format";
import { REVIEW_FROM, REVIEW_STATUSES } from "@/lib/copy/review-status";
import type { ReviewRights } from "../actions";
import { cancelCopyBatch, deleteCopyBatch, exportCopyBatch, getCopyBatch, retryFailedItems, reviewCopyBatch, type BatchView } from "../batch-actions";
import type { OpenBatch } from "./bulk-copy-workspace";
import { copiesAsCsv, download } from "./copy-export";
import { ReviewBadge } from "./review-bar";
import { confirmAction } from "@/components/app/confirm";

/** A run that hasn't moved after this long is probably waiting for a worker that isn't running. */
const STUCK_MS = 30_000;

const ITEM_TONE: Record<BatchItemStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-accent text-primary",
  done: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-danger",
  cancelled: "bg-muted text-subtle",
};
const RUN_TONE: Record<BatchStatus, string> = { running: "bg-accent text-primary", done: "bg-emerald-50 text-emerald-700", cancelled: "bg-muted text-subtle" };

const finished = (b: BatchView) => b.counts.done + b.counts.failed + b.counts.cancelled;

export function BulkCanvas({
  open,
  runs,
  onShow,
  onChanged,
  onDeleted,
  rights,
}: {
  open: OpenBatch | null;
  runs: BatchView[];
  onShow: (id: string) => void;
  onChanged: (run: OpenBatch | null) => void;
  onDeleted: (id: string) => void;
  rights: ReviewRights | null;
}) {
  const t = useTranslations("CopyBulk");
  return (
    <section className="flex min-h-[16rem] min-w-0 shrink-0 grow flex-col gap-6 bg-canvas p-8">
      {open ? (
        <RunView key={open.batch.id} run={open} onChanged={onChanged} onDeleted={onDeleted} rights={rights} />
      ) : (
        <div data-empty-state="" className="mx-auto flex w-[480px] max-w-full flex-col items-center gap-4 pt-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
            <Layers className="size-8" strokeWidth={1.5} aria-hidden />
          </div>
          <h2 className="text-lg font-bold">{t("emptyTitle")}</h2>
          <p className="text-[13px] leading-normal text-muted-foreground">{t("emptyBody")}</p>
        </div>
      )}
      {runs.length > 0 && <RecentRuns runs={runs} activeId={open?.batch.id ?? null} onShow={onShow} />}
    </section>
  );
}

function RunView({
  run,
  onChanged,
  onDeleted,
  rights,
}: {
  run: OpenBatch;
  onChanged: (run: OpenBatch | null) => void;
  onDeleted: (id: string) => void;
  rights: ReviewRights | null;
}) {
  const t = useTranslations("CopyBulk");
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  const { batch, items } = run;
  const done = finished(batch);
  const percent = batch.total ? Math.round((done / batch.total) * 100) : 0;
  const waiting = batch.status === "running" && batch.counts.pending === batch.total;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setStuck(true), Math.max(0, new Date(batch.createdAt).getTime() + STUCK_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [waiting, batch.createdAt]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    await action();
    onChanged(await getCopyBatch(batch.id));
    setBusy(false);
  }

  // Approval counts over the products this run has written.
  const reviews = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, items.filter((i) => i.review === status).length]));
  const canSubmitAll = Boolean(rights?.submit) && REVIEW_FROM.submit.some((s) => reviews[s] > 0);
  const canApproveAll = Boolean(rights?.approve) && REVIEW_FROM.approve.some((s) => reviews[s] > 0);

  async function exportCsv(approvedOnly = false) {
    setBusy(true);
    const products = await exportCopyBatch(batch.id, { approvedOnly });
    setBusy(false);
    const name = `${batch.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${approvedOnly ? "approved" : "copy"}.csv`;
    if (products.length) download(name, copiesAsCsv(products), "text/csv;charset=utf-8");
  }

  async function remove() {
    if (!(await confirmAction(t("deleteConfirm")))) return;
    setBusy(true);
    const result = await deleteCopyBatch(batch.id);
    setBusy(false);
    if (result.ok) onDeleted(batch.id);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl border bg-background px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-bold">
                <bdi>{batch.name}</bdi>
              </h2>
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold", RUN_TONE[batch.status])}>{t(`status.${batch.status}`)}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              <bdi>{batch.createdBy}</bdi> · <bdi>{format.dateTime(new Date(batch.createdAt), { dateStyle: "medium", timeStyle: "short", ...LATN })}</bdi>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {batch.canManage && batch.status === "running" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => cancelCopyBatch(batch.id))}>
                <Ban aria-hidden />
                {t("cancel")}
              </Button>
            )}
            {batch.canManage && batch.status !== "cancelled" && batch.counts.failed > 0 && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => retryFailedItems(batch.id))}>
                <RotateCcw aria-hidden />
                {t("retry")}
              </Button>
            )}
            <Button variant={reviews.approved > 0 ? "outline" : "default"} size="sm" disabled={busy || batch.counts.done === 0} onClick={() => exportCsv()}>
              <Download aria-hidden />
              {t("exportCsv")}
            </Button>
            {reviews.approved > 0 && (
              <Button size="sm" disabled={busy} onClick={() => exportCsv(true)}>
                <Download aria-hidden />
                {t("exportApproved", { count: reviews.approved })}
              </Button>
            )}
            {batch.canManage && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={remove} aria-label={t("delete")} title={t("delete")}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={done} aria-label={t("progressLabel")}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{t("progress", { done: batch.counts.done, total: batch.total })}</span>
            {batch.counts.failed > 0 && <span className="text-danger">{t("countFailed", { count: batch.counts.failed })}</span>}
            {batch.counts.cancelled > 0 && <span>{t("countCancelled", { count: batch.counts.cancelled })}</span>}
          </div>
          {waiting && stuck && <p className="text-[11px] text-amber-600">{t("waitingWorker")}</p>}
        </div>

        {batch.counts.done > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{t("approval")}</span>
              {REVIEW_STATUSES.filter((s) => reviews[s] > 0).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <ReviewBadge status={s} />
                  <bdi>{reviews[s]}</bdi>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {canSubmitAll && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => reviewCopyBatch(batch.id, "submit"))}>
                  <Send aria-hidden />
                  {t("submitAll")}
                </Button>
              )}
              {canApproveAll && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => reviewCopyBatch(batch.id, "approve"))}>
                  <CircleCheck aria-hidden />
                  {t("approveAll")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-background">
        <table className="w-full text-[13px]">
          <thead className="border-b bg-muted/50 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start font-semibold">{t("columns.sku")}</th>
              <th className="px-4 py-2 text-start font-semibold">{t("columns.product")}</th>
              <th className="px-4 py-2 text-start font-semibold">{t("columns.status")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b last:border-b-0">
                <td className="px-4 py-2.5 font-mono text-xs" dir="ltr">
                  {item.sku}
                </td>
                <td className="max-w-0 px-4 py-2.5">
                  <span className={cn("block truncate", !item.productName && "text-subtle")}>{item.productName || t("fromCatalog")}</span>
                  {item.status === "failed" && item.error && <span className="block truncate text-[11px] text-danger">{t.has(`itemErrors.${item.error}`) ? t(`itemErrors.${item.error}`) : t("itemErrors.generation_failed")}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", ITEM_TONE[item.status])}>
                    {item.status === "running" && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {t(`itemStatus.${item.status}`)}
                  </span>
                  {item.review && <ReviewBadge status={item.review} className="ms-1.5" />}
                </td>
                <td className="px-4 py-2.5 text-end">
                  {item.copyId && (
                    <Link href={{ pathname: "/copy", query: { copy: item.copyId } }} className="text-xs font-semibold text-primary hover:underline">
                      {t("open")}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentRuns({ runs, activeId, onShow }: { runs: BatchView[]; activeId: string | null; onShow: (id: string) => void }) {
  const t = useTranslations("CopyBulk");
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase">{t("runs")}</h3>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onShow(run.id)}
              aria-current={run.id === activeId ? "true" : undefined}
              className={cn("flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-start hover:border-primary", run.id === activeId && "border-primary ring-1 ring-primary")}
            >
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold">
                  <bdi>{run.name}</bdi>
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  <bdi>{t("progress", { done: run.counts.done, total: run.total })}</bdi> · <bdi>{t(`status.${run.status}`)}</bdi> ·{" "}
                  <bdi>{format.dateTime(new Date(run.createdAt), { dateStyle: "medium", ...LATN })}</bdi>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
