"use client";

import { Loader2, MoreVertical, Upload } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReviewBadge } from "@/features/copy/components/review-bar";
import type { GenerationMode, HistoryItem, PublishStatus } from "../types";

const modeBadge: Record<GenerationMode, string> = {
  create: "bg-[#8b5cf6]",
  video: "bg-[#f97316]",
  lifestyle: "bg-primary",
  recolor: "bg-[#ec4899]",
  aplus: "bg-[#06b6d4]",
};

const statusDot: Record<PublishStatus, string> = {
  uploaded: "bg-emerald-500",
  pending: "bg-amber-500",
  failed: "bg-[#ef4444]",
};

/** The item's image, or a video player for Studio videos. */
export function HistoryMedia({ item, className, controls, alt }: { item: HistoryItem; className?: string; controls?: boolean; alt?: string }) {
  if (item.mode === "video") {
    return (
      <video
        // Without controls it's a thumbnail: `#t=0.1` makes browsers paint a frame instead of a blank box.
        src={controls ? item.imageUrl : `${item.imageUrl}#t=0.1`}
        controls={controls}
        muted={!controls}
        playsInline
        preload="metadata"
        aria-label={item.title}
        className={cn("bg-black", className)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route
  return <img src={item.imageUrl} alt={alt ?? (item.title || item.sku)} loading="lazy" className={className} />;
}

export function ModeBadge({ mode, className }: { mode: GenerationMode; className?: string }) {
  const t = useTranslations("History");
  return (
    <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white", modeBadge[mode], className)}>
      {t(`modes.${mode}`)}
    </span>
  );
}

export function StatusLabel({ status }: { status: PublishStatus }) {
  const t = useTranslations("History");
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold">
      <span className={cn("size-1.5 rounded-full", statusDot[status])} />
      {t(`statuses.${status}`)}
    </span>
  );
}

export type ItemActions = {
  onOpen: (item: HistoryItem) => void;
  onToggle: (id: string) => void;
  onDownload: (item: HistoryItem) => void;
  onPublish: ((item: HistoryItem) => void) | null;
  /** The org only uploads approved images, and this one isn't. */
  uploadBlocked: (item: HistoryItem) => boolean;
  /** Show the approval state on images (draft only once approvals matter). */
  showDraftBadge: boolean;
  onDelete: (item: HistoryItem) => void;
};

function ImageReviewBadge({ item, showDraft }: { item: HistoryItem; showDraft: boolean }) {
  if (item.mode === "video" || (item.reviewStatus === "draft" && !showDraft)) return null;
  return <ReviewBadge status={item.reviewStatus} className="w-fit" />;
}

function ItemMenu({ item, actions, className }: { item: HistoryItem; actions: ItemActions; className?: string }) {
  const t = useTranslations("History");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("actions", { sku: item.sku })}
        className={cn("flex size-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70", className)}
      >
        <MoreVertical className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 font-sans">
        <DropdownMenuItem onClick={() => actions.onOpen(item)}>{t("viewDetails")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onDownload(item)}>{t("download")}</DropdownMenuItem>
        {actions.onPublish && item.status !== "uploaded" && !actions.uploadBlocked(item) && (
          <DropdownMenuItem onClick={() => actions.onPublish!(item)}>{t("uploadToWebsite")}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(item)}>
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HistoryCard({
  item,
  selected,
  publishing,
  showUpload,
  actions,
}: {
  item: HistoryItem;
  selected: boolean;
  publishing: boolean;
  showUpload: boolean;
  actions: ItemActions;
}) {
  const t = useTranslations("History");
  const format = useFormatter();

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md",
        selected && "border-primary ring-2 ring-primary/30",
      )}
    >
      <button type="button" onClick={() => actions.onOpen(item)} className="relative block aspect-[4/2.5] w-full overflow-hidden bg-muted">
        <HistoryMedia item={item} className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
      </button>
      <ModeBadge mode={item.mode} className="absolute start-2 top-2" />
      <div className="absolute end-2 top-2 flex items-center gap-1.5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => actions.onToggle(item.id)}
          aria-label={t("select", { sku: item.sku })}
          className={cn("size-5 bg-white/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100", selected && "opacity-100")}
        />
        <ItemMenu item={item} actions={actions} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold" dir="ltr">
            {item.sku}
          </span>
          {item.sku && <StatusLabel status={item.status} />}
        </div>
        {item.title && <span className="truncate text-xs text-muted-foreground">{item.title}</span>}
        <ImageReviewBadge item={item} showDraft={actions.showDraftBadge} />
        <span className="text-[10px] text-subtle">{format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}</span>
        {showUpload && actions.onPublish && item.sku !== "" && item.status !== "uploaded" && actions.uploadBlocked(item) && <p className="mt-2 text-center text-[11px] font-semibold text-muted-foreground">{t("needsApproval")}</p>}
        {showUpload && actions.onPublish && item.sku !== "" && item.status !== "uploaded" && !actions.uploadBlocked(item) && (
          <button
            type="button"
            disabled={publishing}
            onClick={() => actions.onPublish!(item)}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-primary py-1.5 text-xs font-semibold text-primary hover:bg-accent disabled:opacity-60"
          >
            {publishing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            {publishing ? t("uploading") : t("uploadToWebsite")}
          </button>
        )}
      </div>
    </article>
  );
}

export function HistoryRow({
  item,
  selected,
  actions,
}: {
  item: HistoryItem;
  selected: boolean;
  actions: ItemActions;
}) {
  const t = useTranslations("History");
  const format = useFormatter();
  return (
    <tr className={cn("border-b last:border-b-0 hover:bg-muted/50", selected && "bg-accent/60")}>
      <td className="w-10 ps-4">
        <Checkbox checked={selected} onCheckedChange={() => actions.onToggle(item.id)} aria-label={t("select", { sku: item.sku })} />
      </td>
      <td className="py-2">
        <button type="button" onClick={() => actions.onOpen(item)} className="flex items-center gap-3 text-start">
          <HistoryMedia item={item} alt="" className="h-10 w-14 rounded-md bg-muted object-cover" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-bold" dir="ltr">
              {item.sku}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{item.title}</span>
          </span>
        </button>
      </td>
      <td>
        <ModeBadge mode={item.mode} />
      </td>
      <td>
        <span className="flex flex-col gap-1">
          {item.sku && <StatusLabel status={item.status} />}
          <ImageReviewBadge item={item} showDraft={actions.showDraftBadge} />
        </span>
      </td>
      <td className="text-[11px] text-muted-foreground">
        {format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
      </td>
      <td className="pe-4 text-end">
        <ItemMenu item={item} actions={actions} className="bg-transparent text-foreground hover:bg-muted" />
      </td>
    </tr>
  );
}
