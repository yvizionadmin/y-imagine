"use client";

import { Suspense, useState } from "react";
import { Ellipsis, PanelLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AiImageRailItem } from "./ai-image-menu";
import { activeTool, adminItems, AI_IMAGE_KEYS, moreItems, railItems, type ToolKey } from "./nav-items";
import { startNewJob } from "./new-job";

type RailProps = { isSuperAdmin: boolean };

// usePathname suspends on routes with unknown dynamic params (Cache Components), so the rail
// prerenders without an active item and highlights it once the pathname resolves.
export function IconRail(props: RailProps) {
  return (
    <Suspense fallback={<Rail activeKey={null} {...props} />}>
      <RoutedRail {...props} />
    </Suspense>
  );
}

function RoutedRail(props: RailProps) {
  return <Rail activeKey={activeTool(usePathname())?.key ?? null} {...props} />;
}

function Rail({ activeKey, isSuperAdmin }: { activeKey: string | null } & RailProps) {
  const t = useTranslations("Shell");
  const [compact, setCompact] = useState(false);

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col items-center gap-3 overflow-y-auto border-e bg-background pt-4 font-ui transition-[width] [scrollbar-width:none]",
        compact ? "w-14" : "w-rail",
      )}
    >
      <button
        type="button"
        aria-label={t("toggleNav")}
        aria-pressed={compact}
        onClick={() => setCompact((c) => !c)}
        className="flex size-9 items-center justify-center rounded-xl text-rail-foreground hover:bg-muted"
      >
        <PanelLeft className="size-6 rtl:-scale-x-100" strokeWidth={1.5} aria-hidden />
      </button>

      <Link href="/templates" onNavigate={startNewJob} className="flex flex-col items-center gap-0.5 pb-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.25),0_4px_4px_rgba(21,30,130,0.07)]">
          <Plus className="size-5" aria-hidden />
        </span>
        {!compact && (
          <span className="text-[11px] leading-4 font-medium tracking-[0.11px] text-primary">
            {t("nav.newJob")}
          </span>
        )}
      </Link>

      {railItems.map(({ key, href, icon: Icon, soon }) => {
        if (key === "generate") return <AiImageRailItem key={key} compact={compact} active={AI_IMAGE_KEYS.includes(activeKey as ToolKey)} />;
        const isActive = activeKey === key;
        if (soon) {
          return (
            <span
              key={key}
              aria-disabled
              title={t("soonHint", { tool: t(`nav.${key}`) })}
              className={cn("flex w-16 cursor-default flex-col items-center gap-1 rounded-xl py-2 text-subtle", compact && "w-12")}
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden />
              {!compact && (
                <span className="flex max-w-full flex-col items-center gap-0.5">
                  <span className="max-w-full truncate text-[10px] font-semibold">{t(`nav.${key}`)}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold">{t("soon")}</span>
                </span>
              )}
              {compact && <span className="sr-only">{t("soonHint", { tool: t(`nav.${key}`) })}</span>}
            </span>
          );
        }
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            aria-label={compact ? t(`nav.${key}`) : undefined}
            className={cn(
              "flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-rail-foreground transition-colors hover:bg-muted",
              compact && "w-12",
              isActive && "bg-accent text-primary hover:bg-accent",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
            {!compact && (
              <span className="max-w-full truncate text-[10px] font-semibold">
                {t(`nav.${key}`)}
              </span>
            )}
          </Link>
        );
      })}

      <MoreMenu compact={compact} isSuperAdmin={isSuperAdmin} />
    </nav>
  );
}

/** Overflow at the foot of the rail: settings pages and, for super admins, the admin console. */
function MoreMenu({ compact, isSuperAdmin }: { compact: boolean } & RailProps) {
  const t = useTranslations("Shell");
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={compact ? t("nav.more") : undefined}
        className={cn(
          "mt-auto mb-4 flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl py-2 text-rail-foreground transition-colors hover:bg-muted data-popup-open:bg-muted",
          compact && "w-12",
        )}
      >
        <Ellipsis className="size-5" strokeWidth={1.75} aria-hidden />
        {!compact && <span className="text-[10px] font-semibold">{t("nav.more")}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="inline-end" align="end" sideOffset={8} className="w-56 font-sans">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("more.workspace")}</DropdownMenuLabel>
          {moreItems.map(({ key, href, icon: Icon }) => (
            <DropdownMenuItem key={key} onClick={() => router.push(href)}>
              <Icon aria-hidden />
              {t(`more.${key}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("more.admin")}</DropdownMenuLabel>
              {adminItems.map(({ key, href, icon: Icon }) => (
                <DropdownMenuItem key={key} onClick={() => router.push(href)}>
                  <Icon aria-hidden />
                  {t(`more.${key}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
