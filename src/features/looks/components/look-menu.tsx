"use client";

import { MoreVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "@/i18n/navigation";
import type { LookMode } from "@/lib/looks/looks";
import type { LookView } from "../actions";

export function LookModeBadge({ mode }: { mode: LookMode }) {
  const t = useTranslations("Looks");
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2.5 py-1 text-[11px] font-medium",
        mode === "regenerated" ? "border-primary/40 bg-accent text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {t(`modes.${mode}`)}
    </span>
  );
}

export type LookMenuActions = {
  onDetails?: (look: LookView) => void;
  onToggleBoard: (look: LookView) => void;
  onDelete: (look: LookView) => void;
};

/** Row/card actions for a saved look. Mutating items are hidden for viewers. */
export function LookMenu({ look, canEdit, actions, className }: { look: LookView; canEdit: boolean; actions: LookMenuActions; className?: string }) {
  const t = useTranslations("Looks");
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("rowActions", { title: look.title })}
        onClick={(e) => e.stopPropagation()}
        className={cn("flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted", className)}
      >
        <MoreVertical className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 font-sans">
        {actions.onDetails && <DropdownMenuItem onClick={() => actions.onDetails!(look)}>{t("viewDetails")}</DropdownMenuItem>}
        {look.isBoard && <DropdownMenuItem onClick={() => router.push(`/looks/boards/${look.id}`)}>{t("openBoard")}</DropdownMenuItem>}
        {canEdit && (
          <>
            <DropdownMenuItem onClick={() => router.push({ pathname: "/looks", query: { look: look.id } })}>{t("openBuilder")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onToggleBoard(look)}>
              {look.isBoard ? t("removeFromBoards") : t("addToBoards")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(look)}>
              {t("delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
