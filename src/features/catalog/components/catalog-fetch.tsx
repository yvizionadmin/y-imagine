"use client";

import { useState } from "react";
import { CircleCheck, DownloadCloud, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CatalogProduct } from "@/lib/catalog/types";
import { importCatalogImage, lookupCatalogProduct, type CatalogLookupResult } from "../actions";

type State =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; product: CatalogProduct; source: string; importing: string | null }
  | { status: "imported"; product: CatalogProduct; source: string }
  | { status: "error"; error: Extract<CatalogLookupResult, { ok: false }>["error"] };

async function dataUrlToFile(dataUrl: string, name: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: "image/png" });
}

/** "Fetch from catalog" under a SKU field: look the SKU up in the org's default catalog, pick an image. */
export function CatalogFetch({
  sku,
  disabled,
  onImport,
}: {
  sku: string;
  disabled?: boolean;
  onImport: (file: File, product: CatalogProduct) => void;
}) {
  const t = useTranslations("Catalog");
  const [state, setState] = useState<State>({ status: "idle" });

  async function search() {
    setState({ status: "searching" });
    const result = await lookupCatalogProduct(sku);
    setState(
      result.ok
        ? { status: "found", product: result.product, source: result.source.name, importing: null }
        : { status: "error", error: result.error },
    );
  }

  async function pick(imageUrl: string) {
    if (state.status !== "found") return;
    setState({ ...state, importing: imageUrl });
    const result = await importCatalogImage(state.product.sku, imageUrl);
    if (!result.ok) return setState({ status: "error", error: result.error });
    onImport(await dataUrlToFile(result.dataUrl, result.name), state.product);
    setState({ status: "imported", product: state.product, source: state.source });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={search}
          disabled={disabled || !sku.trim() || state.status === "searching"}
          className="flex items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-50"
        >
          {state.status === "searching" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <DownloadCloud className="size-3" aria-hidden />
          )}
          {state.status === "searching" ? t("fetching") : t("fetch")}
        </button>
        {state.status === "imported" && (
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-emerald-700">
            <CircleCheck className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{t("imported", { source: state.source })}</span>
          </span>
        )}
      </div>

      {state.status === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
          {t(`errors.${state.error}`)}{" "}
          {state.error === "no_connection" && (
            <Link href="/settings/integrations" className="font-semibold underline">
              {t("errors.connect")}
            </Link>
          )}
        </p>
      )}

      {state.status === "found" && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted p-3" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold">{state.product.name}</span>
              <span className="truncate text-[10px] text-muted-foreground">
                {[state.product.category, t("from", { source: state.source })].filter(Boolean).join(" · ")}
              </span>
            </div>
            <button type="button" aria-label={t("close")} onClick={() => setState({ status: "idle" })} className="text-subtle hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">
            {state.importing ? t("importing") : t("pickImage")}
          </span>
          <div className="flex flex-wrap gap-2">
            {state.product.images.map((src) => (
              <button
                key={src}
                type="button"
                disabled={state.importing !== null}
                onClick={() => pick(src)}
                className="relative size-14 overflow-hidden rounded-lg border-2 border-transparent bg-background hover:border-primary disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- catalog image URL */}
                <img src={src} alt="" className="size-full object-cover" />
                {state.importing === src && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
