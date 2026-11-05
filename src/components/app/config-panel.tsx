"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2, Redo, Undo, Wand2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { improvePrompt } from "@/features/prompts/actions";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { LATN } from "@/lib/format";
import { aspectRatios, type AspectRatio, type Resolution } from "@/lib/image-formats";

// Building blocks for the 404px left config panel shared by Generate, Recolor and A+ (Figma Section 1).

export function ConfigPanel({
  onSubmit,
  children,
}: {
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="flex w-config-panel shrink-0 flex-col border-e bg-background"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function PanelHeader({ title }: { title: string }) {
  const t = useTranslations("Workspace");
  const router = useRouter();
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" aria-label={t("back")} onClick={() => router.back()} className="text-foreground">
          <ArrowLeft className="size-[18px] rtl:-scale-x-100" aria-hidden />
        </button>
        <h1 className="truncate text-[13px] font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <button type="button" aria-label={t("undo")} disabled className="disabled:opacity-50">
          <Undo className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label={t("redo")} disabled className="disabled:opacity-50">
          <Redo className="size-4" aria-hidden />
        </button>
        <span className="h-4 w-px bg-border" />
        <span className="flex items-center gap-1 font-mono text-xs font-semibold">
          {t("fit")}
          <ChevronDown className="size-3" aria-hidden />
        </span>
      </div>
    </div>
  );
}

export function PanelBody({ disabled, children }: { disabled?: boolean; children: ReactNode }) {
  return (
    // min-w-0: a fieldset defaults to min-content width, so one long file name would widen the whole panel.
    <fieldset disabled={disabled} className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      {children}
    </fieldset>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RequiredTag() {
  const t = useTranslations("Workspace");
  return <span className="text-[11px] font-semibold text-primary">{t("required")}</span>;
}

export function OptionalTag() {
  const t = useTranslations("Workspace");
  return <span className="text-[10px] text-subtle">{t("optional")}</span>;
}

export function ReadyTag() {
  const t = useTranslations("Workspace");
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      {t("ready")}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  gap = "gap-1",
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  gap?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", gap, className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FormatFields({
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
}: {
  aspectRatio: AspectRatio;
  onAspectRatioChange: (value: AspectRatio) => void;
  resolution: Resolution;
  onResolutionChange: (value: Resolution) => void;
}) {
  const t = useTranslations("Workspace");
  return (
    <>
      <Field label={t("aspectRatio")} gap="gap-1.5">
        <div role="radiogroup" aria-label={t("aspectRatio")} className="flex flex-wrap gap-1.5">
          {aspectRatios.map((ratio) => {
            const selected = aspectRatio === ratio.key;
            return (
              <button
                key={ratio.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onAspectRatioChange(ratio.key)}
                className={cn(
                  "flex size-12 flex-col items-center justify-center gap-1 rounded-lg border text-[9px] font-semibold text-subtle",
                  selected && "border-primary bg-accent text-primary",
                )}
              >
                <span
                  style={{ width: ratio.w, height: ratio.h }}
                  className={cn("rounded-[1px] border-[1.5px] border-muted-foreground", selected && "border-primary")}
                />
                <span dir="ltr">{ratio.key}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="flex gap-3">
        <Field label={t("resolution")} className="flex-1">
          <div role="radiogroup" aria-label={t("resolution")} className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {(["HD", "2K"] as const).map((res) => {
              const selected = resolution === res;
              return (
                <button
                  key={res}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onResolutionChange(res)}
                  className={cn(
                    "flex-1 rounded px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground",
                    selected && "bg-background text-foreground shadow-xs",
                  )}
                >
                  {res}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t("targetSize")} className="flex-1">
          <div className="rounded-md bg-muted px-2 py-1.5 text-center font-mono text-[11px]">{t("autoDetect")}</div>
        </Field>
      </div>
    </>
  );
}

/**
 * "Improve with AI": rewrites the instruction box through the org's text model (free, not a job).
 * The previous text stays one click away (Undo) until the merchant edits the box again.
 */
export function ImproveWithAiButton({ value, onChange, request }: { value: string; onChange: (value: string) => void; request: Omit<Parameters<typeof improvePrompt>[0], "text" | "language"> }) {
  const t = useTranslations("Workspace");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<{ before: string; after: string } | null>(null);
  // Undo only while the box still holds the rewrite.
  const canUndo = previous !== null && previous.after === value;

  async function improve() {
    setBusy(true);
    setError(null);
    const result = await improvePrompt({ ...request, text: value, language: locale === "ar" ? "ar" : "en" }).catch(() => ({ ok: false as const, error: "generation_failed" as const }));
    setBusy(false);
    if (!result.ok) return setError(IMPROVE_ERRORS.includes(result.error) ? result.error : "generation_failed");
    setPrevious({ before: value, after: result.text });
    onChange(result.text);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {error && (
        <span role="alert" className="truncate text-[11px] text-danger">
          {t(`improveErrors.${error}`)}
        </span>
      )}
      {canUndo && !busy && (
        <button type="button" onClick={() => (onChange(previous.before), setPrevious(null))} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">
          {t("undo")}
        </button>
      )}
      <button type="button" onClick={improve} disabled={busy} aria-busy={busy} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-50">
        {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Wand2 className="size-3" aria-hidden />}
        {busy ? t("improving") : t("improveWithAi")}
      </button>
    </div>
  );
}

const IMPROVE_ERRORS: string[] = ["no_provider", "invalid_key", "no_credits", "rate_limited", "generation_failed"];

export function PanelFooter({
  cost,
  submitLabel,
  canSubmit,
  busy,
  onReset,
}: {
  cost: number;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onReset: () => void;
}) {
  const t = useTranslations("Workspace");
  const format = useFormatter();
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{t("estimatedCost")}</span>
        <span className="font-mono text-xs font-bold">
          {t("cost", { count: cost, display: format.number(cost, LATN) })}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onReset}
          className="h-auto px-4 py-3 text-[13px] font-semibold text-muted-foreground"
        >
          {t("reset")}
        </Button>
        <Button type="submit" disabled={!canSubmit || busy} className="h-auto flex-1 px-4 py-3 text-[13px] font-bold">
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
