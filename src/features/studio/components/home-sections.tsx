"use client";

import { useEffect, useState } from "react";
import NextImage from "next/image";
import { Bot, Clapperboard, Crop, Layers, Link2, MessageSquare, PenLine, QrCode, Star, type LucideIcon } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Link } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { listContinueItems } from "../actions";
import type { ContinueItem } from "../types";

type ToolCard = { key: string; href: `/${string}`; picture?: string; icon?: LucideIcon };

/** Home's tools as cards: a picture for the image tools, an icon for the rest. Names come from the ⌘K search. */
const TOOL_CARDS: ToolCard[] = [
  { key: "generate", href: "/generate", picture: "/demo/lifestyle-living-room.png" },
  { key: "recolor", href: "/recolor", picture: "/demo/sofa-grey-base.png" },
  { key: "aplus", href: "/aplus", picture: "/demo/source-chair.png" },
  { key: "looks", href: "/looks", icon: Star },
  { key: "director", href: "/editor/director", icon: Clapperboard },
  { key: "editor", href: "/editor", icon: Clapperboard },
  { key: "copy", href: "/copy", icon: PenLine },
  { key: "chat", href: "/chat", icon: MessageSquare },
  { key: "agents", href: "/agents", icon: Bot },
  { key: "resize", href: "/resize", icon: Crop },
  { key: "qr", href: "/qr", icon: QrCode },
  { key: "links", href: "/links", icon: Link2 },
];

export function ToolCards() {
  const t = useTranslations("Studio");
  const ts = useTranslations("Shell.search.items");
  return (
    <section aria-labelledby="studio-tools" className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-8">
      <h2 id="studio-tools" className="mb-3 text-sm font-bold">
        {t("toolsLabel")}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {TOOL_CARDS.map(({ key, href, picture, icon: Icon }) => (
          <li key={key}>
            <Link href={href} className="group flex flex-col gap-2 outline-offset-4">
              <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border bg-muted/60 transition group-hover:border-primary/50">
                {picture ? (
                  <NextImage src={picture} alt="" fill sizes="(min-width: 1280px) 180px, (min-width: 640px) 33vw, 50vw" className="object-cover transition duration-300 group-hover:scale-105" />
                ) : (
                  Icon && <Icon className="size-8 text-primary/80 transition group-hover:scale-110" strokeWidth={1.5} aria-hidden />
                )}
              </span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold group-hover:text-primary">{ts(`${key}.title`)}</span>
                <span className="line-clamp-1 text-[11px] text-muted-foreground">{ts(`${key}.hint`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_ICON: Record<ContinueItem["kind"], LucideIcon> = {
  director: Clapperboard,
  editor: Clapperboard,
  generateBulk: Layers,
  recolorBulk: Layers,
  aplusBulk: Layers,
  copyBulk: PenLine,
};

const STATE_CLASS: Record<ContinueItem["state"], string> = {
  working: "bg-primary",
  done: "bg-emerald-500",
  failed: "bg-danger",
  draft: "bg-muted-foreground",
};

/** The org's latest projects and bulk runs, to pick up where someone left off. Hidden when there are none. */
export function ContinueRow() {
  const t = useTranslations("Studio.continue");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [items, setItems] = useState<ContinueItem[] | null>(null);

  useEffect(() => {
    void listContinueItems().then(setItems);
  }, []);

  if (!items?.length) return null;
  return (
    <section aria-labelledby="studio-continue" className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-8">
      <h2 id="studio-continue" className="mb-3 text-sm font-bold">
        {t("title")}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link href={item.href} className="flex items-center gap-3 rounded-xl border bg-background p-2.5 hover:border-primary/50">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span dir="auto" className="truncate text-start text-[13px] font-semibold">
                    {item.title}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                    <span className={cn("size-1.5 shrink-0 rounded-full", STATE_CLASS[item.state])} aria-hidden />
                    {t(`kinds.${item.kind}`)} ·{" "}
                    {item.progress && item.state === "working"
                      ? t("progress", { done: format.number(item.progress.done, LATN), total: format.number(item.progress.total, LATN) })
                      : t(`states.${item.state}`)}{" "}
                    · {format.relativeTime(new Date(Math.min(Date.parse(item.at), now.getTime())), now)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
