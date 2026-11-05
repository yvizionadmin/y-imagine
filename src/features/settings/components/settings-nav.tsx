"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Link, usePathname } from "@/i18n/navigation";

// Matches the settings sub-menu in Figma team-settings (30:430). Items without a page yet are
// shown disabled rather than linking to a 404.
const items = [
  { key: "general", href: null },
  { key: "team", href: "/settings/team" },
  { key: "roles", href: null },
  { key: "apiKeys", href: "/settings/api-keys" },
  { key: "brandKit", href: "/settings/brand" },
  { key: "billing", href: "/settings/billing" },
  { key: "integrations", href: "/settings/integrations" },
] as const;

export function SettingsNav() {
  const t = useTranslations("Settings");
  const pathname = usePathname();

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-1 border-e bg-background p-4" aria-label={t("title")}>
      <h1 className="px-3 pb-3 text-base font-bold">{t("title")}</h1>
      {items.map(({ key, href }) =>
        href ? (
          <Link
            key={key}
            href={href}
            aria-current={pathname.startsWith(href) ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted",
              pathname.startsWith(href) && "bg-accent font-semibold text-primary hover:bg-accent",
            )}
          >
            {t(`nav.${key}`)}
          </Link>
        ) : (
          <span key={key} aria-disabled className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium text-subtle">
            {t(`nav.${key}`)}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{t("soon")}</span>
          </span>
        ),
      )}
    </nav>
  );
}
