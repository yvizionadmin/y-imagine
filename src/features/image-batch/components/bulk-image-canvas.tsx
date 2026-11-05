"use client";

import { useEffect, useState } from "react";
import { Ban, Images, Loader2, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { BatchItemStatus, BatchStatus } from "@/lib/copy/batches";
import { LATN } from "@/lib/format";
import { cancelImageBatchRun, deleteImageBatchRun, getImageBatchRun, retryFailedImages } from "@/features/image-batch/actions";
import type { ImageBatchItemView, ImageBatchView } from "@/lib/image-batch/start";
import type { OpenImageRun } from "./use-image-runs";

/** A run that hasn't moved after this long is probably waiting for a worker that isn't running. */
const STUCK_MS = 30_000;

const ITEM_TONE: Record<BatchItemStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-accent text-primary",
  done: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-[#ef4444]",
  cancelled: "bg-muted text-subtle",
};
const RUN_TONE: Record<BatchStatus, string> = { running: "bg-accent text-primary", done: "bg-emerald-50 text-emerald-700", cancelled: "bg-muted text-subtle" };

const finished = (b: ImageBatchView) => b.counts.done + b.counts.failed + b.counts.cancelled;

/** Right side of every bulk image tool: the open run (progress, image grid) and recent runs. */
export function BulkImageCanvas({
  open,
  runs,
  onShow,
  onChanged,
  onDeleted,
  emptyTitle,
  emptyBody,
}: {
  open: OpenImageRun | null;
  runs: ImageBatchView[];
  onShow: (id: string) => void;
  onChanged: (run: OpenImageRun | null) => void;
  onDeleted: (id: string) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto bg-canvas p-8">
      {open ? (
        <RunView key={open.batch.id} run={open} onChanged={onChanged} onDeleted={onDeleted} />
      ) : (
        <div className="mx-auto flex w-[480px] max-w-full flex-col items-center gap-4 pt-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
            <Images className="size-8" strokeWidth={1.5} aria-hidden />
          </div>
          <h2 className="text-lg font-bold">{emptyTitle}</h2>
          <p className="text-[13px] leading-normal text-muted-foreground">{emptyBody}</p>
        </div>
      )}
      {runs.length > 0 && <RecentRuns runs={runs} activeId={open?.batch.id ?? null} onShow={onShow} />}
    </section>
  );
}

function RunView({ run, onChanged, onDeleted }: { run: OpenImageRun; onChanged: (run: OpenImageRun | null) => void; onDeleted: (id: string) => void }) {
  const t = useTranslations("ImageBulk");
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
    onChanged(await getImageBatchRun(batch.id));
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    const result = await deleteImageBatchRun(batch.id);
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
              <bdi>{batch.settings.title}</bdi> · <bdi>{batch.settings.aspectRatio}</bdi> · <bdi>{batch.createdBy}</bdi> ·{" "}
              <bdi>{format.dateTime(new Date(batch.createdAt), { dateStyle: "medium", timeStyle: "short", ...LATN })}</bdi>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {batch.canManage && batch.status === "running" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => cancelImageBatchRun(batch.id))}>
                <Ban aria-hidden />
                {t("cancel")}
              </Button>
            )}
            {batch.canManage && batch.status !== "cancelled" && batch.counts.failed > 0 && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => retryFailedImages(batch.id))}>
                <RotateCcw aria-hidden />
                {t("retry")}
              </Button>
            )}
            {batch.counts.done > 0 && (
              <Link href="/history" className={buttonVariants({ size: "sm" })}>
                <Images aria-hidden />
                {t("viewHistory")}
              </Link>
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
            {batch.counts.failed > 0 && <span className="text-[#ef4444]">{t("countFailed", { count: batch.counts.failed })}</span>}
            {batch.counts.cancelled > 0 && <span>{t("countCancelled", { count: batch.counts.cancelled })}</span>}
          </div>
          {waiting && stuck && <p className="text-[11px] text-amber-600">{t("waitingWorker")}</p>}
        </div>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("imagesLabel")}>
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ItemCard({ item }: { item: ImageBatchItemView }) {
  const t = useTranslations("ImageBulk");
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border bg-background">
      <div className="relative flex aspect-square items-center justify-center bg-muted">
        {item.imageUrl ? (
          <a href={item.imageUrl} target="_blank" rel="noreferrer" className="block size-full" aria-label={t("openImage", { sku: item.sku })}>
            {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset served by /api/assets */}
            <img src={item.imageUrl} alt={item.sku} className="size-full object-cover" />
          </a>
        ) : item.status === "running" ? (
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        ) : item.status === "failed" ? (
          <TriangleAlert className="size-6 text-[#ef4444]" aria-hidden />
        ) : (
          <Images className="size-6 text-subtle" aria-hidden />
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs" dir="ltr">
            {item.sku}
          </span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", ITEM_TONE[item.status])}>{t(`itemStatus.${item.status}`)}</span>
        </div>
        {item.status === "failed" && item.error && (
          <span className="text-[11px] leading-snug text-[#ef4444]">{t.has(`itemErrors.${item.error}`) ? t(`itemErrors.${item.error}`) : t("itemErrors.generation_failed")}</span>
        )}
      </div>
    </li>
  );
}

function RecentRuns({ runs, activeId, onShow }: { runs: ImageBatchView[]; activeId: string | null; onShow: (id: string) => void }) {
  const t = useTranslations("ImageBulk");
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
              <Images className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
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
