"use client";

import { blockedReason } from "@/components/app/job-errors";
import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { ExportDialog } from "@/components/app/export-dialog";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import type { CatalogProduct } from "@/lib/catalog/types";
import { addLookProduct, duplicateLook, getLookById, regenerateLook, searchLookProducts, swapLookProduct, type AddedProduct, type LookView } from "../actions";
import { LOOK_RATIOS, type LookItem } from "../config";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

type Busy = "regenerate" | "swap" | "duplicate" | null;

/** Mood board detail (Figma 98:9575) with the Swap Product panel (98:9733). */
export function MoodBoardDetail({ id }: { id: string }) {
  const t = useTranslations("Looks");
  const tw = useTranslations("Workspace");
  const router = useRouter();
  const [state, setState] = useState<{ look: LookView; canEdit: boolean } | null | undefined>(undefined);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapItemId, setSwapItemId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    getLookById(id).then(setState);
  }, [id]);

  if (state === undefined) return <Loader2 className="mx-auto mt-24 size-6 animate-spin text-muted-foreground" aria-hidden />;
  if (state === null) {
    return (
      <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-background px-6 py-12 text-center">
        <p className="text-sm font-semibold">{t("notFound")}</p>
        <Link href="/looks/boards" className="text-[13px] font-semibold text-primary underline">{t("backToBoards")}</Link>
      </div>
    );
  }

  const { look, canEdit } = state;
  const ratio = LOOK_RATIOS.find((r) => r.key === look.aspectRatio) ?? LOOK_RATIOS[0];
  const swapItem = look.items.find((i) => i.id === swapItemId) ?? null;
  const errorText = (code: string) => {
    const blocked = blockedReason(code);
    return blocked ? tw(`blocked.${blocked}.body`) : t(code === "forbidden" ? "forbidden" : code === "not_found" ? "notFound" : "failed");
  };

  async function run<T extends { ok: true; look: LookView } | { ok: false; error: string }>(kind: Busy, action: () => Promise<T>) {
    setError(null);
    setBusy(kind);
    const response = await action();
    setBusy(null);
    if (!response.ok) {
      setError(errorText(response.error));
      return null;
    }
    return response.look;
  }

  async function regenerate() {
    const updated = await run("regenerate", () => regenerateLook(look.id));
    if (updated) setState({ look: updated, canEdit });
  }

  async function duplicate() {
    const copy = await run("duplicate", () => duplicateLook(look.id, t("copyTitle", { title: look.title })));
    if (copy) router.push(`/looks/boards/${copy.id}`);
  }

  async function swap(product: AddedProduct) {
    if (!swapItem) return;
    const updated = await run("swap", () => swapLookProduct(look.id, swapItem.id, product));
    if (updated) setState({ look: updated, canEdit });
  }

  const roomLabel = look.roomType ? t(`rooms.${look.roomType}` as "rooms.livingRoom") : null;

  return (
    <div className="flex min-h-full">
      <div className="flex min-w-0 flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold">{look.title}</h1>
              {!swapItem && roomLabel && <span className="rounded bg-accent px-2 py-0.5 text-[11px] font-bold text-primary">{roomLabel}</span>}
              {!swapItem && look.style && <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-bold">{t(`styles.${look.style}` as "styles.luxury")}</span>}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {look.prompt || t("resultMeta", { count: look.items.length, room: roomLabel ?? "—", ratio: look.aspectRatio })}
            </p>
          </div>
          {!swapItem && (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <>
                  <Link href={{ pathname: "/looks", query: { look: look.id } }} className="rounded-lg border bg-background px-4 py-2.5 text-[13px] font-semibold hover:bg-muted">
                    {t("editLook")}
                  </Link>
                  <HeaderButton onClick={() => setSwapItemId(look.items[0]?.id ?? null)} disabled={busy !== null}>{t("swapProduct")}</HeaderButton>
                  <HeaderButton onClick={regenerate} disabled={busy !== null} loading={busy === "regenerate"}>{t("regenerate")}</HeaderButton>
                  <HeaderButton onClick={duplicate} disabled={busy !== null} loading={busy === "duplicate"}>{t("duplicate")}</HeaderButton>
                </>
              )}
              <Button onClick={() => setExportOpen(true)} className="h-auto px-4 py-2.5 text-[13px] font-bold">{t("export")}</Button>
            </div>
          )}
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">{error}</p>}

        <div className="relative">
          {/* Contained, not cropped like the Figma hero: a 1:1 or 4:3 look would lose products at the edges. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
          <img src={look.imageUrl} alt={look.title} className="h-[420px] w-full rounded-2xl border bg-muted object-contain" />
          {(busy === "regenerate" || busy === "swap") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/40 text-sm font-semibold text-white">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              {t("rerendering")}
            </div>
          )}
        </div>

        {!swapItem && (
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-extrabold">{t("includedProducts", { count: look.items.length })}</h2>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {look.items.map((item) => (
                <li key={item.id} className="shrink-0">
                  <ProductCard item={item} onSwap={canEdit && busy === null ? () => setSwapItemId(item.id) : null} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {swapItem && (
        <SwapPanel
          key={swapItem.id}
          look={look}
          item={swapItem}
          busy={busy === "swap"}
          onSelectItem={setSwapItemId}
          onClose={() => setSwapItemId(null)}
          onSwap={swap}
        />
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        image={{ url: look.imageUrl, width: ratio.w, height: ratio.h }}
        filenameBase={`look_${look.title.replace(/[^A-Za-z0-9_-]+/g, "_")}`}
        aspectRatio={look.aspectRatio}
        resolution={`${ratio.w}×${ratio.h}`}
      />
    </div>
  );
}

function HeaderButton({ onClick, disabled, loading, children }: { onClick: () => void; disabled: boolean; loading?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 rounded-lg border bg-background px-4 py-2.5 text-[13px] font-semibold hover:bg-muted disabled:opacity-60">
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

function ProductCard({ item, onSwap }: { item: LookItem; onSwap: (() => void) | null }) {
  const t = useTranslations("Looks");
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
      <img src={thumbnailUrl(item.imageUrl, 256)} alt="" loading="lazy" className="h-[100px] w-full rounded-lg bg-muted object-contain" />
      <span className="flex w-full flex-col gap-0.5 text-start">
        <span className="truncate text-xs font-bold">{item.name}</span>
        <span className="truncate text-[10px] text-muted-foreground" dir="ltr">#{item.sku}</span>
      </span>
    </>
  );
  const className = "flex w-[150px] flex-col gap-2.5 rounded-xl border bg-background p-3";
  return onSwap ? (
    <button type="button" onClick={onSwap} aria-label={t("swapThis", { name: item.name })} className={cn(className, "hover:border-primary")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function SwapPanel({
  look,
  item,
  busy,
  onSelectItem,
  onClose,
  onSwap,
}: {
  look: LookView;
  item: LookItem;
  busy: boolean;
  onSelectItem: (id: string) => void;
  onClose: () => void;
  onSwap: (product: AddedProduct) => Promise<void>;
}) {
  const t = useTranslations("Looks");
  const [query, setQuery] = useState(item.category ?? item.name);
  const [results, setResults] = useState<CatalogProduct[] | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "no_connection" | "error">("searching");
  const [adding, setAdding] = useState<string | null>(null);

  function show(response: Awaited<ReturnType<typeof searchLookProducts>>) {
    if (response.ok) {
      setResults(response.products.filter((p) => p.sku !== item.sku));
      setStatus("idle");
    } else setStatus(response.error === "no_connection" ? "no_connection" : "error");
  }

  async function search(term: string) {
    setStatus("searching");
    show(await searchLookProducts(term));
  }

  // Suggest same-category replacements when the panel opens for a product (remounted per item).
  useEffect(() => {
    searchLookProducts(query).then(show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted item
  }, []);

  async function select(product: CatalogProduct) {
    setAdding(product.sku);
    const response = await addLookProduct({ source: "catalog", sku: product.sku, imageUrl: product.images[0] });
    if (response.ok) await onSwap(response.product);
    else setStatus("error");
    setAdding(null);
  }

  return (
    <aside className="flex w-[400px] shrink-0 flex-col gap-5 border-s bg-background p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">{t("swapProduct")}</h2>
        <button type="button" onClick={onClose} aria-label={t("close")} className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase">{t("currentSelection")}</h3>
        <div className="flex items-center gap-3 rounded-xl border border-primary bg-accent p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
          <img src={thumbnailUrl(item.imageUrl, 256)} alt="" className="size-14 shrink-0 rounded-lg bg-background object-contain" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] font-bold text-primary">{item.name}</span>
            <span className="truncate text-[11px] text-muted-foreground" dir="ltr">
              {item.sku}
              {item.category ? ` • ${item.category}` : ""}
            </span>
          </span>
        </div>
        {look.items.length > 1 && (
          <div role="radiogroup" aria-label={t("chooseProduct")} className="flex flex-wrap gap-1.5">
            {look.items.map((i) => (
              <button
                key={i.id}
                type="button"
                role="radio"
                aria-checked={i.id === item.id}
                aria-label={i.name}
                title={i.name}
                disabled={busy}
                onClick={() => onSelectItem(i.id)}
                className={cn("size-10 overflow-hidden rounded-md border-2 border-transparent bg-muted", i.id === item.id && "border-primary")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
                <img src={thumbnailUrl(i.imageUrl, 256)} alt="" className="size-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </section>

      <hr />

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase">{t("replaceWith")}</h3>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <input value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchReplacement")} aria-label={t("searchReplacement")}
            className="h-10 w-full rounded-lg border ps-3 pe-9 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring" />
          <button type="submit" aria-label={t("search")} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-4" aria-hidden />
          </button>
        </form>

        {status === "searching" && <Loader2 className="mx-auto mt-4 size-5 animate-spin text-muted-foreground" aria-hidden />}
        {status === "no_connection" && (
          <p className="rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">
            {t("noConnection")} <Link href="/settings/integrations" className="font-semibold text-primary underline">{t("connect")}</Link>
          </p>
        )}
        {status === "error" && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[11px] text-danger">{t("failed")}</p>}
        {status === "idle" && results?.length === 0 && <p className="text-[11px] text-muted-foreground">{t("noReplacements")}</p>}

        {status === "idle" && results && results.length > 0 && (
          <ul className="flex flex-col gap-2 overflow-y-auto">
            {results.map((p) => (
              <li key={p.sku} className="flex items-center gap-3 rounded-xl border p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- catalog image */}
                <img src={thumbnailUrl(p.images[0], 96)} alt="" className="size-12 shrink-0 rounded-lg bg-muted object-cover" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-xs font-bold">{p.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground" dir="ltr">
                    #{p.sku}
                    {p.category ? ` • ${p.category}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy || adding !== null}
                  onClick={() => select(p)}
                  className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold text-primary disabled:opacity-50"
                >
                  {adding === p.sku && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  {t("select")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-lg border bg-muted/60 p-3 text-[11px] leading-4 text-muted-foreground">{t("swapNote")}</p>
    </aside>
  );
}
