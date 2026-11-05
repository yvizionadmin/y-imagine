"use client";

import { Braces, Boxes, ShoppingBag, Sofa, Store, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { CatalogProduct, ConnectorType } from "@/lib/catalog/types";

const icons: Record<ConnectorType, LucideIcon> = {
  shopify: ShoppingBag,
  magento: Boxes,
  woocommerce: Store,
  "custom-rest": Braces,
  demo: Sofa,
};

export function ConnectorIcon({ type, className }: { type: ConnectorType; className?: string }) {
  const Icon = icons[type];
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary", className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/** Compact result of a catalog lookup: name (+ Arabic), category and image thumbnails. */
export function ProductPreview({ product }: { product: CatalogProduct }) {
  const t = useTranslations("Integrations");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-emerald-800">{t("testOk", { name: product.name })}</span>
        <span className="text-[11px] text-muted-foreground">
          {[product.sku, product.category, product.nameAr, t("images", { count: product.images.length })].filter(Boolean).join(" · ")}
        </span>
      </div>
      {product.images.length > 0 && (
        <div className="flex gap-2">
          {product.images.slice(0, 5).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- catalog image URL
            <img key={src} src={src} alt="" className="size-12 rounded-md border bg-background object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
