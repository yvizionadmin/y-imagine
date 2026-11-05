"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";

/** Single product / Bulk switch at the top of an image tool's panel (same as Copy's). */
export function BulkModeTabs({ tool, mode }: { tool: "/generate" | "/recolor" | "/aplus"; mode: "single" | "bulk" }) {
  const t = useTranslations("ImageBulk");
  return (
    <nav aria-label={t("modeLabel")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {(["single", "bulk"] as const).map((m) => (
        <Link
          key={m}
          href={m === "single" ? tool : `${tool}/bulk`}
          aria-current={m === mode ? "page" : undefined}
          className={cn("rounded-md py-1.5 text-center text-xs font-semibold text-muted-foreground", m === mode && "bg-background text-foreground shadow-sm")}
        >
          {t(`modes.${m}`)}
        </Link>
      ))}
    </nav>
  );
}
