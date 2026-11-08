"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Link, usePathname } from "@/i18n/navigation";

const tabs = [
  { key: "builder", href: "/looks" },
  { key: "boards", href: "/looks/boards" },
  { key: "history", href: "/looks/history" },
  { key: "backgrounds", href: "/looks/backgrounds" },
] as const;

// Suspends on /looks/boards/[id] (unknown dynamic param), so prerender without an active tab.
export function LooksTabs() {
  return (
    <Suspense fallback={<Tabs pathname={null} />}>
      <RoutedTabs />
    </Suspense>
  );
}

function RoutedTabs() {
  return <Tabs pathname={usePathname()} />;
}

function Tabs({ pathname }: { pathname: string | null }) {
  const t = useTranslations("Looks");
  return (
    <nav className="flex shrink-0 gap-2 overflow-x-auto border-b bg-background px-6 py-2.5 max-md:px-3" aria-label={t("title")}>
      {tabs.map(({ key, href }) => {
        const active = href === "/looks" ? pathname === "/looks" : Boolean(pathname?.startsWith(href));
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-4 py-1.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:bg-muted",
              active && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
            )}
          >
            {t(`tabs.${key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
