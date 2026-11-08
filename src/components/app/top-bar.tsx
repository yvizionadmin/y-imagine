"use client";

import { Suspense } from "react";
import { Bell, Coins, Wand } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import type { Workspace } from "@/lib/workspace";
import { activeTool } from "./nav-items";
import { UserMenu } from "./user-menu";

export function TopBar({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("Shell");
  const format = useFormatter();
  const { user, creditsRemaining } = workspace;

  return (
    <header className="flex h-topbar shrink-0 items-center gap-6 bg-topbar px-[27px] font-ui text-topbar-foreground max-md:gap-2 max-md:px-3">
      <Link href="/" className="text-xl font-bold tracking-tight whitespace-nowrap max-md:text-base">
        {t("brand")}
      </Link>

      {/* usePathname suspends on routes with unknown dynamic params (Cache Components). */}
      <Suspense>
        <ToolBadge />
      </Suspense>

      <div className="ms-auto flex items-center gap-3 max-md:gap-1">
        <div className="flex items-center gap-1.5 rounded-full border border-credits-border bg-credits px-3 py-1.5 text-xs leading-4 font-medium whitespace-nowrap text-credits-foreground max-md:px-2">
          <Coins className="size-3.5" aria-hidden />
          {t("credits", { count: format.number(creditsRemaining, LATN) })}
        </div>
        <button
          type="button"
          aria-label={t("notifications")}
          className="flex size-9 items-center justify-center rounded-full hover:bg-white/10"
        >
          <Bell className="size-4" aria-hidden />
        </button>
        <UserMenu
          user={user}
          isSuperAdmin={workspace.isSuperAdmin}
          org={{ id: workspace.orgId, name: workspace.orgName, all: workspace.orgs }}
        />
      </div>
    </header>
  );
}

function ToolBadge() {
  const t = useTranslations("Shell");
  const tool = activeTool(usePathname());
  if (!tool) return null;
  // Phones: the rail already marks the tool, and the bar needs the room for the account menu.
  return (
    <div className="flex items-center gap-2 rounded-[20px] bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-accent-foreground max-md:hidden">
      <Wand className="size-3.5" aria-hidden />
      {t(`tools.${tool.key}`)}
    </div>
  );
}
