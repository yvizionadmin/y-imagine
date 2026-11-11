"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { DESTINATIONS, DESTINATION_GROUPS as GROUPS, matchDestinations, searchAdminItems } from "./nav-items";

/** Top-bar search (⌘K / Ctrl+K): jump to any tool or settings page. */
export function CommandMenu({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useTranslations("Shell.search");
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = useMemo(
    () =>
      [...DESTINATIONS, ...(isSuperAdmin ? searchAdminItems : [])].map((d) => ({
        ...d,
        label: t(`items.${d.key}.title`),
        hint: t(`items.${d.key}.hint`),
      })),
    [isSuperAdmin, t],
  );
  const results = matchDestinations(all, query);
  const current = Math.min(active, Math.max(results.length - 1, 0));

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  }

  function go(href: `/${string}`) {
    change(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter" && results[current]) {
      e.preventDefault();
      go(results[current].href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => change(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 w-64 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-topbar-foreground/80 hover:bg-white/15 max-lg:w-44 max-md:w-9 max-md:justify-center max-md:px-0"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate max-md:sr-only">{t("button")}</span>
        <kbd aria-hidden className="ms-auto rounded border border-white/20 px-1.5 font-sans text-[10px] max-md:hidden" dir="ltr">
          ⌘K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent showCloseButton={false} className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 p-0 font-sans sm:max-w-lg">
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[current] ? `${listId}-${results[current].key}` : undefined}
              aria-label={t("title")}
              placeholder={t("placeholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              dir="auto"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={listId} role="listbox" aria-label={t("title")} className="max-h-[60vh] overflow-y-auto p-2">
            {results.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>}
            {GROUPS.map((group) => {
              const items = results.filter((r) => r.group === group);
              if (!items.length) return null;
              return (
                <div key={group} role="group" aria-label={t(`groups.${group}`)} className="flex flex-col pb-1">
                  <span className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">{t(`groups.${group}`)}</span>
                  {items.map((item) => {
                    const selected = results[current]?.key === item.key;
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.key}
                        id={`${listId}-${item.key}`}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setActive(results.indexOf(item))}
                        onClick={() => go(item.href)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", selected && "bg-muted")}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{item.label}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{item.hint}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
