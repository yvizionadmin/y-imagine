"use client";

import { Loader2, Upload } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import type { HistoryItem } from "../types";
import { HistoryMedia, ModeBadge, StatusLabel } from "./history-items";
import { HistoryReview } from "./history-review";

const TOOL_ROUTE = { create: "/home", video: "/home", lifestyle: "/generate", recolor: "/recolor", aplus: "/aplus" } as const;
const TEXT_SETTINGS = ["instructions", "notes"];
const PRESET_SETTINGS: Record<string, "categories" | "scenes" | "styles"> = { category: "categories", scene: "scenes", style: "styles" };

export function HistoryDrawer({
  item,
  onClose,
  onDownload,
  onPublish,
  publishing,
  uploadBlocked,
  canSubmit,
  canApprove,
  onReviewed,
  onDelete,
}: {
  item: HistoryItem | null;
  onClose: () => void;
  onDownload: (item: HistoryItem) => void;
  onPublish: ((item: HistoryItem) => void) | null;
  publishing: boolean;
  uploadBlocked: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  onReviewed: () => Promise<void>;
  onDelete: (item: HistoryItem) => void;
}) {
  const t = useTranslations("History");
  const tp = useTranslations("Presets");
  const tl = useTranslations("Aplus");
  const format = useFormatter();
  const locale = useLocale();

  function settingValue(key: string, value: string) {
    const presetNs = PRESET_SETTINGS[key];
    if (presetNs && tp.has(`${presetNs}.${value}`)) return tp(`${presetNs}.${value}`);
    if (key === "layout" && tl.has(`layouts.${value}`)) return tl(`layouts.${value}`);
    if (key === "features") {
      try {
        return t("featureCount", { count: (JSON.parse(value) as unknown[]).length });
      } catch {
        return value;
      }
    }
    return value;
  }

  const settings = item ? Object.entries(item.settings).filter(([key, value]) => value && !TEXT_SETTINGS.includes(key)) : [];
  const instructions = item ? TEXT_SETTINGS.map((key) => item.settings[key]).find(Boolean) : null;

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-[360px] gap-0 p-0 sm:max-w-[360px]">
        {item && (
          <>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <SheetTitle className="text-base font-bold">{t("details")}</SheetTitle>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
              <HistoryMedia item={item} controls className="w-full rounded-xl border bg-muted object-contain" />

              <dl className="flex flex-col gap-3 text-xs">
                {item.sku && (
                  <Row label={t("identifier")}>
                    <span className="font-bold" dir="ltr">{item.sku}</span>
                  </Row>
                )}
                <Row label={t("mode")}>
                  <ModeBadge mode={item.mode} />
                </Row>
                <Row label={t("created")}>
                  {format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
                </Row>
                {item.sku && (
                  <Row label={t("status")}>
                    <StatusLabel status={item.status} />
                  </Row>
                )}
                {item.publishedTo && <Row label={t("publishedTo")}>{item.publishedTo}</Row>}
                <Row label={t("createdBy")}>{item.createdBy}</Row>
                <Row label={t("engine")}>
                  <span className="font-mono text-[11px]" dir="ltr">{`${item.provider} · ${item.model}`}</span>
                </Row>
              </dl>

              {item.status === "failed" && item.publishError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
                  {t("publishFailed", { error: t(`publishErrors.${item.publishError}` as "publishErrors.bad_response") })}
                </p>
              )}

              {item.mode !== "video" && <HistoryReview key={item.id} item={item} canSubmit={canSubmit} canApprove={canApprove} onChanged={onReviewed} />}

              {settings.length > 0 && (
                <section className="flex flex-col gap-3 border-t pt-4">
                  <h3 className="text-[11px] font-bold uppercase">{t("settings")}</h3>
                  <dl className="flex flex-col gap-2.5 text-xs">
                    {settings.map(([key, value]) => (
                      <Row key={key} label={t.has(`settingLabels.${key}`) ? t(`settingLabels.${key}` as "settingLabels.scene") : key}>
                        {settingValue(key, value!)}
                      </Row>
                    ))}
                  </dl>
                </section>
              )}

              {instructions && (
                <section className="flex flex-col gap-2 border-t pt-4">
                  <h3 className="text-[11px] font-bold uppercase">{t("instructions")}</h3>
                  <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed">{instructions}</p>
                </section>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t p-4">
              <Button onClick={() => onDownload(item)} className="h-10 font-semibold">
                {t(item.mode === "video" ? "downloadVideo" : "downloadImage")}
              </Button>
              {onPublish && item.sku !== "" && item.status !== "uploaded" && uploadBlocked && <p className="text-center text-[11px] font-semibold text-muted-foreground">{t("needsApproval")}</p>}
              {onPublish && item.sku !== "" && item.status !== "uploaded" && !uploadBlocked && (
                <Button variant="outline" disabled={publishing} onClick={() => onPublish(item)} className="h-9 border-primary text-primary">
                  {publishing ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
                  {publishing ? t("uploading") : t("uploadToWebsite")}
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={{ pathname: TOOL_ROUTE[item.mode], query: { sku: item.sku, from: item.id } }}
                  className="flex h-9 items-center justify-center rounded-lg border text-xs font-semibold hover:bg-muted"
                >
                  {t("openInTool", { tool: t(`tools.${item.mode}`) })}
                </Link>
                <Button variant="destructive" onClick={() => onDelete(item)} className="h-9">
                  {t("delete")}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground uppercase">{label}</dt>
      <dd className="text-end font-semibold">{children}</dd>
    </div>
  );
}
