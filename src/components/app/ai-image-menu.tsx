"use client";

import { useState } from "react";
import { Loader2, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getImageModelMenu } from "@/features/ai-providers/actions";
import { Link } from "@/i18n/navigation";
import type { ImageModelEntry } from "@/lib/ai/image-model-info";
import { aiImageTools } from "./nav-items";

type ModelMenu = Awaited<ReturnType<typeof getImageModelMenu>>;

/**
 * The rail's "AI Image" item: not a link of its own. Hovering (or clicking/tapping, for touch and
 * keyboard) opens a menu with the image tools (start column) and the image models the org's keys
 * can call (end column). It shows as active on any of the grouped tools' pages.
 */
export function AiImageRailItem({ active, compact }: { active: boolean; compact: boolean }) {
  const t = useTranslations("Shell");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<ModelMenu | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Keys can change between visits, so the models are re-read each time the menu opens.
    if (next) getImageModelMenu().then(setMenu, () => setMenu({ models: [], canManage: false }));
  }

  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={150}
        aria-label={compact ? t("nav.aiImage") : undefined}
        className={cn(
          "flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl py-2 text-rail-foreground transition-colors hover:bg-muted data-popup-open:bg-muted",
          compact && "w-12",
          active && "bg-accent text-primary hover:bg-accent data-popup-open:bg-accent",
        )}
      >
        <WandSparkles className="size-5" strokeWidth={1.75} aria-hidden />
        {!compact && <span className="max-w-full truncate text-[10px] font-semibold">{t("nav.aiImage")}</span>}
      </PopoverTrigger>

      <PopoverContent
        side="inline-end"
        align="start"
        sideOffset={12}
        aria-label={t("nav.aiImage")}
        className="max-h-(--available-height) w-[min(46rem,calc(100vw-6rem))] overflow-y-auto rounded-2xl p-5 font-sans"
      >
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <section aria-labelledby="ai-image-tools">
            <h2 id="ai-image-tools" className="mb-2 px-2 text-xs font-medium text-muted-foreground">
              {t("aiImage.tools")}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {aiImageTools.map(({ key, href, icon: Icon }) => (
                <li key={key}>
                  <Link href={href} onClick={close} className="group flex items-center gap-3 rounded-xl p-2 outline-none hover:bg-muted focus-visible:bg-muted">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/80 group-hover:bg-background group-hover:text-primary">
                      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{t(`aiImage.items.${key}.title`)}</span>
                      <span className="truncate text-xs text-muted-foreground">{t(`aiImage.items.${key}.desc`)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="ai-image-models">
            <h2 id="ai-image-models" className="mb-2 px-2 text-xs font-medium text-muted-foreground">
              {t("aiImage.models")}
            </h2>
            <Models menu={menu} onNavigate={close} />
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Models({ menu, onNavigate }: { menu: ModelMenu | null; onNavigate: () => void }) {
  const t = useTranslations("Shell");
  if (!menu) {
    return (
      <p role="status" className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t("aiImage.loading")}
      </p>
    );
  }
  if (!menu.models.length) {
    return (
      <div className="flex flex-col items-start gap-1 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t("aiImage.noModels")}</span>
        <Link href="/settings/api-keys" onClick={onNavigate} className="font-semibold text-primary hover:underline">
          {t("aiImage.connectKey")}
        </Link>
      </div>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {menu.models.map((entry) => (
          <li key={`${entry.provider}/${entry.model}`}>
            <ModelRow entry={entry} />
          </li>
        ))}
      </ul>
      <p className="mt-3 px-2 text-[11px] text-muted-foreground">
        {menu.canManage ? (
          <Link href="/settings/api-keys" onClick={onNavigate} className="font-semibold text-primary hover:underline">
            {t("aiImage.chooseModels")}
          </Link>
        ) : (
          t("aiImage.adminChooses")
        )}
      </p>
    </>
  );
}

function ModelRow({ entry }: { entry: ImageModelEntry }) {
  const t = useTranslations("Shell");
  return (
    <div className="flex items-center gap-3 rounded-xl p-2" title={entry.model}>
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-base font-bold text-foreground/80">
        {entry.provider === "openai" ? "O" : "G"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold" dir="ltr">
            {entry.name}
          </span>
          {entry.inUse && <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-primary">{t("aiImage.inUse")}</span>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{entry.blurb ? t(`aiImage.blurbs.${entry.blurb}`) : t(`aiImage.providers.${entry.provider}`)}</span>
      </span>
    </div>
  );
}
