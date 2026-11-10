"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";
import type { LookView } from "../actions";
import { lookCategories, ROOM_TYPES } from "../config";
import { LookMenu, type LookMenuActions } from "./look-menu";
import { useLooks } from "./use-looks";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

/** Mood Boards: looks promoted to boards (Figma 98:9358). Each card opens the board detail. */
export function LooksGallery() {
  const t = useTranslations("Looks");
  const tp = useTranslations("Presets");
  const { looks, canEdit, error, actions } = useLooks();
  const [query, setQuery] = useState("");
  const [room, setRoom] = useState<string | null>(null);
  const [category, setCategory] = useState("");

  const source = (looks ?? []).filter((l) => l.isBoard);
  const rooms = ROOM_TYPES.filter((r) => source.some((l) => l.roomType === r));
  const categories = lookCategories(source);
  const visible = source
    .filter((l) => !room || l.roomType === room)
    .filter((l) => !category || l.category === category)
    .filter((l) => !query.trim() || l.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{t("boardsTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t("boardsSubtitle")}</p>
        </div>
        <Link href="/looks" className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90">
          {t("newBoard")}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchLooks")} aria-label={t("searchLooks")}
            className="h-8 w-full rounded-lg border bg-background ps-8 pe-2 text-xs outline-none focus-visible:border-ring" />
        </div>
        {[null, ...rooms].map((r) => (
          <button key={r ?? "all"} type="button" aria-pressed={room === r} onClick={() => setRoom(r)}
            className={cn("rounded-full border bg-background px-3 py-1 text-[11px] font-medium", room === r && "border-primary text-primary")}>
            {r ? t(`rooms.${r}`) : t("all")}
          </button>
        ))}
        {categories.length > 1 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("categoryFilter")}
            className="h-8 rounded-lg border bg-background px-2.5 text-[11px] font-medium outline-none focus-visible:border-ring">
            <option value="">{t("allCategories")}</option>
            {categories.map((key) => <option key={key} value={key}>{tp(`categories.${key}`)}</option>)}
          </select>
        )}
        <span className="ms-auto rounded-lg border bg-background px-3 py-1.5 text-[11px] font-medium">{t("sortRecent")}</span>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">{error}</p>}

      {!looks ? (
        <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-background px-6 py-16 text-center">
          <h2 className="text-base font-bold">{t("noBoards")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("noBoardsBody")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {visible.map((look) => (
            <LookCard key={look.id} look={look} canEdit={canEdit} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

// Rendered only after looks load, so reading the current time never happens during prerender.
function LookCard({ look, canEdit, actions }: { look: LookView; canEdit: boolean; actions: LookMenuActions }) {
  const t = useTranslations("Looks");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (
    <article className="relative flex flex-col overflow-hidden rounded-xl border bg-background transition-shadow hover:shadow-md">
      <Link href={`/looks/boards/${look.id}`} className="flex flex-col">
        {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
        <img src={thumbnailUrl(look.imageUrl, 640)} alt={look.title} loading="lazy" className="aspect-[16/10] w-full object-cover" />
        <div className="flex flex-col gap-2 p-3">
          <h2 className="truncate text-sm font-bold">{look.title}</h2>
          <div className="flex flex-wrap gap-1.5">
            {look.roomType && <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">{t(`rooms.${look.roomType}` as "rooms.livingRoom")}</span>}
            {look.style && <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold">{t(`styles.${look.style}` as "styles.luxury")}</span>}
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-[11px]">
            <span className="font-semibold">{t("products", { count: look.items.length })}</span>
            <span className="text-muted-foreground">{format.relativeTime(new Date(look.updatedAt), now)}</span>
          </div>
        </div>
      </Link>
      <LookMenu look={look} canEdit={canEdit} actions={actions} className="absolute end-2 top-2 bg-black/55 text-white hover:bg-black/70" />
    </article>
  );
}
