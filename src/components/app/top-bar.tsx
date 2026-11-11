"use client";

import { Suspense } from "react";
import { Coins, Wand } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import type { Workspace } from "@/lib/workspace";
import { CommandMenu } from "./command-menu";
import { JobsTray } from "./jobs-tray";
import { activeTool } from "./nav-items";
import { UserMenu } from "./user-menu";

export function TopBar({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("Shell");
  const format = useFormatter();
  const { user, creditsRemaining } = workspace;
  // Billing changes are admin-only; nothing to upgrade to from Pro or Enterprise, or while viewing an org.
  const canUpgrade = workspace.role === "admin" && !workspace.viewAs && (workspace.plan === "free" || workspace.plan === "starter");

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
        <CommandMenu isSuperAdmin={workspace.isSuperAdmin} />
        <div className="flex items-center gap-1.5 rounded-full border border-credits-border bg-credits py-1 ps-3 pe-1 text-xs leading-4 font-medium whitespace-nowrap text-credits-foreground max-md:ps-2">
          <Coins className="size-3.5" aria-hidden />
          <span>{t("credits", { count: format.number(creditsRemaining, LATN) })}</span>
          {canUpgrade ? (
            <Link href="/settings/billing" className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 max-md:hidden">
              {t("upgrade")}
            </Link>
          ) : (
            <span className="w-2" aria-hidden />
          )}
        </div>
        <Suspense fallback={<span className="size-9" />}>
          <JobsTray />
        </Suspense>
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
