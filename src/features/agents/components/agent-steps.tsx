"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2, PenLine, Search, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "cn";
import { blockedReason } from "@/components/app/job-errors";
import { ImageViewer, type ViewerImage } from "@/components/app/image-viewer";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import type { AgentStep } from "@/lib/agent/limits";

type ToolStep = Extract<AgentStep, { kind: "tool" }>;

const ICONS = { search_catalog: Search, write_copy: PenLine, generate_image: WandSparkles } as const;
const TOOL_ERRORS = ["no_connection", "catalog_error", "sku_not_found", "no_image", "limit", "invalid_input", "stopped", "rate_limited"] as const;

/** The steps of a run in order: the agent's words, and a card per tool call. */
export function AgentSteps({ steps, working }: { steps: AgentStep[]; working: boolean }) {
  const t = useTranslations("Agents");
  const [viewing, setViewing] = useState<ViewerImage | null>(null);
  const lastIsTool = steps.at(-1)?.kind !== "text";
  return (
    <>
      <ol className="flex flex-col gap-3" aria-label={t("steps")}>
        {steps.map((step) =>
          step.kind === "text" ? (
            <li key={step.id} dir="auto" className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {step.text.trim()}
            </li>
          ) : (
            <ToolCard key={step.id} step={step} onView={setViewing} />
          ),
        )}
        {working && lastIsTool && !steps.some((s) => s.kind === "tool" && s.status === "running") && (
          <li className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("thinking")}
          </li>
        )}
      </ol>
      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function ToolCard({ step, onView }: { step: ToolStep; onView: (image: ViewerImage) => void }) {
  const t = useTranslations("Agents");
  const tw = useTranslations("Workspace");
  const Icon = ICONS[step.tool];
  const output = step.output;
  const title =
    step.status === "running"
      ? t(`tools.${step.tool}.running`, { label: step.label })
      : t(`tools.${step.tool}.${step.status === "ok" ? "done" : "failed"}`, { label: step.label });

  let error: string | null = null;
  if (step.status === "failed") {
    const blocked = blockedReason(step.error ?? "");
    error = blocked ? tw(`blocked.${blocked}.title`) : (TOOL_ERRORS as readonly string[]).includes(step.error ?? "") ? t(`toolErrors.${step.error as (typeof TOOL_ERRORS)[number]}`) : t("toolErrors.failed");
  }

  return (
    <li aria-label={title} className={cn("flex flex-col gap-2.5 rounded-2xl border bg-background p-3", step.status === "failed" && "border-danger/40")}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", step.status === "failed" ? "bg-danger/10 text-danger" : "bg-accent text-primary")}>
          <Icon className="size-4" />
        </span>
        <p dir="auto" className="min-w-0 flex-1 text-start text-[13px] font-semibold">
          {title}
        </p>
        {step.status === "running" ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : step.status === "ok" ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden />
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {output?.tool === "search_catalog" &&
        (output.products.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noProducts")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label={t("found")}>
            {output.products.map((p) => (
              <li key={p.sku} className="flex items-center gap-2.5 rounded-lg bg-muted/60 p-1.5">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- catalog image URL
                  <img src={p.image} alt="" className="size-9 shrink-0 rounded-md bg-background object-cover" />
                ) : (
                  <span className="size-9 shrink-0 rounded-md bg-background" aria-hidden />
                )}
                <span className="flex min-w-0 flex-col">
                  <span dir="auto" className="truncate text-xs font-medium">
                    {p.name}
                  </span>
                  <span dir="ltr" className="truncate text-start text-[11px] text-muted-foreground">
                    {p.sku}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}

      {output?.tool === "write_copy" && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-2.5">
          <p dir="auto" className="text-sm font-medium">
            {output.title}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("copyLanguages", { languages: output.languages.map((l) => t(`languages.${l === "ar" ? "ar" : "en"}`)).join(" · ") })}</p>
          <Link href={{ pathname: "/copy", query: { copy: output.copyId } }} className="text-xs font-semibold text-primary hover:underline">
            {t("openCopy")}
          </Link>
        </div>
      )}

      {step.tool === "generate_image" && step.status === "running" && <div className="aspect-square w-40 animate-pulse rounded-xl bg-muted" aria-hidden />}
      {output?.tool === "generate_image" && (
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => onView({ src: output.url, alt: output.productName, name: `${output.sku}.png`, sku: output.sku, mode: "lifestyle" })}
            className="overflow-hidden rounded-xl border hover:border-primary"
            aria-label={t("openImage", { name: output.productName })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- our asset route, thumbnailed */}
            <img src={thumbnailUrl(output.url, 256)} alt={output.productName} width={output.width} height={output.height} className="h-auto w-40" />
          </button>
          <Link href="/history" className="text-xs font-semibold text-primary hover:underline">
            {t("openHistory")}
          </Link>
        </div>
      )}
    </li>
  );
}
