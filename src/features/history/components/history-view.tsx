"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Info, LayoutGrid, List, Loader2, Pencil, Plus, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { zipSync } from "fflate";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "@/i18n/navigation";
import { deleteGenerations, markGenerationsUploaded, publishGenerations, queryHistory } from "../actions";
import { HISTORY_PAGE_SIZES, type HistoryFilters, type HistoryItem } from "../types";
import { HistoryDrawer } from "./history-drawer";
import { HistoryFilterBar, Select, type FilterDraft } from "./history-filters";
import { HistoryCard, HistoryRow, type ItemActions } from "./history-items";

type Data = Awaited<ReturnType<typeof queryHistory>>;
type Notice = { tone: "success" | "error"; text: string } | null;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

async function fetchImage(item: HistoryItem) {
  const blob = await (await fetch(item.imageUrl)).blob();
  return { blob, name: `${item.sku || "studio"}_${item.mode}_${item.id.slice(0, 8)}.${EXT[blob.type] ?? "png"}` };
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}

export function HistoryView() {
  const t = useTranslations("History");
  const [draft, setDraft] = useState<FilterDraft>({});
  const [applied, setApplied] = useState<FilterDraft>({});
  const [sort, setSort] = useState<HistoryFilters["sort"]>("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(HISTORY_PAGE_SIZES[1]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Set<string> | "all">(new Set());
  const [busy, setBusy] = useState<"zip" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(
    async () => setData(await queryHistory({ ...applied, sort, page, pageSize })),
    [applied, sort, page, pageSize],
  );
  useEffect(() => {
    queryHistory({ ...applied, sort, page, pageSize }).then(setData);
  }, [applied, sort, page, pageSize]);

  const items = data?.items ?? [];
  const openItem = items.find((i) => i.id === openId) ?? null;
  const filtered = Object.values(applied).some(Boolean);
  const isPublishing = (id: string) => publishing === "all" || publishing.has(id);

  function apply(next: FilterDraft) {
    setApplied(next);
    setDraft(next);
    setPage(1);
    setSelected(new Set());
  }

  async function publish(ids: string[] | "all-pending") {
    setNotice(null);
    setPublishing(ids === "all-pending" ? "all" : new Set(ids));
    const result = await publishGenerations(ids);
    setPublishing(new Set());
    if (!result.ok) return setNotice({ tone: "error", text: t("noTarget", { count: data?.pendingCount ?? 0 }) });
    const ok = result.results.filter((r) => r.ok).length;
    const failed = result.results.filter((r) => !r.ok);
    const firstError = failed[0]?.error;
    setNotice({
      tone: failed.length ? "error" : "success",
      text: `${t("publishDone", { ok, failed: failed.length })}${firstError ? ` (${t(`publishErrors.${firstError}`)})` : ""}`,
    });
    setSelected(new Set());
    await load();
  }

  async function remove(ids: string[]) {
    if (!window.confirm(t("deleteConfirm", { count: ids.length }))) return;
    const result = await deleteGenerations(ids);
    if (result.ok) setNotice({ tone: "success", text: t("deleted", { count: result.count }) });
    setSelected(new Set());
    if (openId && ids.includes(openId)) setOpenId(null);
    await load();
  }

  async function markUploaded(ids: string[]) {
    const result = await markGenerationsUploaded(ids);
    if (result.ok) setNotice({ tone: "success", text: t("markedUploaded", { count: ids.length }) });
    setSelected(new Set());
    await load();
  }

  async function downloadZip(ids: string[]) {
    setBusy("zip");
    const files: Record<string, Uint8Array> = {};
    for (const item of items.filter((i) => ids.includes(i.id))) {
      const { blob, name } = await fetchImage(item);
      files[name] = new Uint8Array(await blob.arrayBuffer());
    }
    const zipped = zipSync(files, { level: 0 });
    saveBlob(new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }), `imagine-history-${new Date().toISOString().slice(0, 10)}.zip`);
    setBusy(null);
  }

  const actions: ItemActions = {
    onOpen: (item) => setOpenId(item.id),
    onToggle: (id) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onDownload: async (item) => {
      const { blob, name } = await fetchImage(item);
      saveBlob(blob, name);
    },
    onPublish: data?.publishTarget && data.canEdit ? (item) => publish([item.id]) : null,
    onDelete: (item) => remove([item.id]),
  };

  const selectedIds = [...selected];
  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-10">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-bold">{t("title")}</h1>
          <p className="text-[13px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/generate" className="flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Plus className="size-4" aria-hidden />
          {t("createNew")}
        </Link>
      </div>

      <HistoryFilterBar
        draft={draft}
        applied={applied}
        onChange={setDraft}
        onApply={() => apply(draft)}
        onRemove={(keys) => apply(Object.fromEntries(Object.entries(applied).filter(([k]) => !keys.includes(k as keyof FilterDraft))))}
      />

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] font-medium",
            notice.tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-danger",
          )}
        >
          {notice.text}
          <button type="button" aria-label={t("dismiss")} onClick={() => setNotice(null)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {data && data.pendingCount > 0 && data.canEdit && (
        data.publishTarget ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3">
            <span className="flex items-center gap-2.5 text-[13px] font-semibold text-[#9a3412]">
              <Info className="size-4 text-primary" aria-hidden />
              {t("pendingBanner", { count: data.pendingCount, target: data.publishTarget.name })}
            </span>
            <Button onClick={() => publish("all-pending")} disabled={publishing === "all"} className="font-semibold">
              {publishing === "all" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {publishing === "all" ? t("uploading") : t("uploadAll")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-background px-4 py-3">
            <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <CircleAlert className="size-4 shrink-0 text-subtle" aria-hidden />
              {t("noTarget", { count: data.pendingCount })}
            </span>
            <Link href="/settings/integrations" className="shrink-0 text-xs font-semibold text-primary hover:underline">
              {t("connect")}
            </Link>
          </div>
        )
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#94a3b8]/30 px-4 py-2.5">
          <span className="flex items-center gap-3 text-[13px] font-semibold">
            <Checkbox checked onCheckedChange={() => setSelected(new Set())} aria-label={t("clearSelection")} />
            {t("selected", { count: selected.size })}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => downloadZip(selectedIds)} disabled={busy === "zip"} className="bg-background">
              {busy === "zip" && <Loader2 className="animate-spin" aria-hidden />}
              {busy === "zip" ? t("zipping") : t("downloadZip")}
            </Button>
            {data?.canEdit && data.publishTarget && (
              <Button onClick={() => publish(selectedIds)} disabled={publishing !== "all" && publishing.size > 0}>
                {t("uploadSelected")}
              </Button>
            )}
            {data?.canEdit && <Button onClick={() => markUploaded(selectedIds)}>{t("markUploaded")}</Button>}
            {data?.canEdit && (
              <Button className="bg-[#4338ca]" onClick={() => remove(selectedIds)}>
                {t("deleteSelected")}
              </Button>
            )}
          </div>
        </div>
      )}

      {!data ? (
        <div className="flex justify-center py-24 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-hidden />
        </div>
      ) : !data.hasAny ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-background px-6 py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-accent">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Pencil className="size-4" aria-hidden />
            </span>
          </div>
          <h2 className="text-lg font-bold">{t("emptyTitle")}</h2>
          <p className="max-w-md text-[13px] text-muted-foreground">{t("emptyBody")}</p>
          <Link href="/generate" className="mt-2 flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" aria-hidden />
            {t("createNewImage")}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {items.length > 0 && (
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={() => setSelected(allOnPageSelected ? new Set() : new Set(items.map((i) => i.id)))}
                  aria-label={t("selectPage")}
                />
              )}
              <h2 className="text-[15px] font-bold">{t("count", { count: data.total })}</h2>
            </div>
            <div className="flex items-center gap-3">
              <Select
                label={t("sortLabel")}
                value={sort}
                onChange={(value) => setSort(value as HistoryFilters["sort"])}
                options={[
                  { value: "newest", label: t("sortNewest") },
                  { value: "oldest", label: t("sortOldest") },
                ]}
                className="w-36"
              />
              <div className="flex rounded-lg border bg-background p-0.5">
                {(["grid", "list"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={t(mode === "grid" ? "gridView" : "listView")}
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className={cn("rounded-md p-1.5 text-muted-foreground", view === mode && "bg-muted text-foreground")}
                  >
                    {mode === "grid" ? <LayoutGrid className="size-4" aria-hidden /> : <List className="size-4" aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border bg-background px-6 py-16 text-center">
              <h2 className="text-base font-bold">{t("noResults")}</h2>
              <p className="text-[13px] text-muted-foreground">{t("noResultsBody")}</p>
              {filtered && (
                <Button variant="outline" className="mt-2" onClick={() => apply({})}>
                  {t("clear")}
                </Button>
              )}
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {items.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  publishing={isPublishing(item.id)}
                  showUpload={applied.status === "pending" || applied.status === "failed"}
                  actions={actions}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-background">
              <table className="w-full text-start text-sm">
                <tbody>
                  {items.map((item) => (
                    <HistoryRow key={item.id} item={item} selected={selected.has(item.id)} actions={actions} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.total > 0 && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">
                {t("range", {
                  start: (page - 1) * pageSize + 1,
                  end: Math.min(page * pageSize, data.total),
                  total: t("count", { count: data.total }),
                })}
              </span>
              <nav className="flex items-center gap-1.5" aria-label="pagination">
                <PageButton label={t("prev")} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
                </PageButton>
                {Array.from({ length: pages }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === pages)
                  .map((p) => (
                    <PageButton key={p} label={String(p)} current={p === page} onClick={() => setPage(p)}>
                      {p}
                    </PageButton>
                  ))}
                <PageButton label={t("next")} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                </PageButton>
              </nav>
              <Select
                label={t("pageSizeLabel")}
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                options={HISTORY_PAGE_SIZES.map((size) => ({ value: String(size), label: t("perPage", { size }) }))}
                className="w-28"
              />
            </div>
          )}
        </>
      )}

      <HistoryDrawer
        item={openItem}
        onClose={() => setOpenId(null)}
        onDownload={actions.onDownload}
        onPublish={actions.onPublish}
        publishing={openItem ? isPublishing(openItem.id) : false}
        onDelete={(item) => remove([item.id])}
      />
    </div>
  );
}

function PageButton({
  label,
  current,
  disabled,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border bg-background text-xs font-semibold disabled:opacity-40",
        current && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {children}
    </button>
  );
}
