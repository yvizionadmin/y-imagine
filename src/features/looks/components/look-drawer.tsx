"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import type { LookView } from "../actions";
import { LOOK_RATIOS } from "../config";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

/** Look Details drawer (Figma 98:10207), opened from a History row. */
export function LookDrawer({
  look,
  canEdit,
  regenerating,
  error,
  onClose,
  onRegenerate,
}: {
  look: LookView | null;
  canEdit: boolean;
  regenerating: boolean;
  error: string | null;
  onClose: () => void;
  onRegenerate: (look: LookView) => void;
}) {
  const t = useTranslations("Looks");
  const format = useFormatter();
  const locale = useLocale();
  const ratio = look ? LOOK_RATIOS.find((r) => r.key === look.aspectRatio) : undefined;

  return (
    <Sheet open={look !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-[480px] gap-0 p-0 sm:max-w-[480px]">
        {look && (
          <>
            <div className="flex items-center justify-between border-b p-6">
              <SheetTitle className="text-lg font-extrabold">{t("lookDetails")}</SheetTitle>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
                <img src={look.imageUrl} alt={look.title} className="h-[220px] w-full rounded-lg bg-muted object-cover" />
                {regenerating && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                    <Loader2 className="size-6 animate-spin text-white" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-extrabold">{look.title}</h3>
                <p className="text-xs font-medium text-muted-foreground">
                  {t.rich("lookId", {
                    id: `LOK-${look.id.slice(0, 5).toUpperCase()}`,
                    mode: t(`modes.${look.mode}`),
                    ltr: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
                  })}
                </p>
              </div>

              <dl className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4 text-[13px]">
                <Row label={t("roomType")}>{look.roomType ? t(`rooms.${look.roomType}` as "rooms.livingRoom") : "—"}</Row>
                <Row label={t("styleLabel")}>{look.style ? t(`styles.${look.style}` as "styles.luxury") : "—"}</Row>
                <Row label={t("productsArranged")}>{t("items", { count: look.items.length })}</Row>
                {ratio && (
                  <>
                    <Row label={t("resolution")}>
                      <span dir="ltr">{`${ratio.w}×${ratio.h}`}</span>
                    </Row>
                    <Row label={t("aspectRatio")}>
                      <span dir="ltr">{ratio.key}</span> {t(`ratios.${ratio.label}`)}
                    </Row>
                  </>
                )}
                <Row label={t("createdDate")}>
                  {format.dateTime(new Date(look.createdAt), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
                </Row>
              </dl>

              <section className="flex flex-col gap-2.5">
                <h3 className="text-sm font-extrabold">{t("productsUsed")}</h3>
                <ul className="flex flex-col gap-2">
                  {look.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 rounded-lg border bg-background p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
                      <img src={thumbnailUrl(item.imageUrl, 96)} alt="" className="size-9 shrink-0 rounded bg-muted object-contain" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-xs font-bold">{item.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground" dir="ltr">
                          {item.sku}
                          {item.category ? ` • ${item.category}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {canEdit && (
              <div className="flex flex-col gap-2 border-t p-6">
                {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">{error}</p>}
                <div className="flex gap-3">
                  <Link
                    href={{ pathname: "/looks", query: { look: look.id } }}
                    className="flex h-10 flex-1 items-center justify-center rounded-lg border border-primary text-[13px] font-bold text-primary hover:bg-accent"
                  >
                    {t("openBuilder")}
                  </Link>
                  <Button onClick={() => onRegenerate(look)} disabled={regenerating} className="h-10 flex-1 text-[13px] font-bold">
                    {regenerating && <Loader2 className="animate-spin" aria-hidden />}
                    {regenerating ? t("regenerating") : t("regenerate")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="text-end font-semibold">{children}</dd>
    </div>
  );
}
