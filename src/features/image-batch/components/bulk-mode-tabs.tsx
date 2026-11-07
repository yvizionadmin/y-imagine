"use client";

import { useTranslations } from "next-intl";
import { Layers, Package } from "lucide-react";
import { DockToolbar, MODE_SWITCH, modeSwitchItem } from "@/components/app/config-panel";
import { Link } from "@/i18n/navigation";

/** Single product / Bulk switch in an image tool's prompt dock (same as Copy's). */
export function BulkModeTabs({ tool, mode }: { tool: "/generate" | "/recolor" | "/aplus"; mode: "single" | "bulk" }) {
  const t = useTranslations("ImageBulk");
  return (
    <DockToolbar>
      <nav aria-label={t("modeLabel")} className={MODE_SWITCH}>
        {(["single", "bulk"] as const).map((m) => (
          <Link
            key={m}
            href={m === "single" ? tool : `${tool}/bulk`}
            aria-current={m === mode ? "page" : undefined}
            className={modeSwitchItem(m === mode)}
          >
            {m === "single" ? <Package className="size-4" aria-hidden /> : <Layers className="size-4" aria-hidden />}
            {t(`modes.${m}`)}
          </Link>
        ))}
      </nav>
    </DockToolbar>
  );
}
