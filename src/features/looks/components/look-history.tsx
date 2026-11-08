"use client";

import { blockedReason } from "@/components/app/job-errors";
import { useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LATN } from "@/lib/format";
import type { LookMode } from "@/lib/looks/looks";
import { regenerateLook, type LookView } from "../actions";
import { LookDrawer } from "./look-drawer";
import { LookMenu, LookModeBadge, type LookMenuActions } from "./look-menu";
import { useLooks } from "./use-looks";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";

const DAY = 24 * 60 * 60 * 1000;
const DATE_RANGES = { all: null, last7: 7, last30: 30 } as const;
type DateRange = keyof typeof DATE_RANGES;

/** Look History table (Figma 98:9865) with the Look Details drawer (98:10207). */
export function LooksHistory() {
  const t = useTranslations("Looks");
  const tw = useTranslations("Workspace");
  const { looks, canEdit, error, setError, replace, actions } = useLooks();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<LookMode | "all">("all");
  const [range, setRange] = useState<DateRange>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const open = looks?.find((l) => l.id === openId) ?? null;

  async function regenerate(look: LookView) {
    setDrawerError(null);
    setRegenerating(true);
    const response = await regenerateLook(look.id);
    setRegenerating(false);
    if (response.ok) replace(response.look);
    else {
      const blocked = blockedReason(response.error);
      setDrawerError(blocked ? tw(`blocked.${blocked}.body`) : t(response.error === "forbidden" ? "forbidden" : response.error === "not_found" ? "notFound" : "failed"));
    }
  }

  const menuActions: LookMenuActions = {
    ...actions,
    onDetails: (look) => {
      setDrawerError(null);
      setOpenId(look.id);
    },
  };

  return (
    <div className="flex w-full flex-col gap-5 px-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex max-w-[500px] flex-col gap-1">
          <h1 className="text-2xl font-extrabold">{t("historyTitle")}</h1>
          <p className="text-[13px] text-muted-foreground">{t("historySubtitle")}</p>
        </div>
        <Button disabled={!looks?.length} onClick={() => looks && exportJson(looks)} className="h-10 px-5 text-[13px] font-semibold">
          <Download aria-hidden />
          {t("exportJson")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[300px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchHistory")} aria-label={t("searchHistory")}
            className="h-8 w-full rounded-lg border bg-background ps-8 pe-2 text-xs outline-none focus-visible:border-ring" />
        </div>
        <div className="ms-auto flex gap-2">
          <FilterSelect label={t("modeFilter")} value={mode} onChange={(v) => setMode(v as LookMode | "all")}
            options={[{ value: "all", label: t("all") }, { value: "generated", label: t("modes.generated") }, { value: "regenerated", label: t("modes.regenerated") }]} />
          <FilterSelect label={t("dateFilter")} value={range} onChange={(v) => setRange(v as DateRange)}
            options={[{ value: "all", label: t("allTime") }, { value: "last7", label: t("last7") }, { value: "last30", label: t("last30") }]} />
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">{error}</p>}

      {!looks ? (
        <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : looks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-background px-6 py-16 text-center">
          <h2 className="text-base font-bold">{t("noHistory")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("noHistoryBody")}</p>
        </div>
      ) : (
        <HistoryTable looks={looks} query={query} mode={mode} range={range} canEdit={canEdit} actions={menuActions} />
      )}

      <LookDrawer
        look={open}
        canEdit={canEdit}
        regenerating={regenerating}
        error={drawerError}
        onClose={() => {
          setOpenId(null);
          setError(null);
        }}
        onRegenerate={regenerate}
      />
    </div>
  );
}

// Rendered only after looks load, so reading the current time never happens during prerender.
function HistoryTable({
  looks,
  query,
  mode,
  range,
  canEdit,
  actions,
}: {
  looks: LookView[];
  query: string;
  mode: LookMode | "all";
  range: DateRange;
  canEdit: boolean;
  actions: LookMenuActions;
}) {
  const t = useTranslations("Looks");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const days = DATE_RANGES[range];
  const q = query.trim().toLowerCase();

  const rows = looks
    .filter((l) => mode === "all" || l.mode === mode)
    .filter((l) => days === null || now.getTime() - new Date(l.createdAt).getTime() <= days * DAY)
    .filter((l) => !q || l.title.toLowerCase().includes(q) || l.items.some((i) => i.sku.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns = ["thumb", "title", "sku", "room", "style", "products", "mode", "status", "created", "actions"] as const;

  return (
    <div className="overflow-x-auto rounded-xl border bg-background">
      <table className="w-full min-w-[960px] text-[13px]">
        <thead className="bg-muted/60 text-[11px] font-bold text-muted-foreground uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={c === "products" ? "px-3 py-3.5 text-center" : c === "actions" ? "px-6 py-3.5 text-end" : "px-3 py-3.5 text-start first:ps-6"}>
                {t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-6 py-12 text-center text-muted-foreground">{t("noMatches")}</td>
            </tr>
          )}
          {rows.map((look) => (
            <tr key={look.id} onClick={() => actions.onDetails?.(look)} className="cursor-pointer border-t font-medium text-muted-foreground even:bg-muted/40 hover:bg-accent/50">
              <td className="py-3 ps-6 pe-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
                <img src={thumbnailUrl(look.imageUrl, 96)} alt="" loading="lazy" className="size-10 rounded-md bg-muted object-cover" />
              </td>
              <td className="max-w-[240px] px-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onDetails?.(look);
                  }}
                  className="block max-w-full truncate text-start font-bold text-foreground hover:text-primary"
                >
                  {look.title}
                </button>
              </td>
              <td className="px-3 whitespace-nowrap" dir="ltr">
                {look.items[0]?.sku}
                {look.items.length > 1 && <span className="text-subtle">{` +${look.items.length - 1}`}</span>}
              </td>
              <td className="px-3 whitespace-nowrap">{look.roomType ? t(`rooms.${look.roomType}` as "rooms.livingRoom") : "—"}</td>
              <td className="px-3 whitespace-nowrap">{look.style ? t(`styles.${look.style}` as "styles.luxury") : "—"}</td>
              <td className="px-3 text-center font-semibold text-foreground">{format.number(look.items.length, LATN)}</td>
              <td className="px-3">
                <LookModeBadge mode={look.mode} />
              </td>
              <td className="px-3">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{t("statusGenerated")}</span>
              </td>
              <td className="px-3 whitespace-nowrap">{format.dateTime(new Date(look.createdAt), { dateStyle: "medium", numberingSystem: "latn" })}</td>
              <td className="py-3 ps-3 pe-6 text-end" onClick={(e) => e.stopPropagation()}>
                <LookMenu look={look} canEdit={canEdit} actions={actions} className="ms-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-background ps-3 pe-2 text-[11px] text-muted-foreground">
      {label}:
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent font-semibold text-foreground outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Download look metadata (no images) as JSON. */
function exportJson(looks: LookView[]) {
  const data = looks.map(({ id, title, prompt, style, roomType, aspectRatio, mode, isBoard, createdBy, createdAt, updatedAt, items }) => ({
    id, title, prompt, style, roomType, aspectRatio, mode, isBoard, createdBy, createdAt, updatedAt,
    products: items.map(({ sku, name, category, x, y, w, h, hidden }) => ({ sku, name, category, x, y, w, h, hidden })),
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `looks_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
