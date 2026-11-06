"use client";

import { Calendar, ChevronDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { GenerationMode, HistoryFilters, PublishStatus } from "../types";

const MODES: GenerationMode[] = ["create", "lifestyle", "recolor", "aplus"];
const STATUSES: PublishStatus[] = ["pending", "uploaded", "failed"];

export type FilterDraft = Pick<HistoryFilters, "sku" | "from" | "to" | "mode" | "status">;

export function HistoryFilterBar({
  draft,
  applied,
  onChange,
  onApply,
  onRemove,
}: {
  draft: FilterDraft;
  applied: FilterDraft;
  onChange: (draft: FilterDraft) => void;
  onApply: () => void;
  onRemove: (keys: (keyof FilterDraft)[]) => void;
}) {
  const t = useTranslations("History");
  const chips: { keys: (keyof FilterDraft)[]; label: string }[] = [];
  if (applied.sku) chips.push({ keys: ["sku"], label: t("chipSku", { value: applied.sku }) });
  if (applied.from || applied.to) chips.push({ keys: ["from", "to"], label: t("chipDate", { from: applied.from ?? "…", to: applied.to ?? "…" }) });
  if (applied.mode) chips.push({ keys: ["mode"], label: t("chipMode", { value: t(`modes.${applied.mode}`) }) });
  if (applied.status) chips.push({ keys: ["status"], label: t("chipStatus", { value: t(`statuses.${applied.status}`) }) });

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <Labeled label={t("skuLabel")} htmlFor="history-sku" className="w-44">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            id="history-sku"
            value={draft.sku ?? ""}
            maxLength={64}
            onChange={(e) => onChange({ ...draft, sku: e.target.value })}
            placeholder={t("skuPlaceholder")}
            className="h-9 w-full rounded-lg border bg-transparent ps-8 pe-2 text-xs outline-none placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </Labeled>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase">{t("dateRange")}</legend>
        <div className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5">
          <Calendar className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <input
            type="date"
            aria-label={t("from")}
            value={draft.from ?? ""}
            max={draft.to || undefined}
            onChange={(e) => onChange({ ...draft, from: e.target.value || undefined })}
            className="bg-transparent text-xs outline-none"
          />
          <span className="text-subtle">–</span>
          <input
            type="date"
            aria-label={t("to")}
            value={draft.to ?? ""}
            min={draft.from || undefined}
            onChange={(e) => onChange({ ...draft, to: e.target.value || undefined })}
            className="bg-transparent text-xs outline-none"
          />
        </div>
      </fieldset>

      <Labeled label={t("modeLabel")} htmlFor="history-mode" className="w-36">
        <Select
          id="history-mode"
          value={draft.mode ?? ""}
          onChange={(value) => onChange({ ...draft, mode: (value || undefined) as GenerationMode | undefined })}
          options={[{ value: "", label: t("all") }, ...MODES.map((m) => ({ value: m, label: t(`modes.${m}`) }))]}
        />
      </Labeled>

      <Labeled label={t("statusLabel")} htmlFor="history-status" className="w-36">
        <Select
          id="history-status"
          value={draft.status ?? ""}
          onChange={(value) => onChange({ ...draft, status: (value || undefined) as PublishStatus | undefined })}
          options={[{ value: "", label: t("all") }, ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))]}
        />
      </Labeled>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 self-center pt-5">
        {chips.map((chip) => (
          <span key={chip.label} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
            {chip.label}
            <button type="button" aria-label={t("removeFilter", { name: chip.label })} onClick={() => onRemove(chip.keys)} className="text-subtle hover:text-foreground">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>

      <Button type="submit" className="h-9 px-5 font-semibold">
        {t("search")}
      </Button>
    </form>
  );
}

function Labeled({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-[10px] font-semibold text-muted-foreground uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Select({
  id,
  value,
  onChange,
  options,
  label,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border bg-background ps-2.5 pe-8 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
    </div>
  );
}
