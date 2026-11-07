"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import { navItems } from "@/components/app/nav-items";
import { Link } from "@/i18n/navigation";

/** The tools, one tap away: the row of tiles under the Studio prompt and every tool's prompt dock. */
const SHORTCUTS = navItems.filter((item) => !item.soon && !["create", "history", "analytics"].includes(item.key));

export function ToolShortcuts({ current }: { current?: `/${string}` }) {
  const t = useTranslations("Shell");
  const ts = useTranslations("Studio");
  return (
    <nav aria-label={ts("toolsLabel")} className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-full sm:px-0">
      <ul className="mx-auto flex w-max gap-2 sm:gap-3">
        {SHORTCUTS.map(({ key, href, icon: Icon }) => {
          const active = href === current;
          return (
            <li key={key}>
              <Link
                href={href}
                title={t(`tools.${key}`)}
                aria-current={active ? "page" : undefined}
                className="group flex w-18 flex-col items-center gap-1.5 text-center outline-offset-4"
              >
                <span
                  className={cn(
                    "flex size-12 items-center justify-center rounded-xl border bg-background/70 text-foreground/80 shadow-xs transition group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:text-primary",
                    active && "border-primary/50 bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className={cn("line-clamp-1 text-[11px] font-medium text-muted-foreground group-hover:text-foreground", active && "text-foreground")}>{t(`nav.${key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
