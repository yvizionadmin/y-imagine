"use client";

import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Check, ChevronDown, ImagePlus, Loader2, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { improvePrompt } from "@/features/prompts/actions";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { chipLabel, shorten } from "@/lib/dock-label";
import { LATN } from "@/lib/format";
import { aspectRatios, type AspectRatio, type Resolution } from "@/lib/image-formats";

// The prompt dock shared by Generate, Recolor, A+, Copy and QR: a bar under the canvas holding the
// tool's main input inline, one chip per settings Section (each opening its own panel above the bar),
// the Single/Bulk switch, the cost and the submit button.
//
// Workspaces keep composing ConfigPanel > PanelHeader / PanelBody / PanelFooter. Inside PanelBody,
// anything that isn't a <Section> renders inline in the bar; each Section becomes a chip, its fields
// rendered (always mounted, so their state survives) in a panel that opens above the bar.

type Dock = {
  open: string | null;
  setOpen: (id: string | null) => void;
  chips: HTMLElement | null;
  panel: HTMLElement | null;
  toolbar: HTMLElement | null;
  toolbarEnd: HTMLElement | null;
  setChips: (el: HTMLElement | null) => void;
  setToolbar: (el: HTMLElement | null) => void;
  setToolbarEnd: (el: HTMLElement | null) => void;
};

const DockContext = createContext<Dock | null>(null);
const BodyDisabled = createContext(false);

/** Fired on a field to open the dock panel holding it; see revealField. */
const REVEAL_EVENT = "imagine:reveal-field";

/** Things that render outside the form but belong to a panel's fields (dialogs, menus, pickers). */
const OWNED_OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"], [data-slot="popover-content"]';

/** The tools with a prompt dock; each has a hero heading (`Workspace.heroes.<tool>`) and a tile in the tool row. */
export type DockTool = "generate" | "recolor" | "aplus" | "copy" | "qr" | "resize" | "looks";

export function ConfigPanel({ tool, onSubmit, children }: { tool: DockTool; onSubmit: () => void; children: ReactNode }) {
  const t = useTranslations("Workspace");
  const formRef = useRef<HTMLFormElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [open, setOpenState] = useState<string | null>(null);
  // Editing has started (typed, uploaded, picked, or opened a setting): the canvas placeholder collapses.
  const [touched, setTouched] = useState(false);
  // Panels open above the card, or below it when there isn't room (the placeholder collapsed, page top).
  const [dropUp, setDropUp] = useState(true);
  // The open panel never runs past the visible page: its height is capped by the room on its side.
  const [room, setRoom] = useState(560);
  const setOpen = useCallback((id: string | null) => {
    if (id !== null) setTouched(true);
    setOpenState(id);
  }, []);
  // Measured after the placeholder has collapsed, so the card's final position decides.
  useLayoutEffect(() => {
    if (open === null) return;
    const form = formRef.current?.getBoundingClientRect();
    const page = heroRef.current?.parentElement?.getBoundingClientRect();
    if (!form || !page) return;
    const up = form.top - page.top > 440;
    setDropUp(up);
    setRoom(Math.max(240, (up ? form.top - page.top : page.bottom - form.bottom) - 16));
  }, [open, touched]);
  const [chips, setChips] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [toolbarEnd, setToolbarEnd] = useState<HTMLElement | null>(null);

  // Chat-style scrolling: while the page is at the bottom (the newest result, just above the pinned prompt
  // bar), it stays there as results load and grow; scrolled up to read older results, it stays put.
  useEffect(() => {
    const main = heroRef.current?.parentElement;
    if (!main) return;
    let atBottom = true;
    let lastTop = main.scrollTop;
    // Only the reader scrolling up stops the follow (content growing must not); back near the bottom resumes it.
    const onScroll = () => {
      if (main.scrollHeight - main.scrollTop - main.clientHeight < 160) atBottom = true;
      else if (main.scrollTop < lastTop) atBottom = false;
      lastTop = main.scrollTop;
    };
    const resize = new ResizeObserver(() => {
      if (atBottom) main.scrollTo({ top: main.scrollHeight });
    });
    const watch = () => Array.from(main.children).forEach((child) => resize.observe(child));
    const added = new MutationObserver(watch);
    watch();
    added.observe(main, { childList: true });
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resize.disconnect();
      added.disconnect();
      main.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Clicking outside the dock closes the open panel (but not a dialog/menu a field opened), and so
  // does Escape inside it. Native listeners: the panel's fields are portals, so React events from
  // them bubble to their Section, not to the panel element.
  useEffect(() => {
    if (open === null) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || formRef.current?.contains(target) || target.closest(OWNED_OVERLAYS)) return;
      setOpen(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && event.target instanceof Node && panel?.contains(event.target)) setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, panel, setOpen]);

  const dock: Dock = {
    open,
    setOpen,
    chips,
    panel,
    toolbar,
    toolbarEnd,
    setChips,
    setToolbar,
    setToolbarEnd,
  };

  return (
    <DockContext.Provider value={dock}>
      {/* The prompt bar, pinned under the results: compact so the results get the screen (laptops included). */}
      <section
        ref={heroRef}
        data-dock=""
        data-touched={touched ? "" : undefined}
        onInputCapture={() => setTouched(true)}
        onChangeCapture={() => setTouched(true)}
        className="sticky bottom-0 z-20 order-last mt-auto shrink-0 bg-linear-to-t from-canvas via-canvas/95 to-canvas/0 px-3 pt-4 pb-3 sm:px-6 sm:pb-4"
      >
        <h1 className="sr-only">{t.rich(`heroes.${tool}`, { em: (chunks) => chunks })}</h1>
        <form
          ref={formRef}
          className="relative mx-auto w-full max-w-4xl"
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(null);
            onSubmit();
            // The new result renders just above the pinned prompt bar, at the end of the feed.
            const main = heroRef.current?.parentElement;
            main?.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
          }}
        >
          <div className="flex min-w-0 flex-col rounded-2xl border bg-background shadow-[0_2px_4px_rgba(17,24,39,0.04),0_12px_32px_rgba(17,24,39,0.10)] focus-within:border-ring">
            {/* Top row: Single / Bulk, and a tool's own switch on the other side (bulk: Paste / CSV). */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 empty:hidden sm:px-4 sm:pt-4">
              <div ref={setToolbar} className="flex empty:hidden" />
              <div ref={setToolbarEnd} className="flex empty:hidden" />
            </div>
            {children}
          </div>
          {/* Panels open above the card (over the results), or below it near the top of the page. */}
          <div
            ref={setPanel}
            style={{ "--panel-room": `${room}px` } as CSSProperties}
                className={cn("absolute start-0 z-30 w-[min(40rem,100%)]", dropUp ? "bottom-full mb-2" : "top-full mt-2", open === null && "hidden")}
          />
        </form>
      </section>
    </DockContext.Provider>
  );
}

/** The current job's name (SKU, campaign), for screen readers; the hero carries the visible heading. */
export function PanelHeader({ title }: { title: string }) {
  return <h2 className="sr-only">{title}</h2>;
}

/** The bar's inline area: everything that isn't a Section (prompt, product list, errors). */
export function PanelBody({ disabled, children }: { disabled?: boolean; children: ReactNode }) {
  return (
    <BodyDisabled.Provider value={!!disabled}>
      {/* min-w-0: a fieldset defaults to min-content width, so one long file name would widen the bar. */}
      <fieldset disabled={disabled} className="flex max-h-[38vh] min-h-0 min-w-0 flex-col gap-3 overflow-y-auto px-3 pt-3 empty:hidden sm:px-4 sm:pt-4">
        {children}
      </fieldset>
    </BodyDisabled.Provider>
  );
}

/** The Single/Bulk switch, the first row of every tool's prompt card (Studio's Image | Video pill, smaller). */
export const MODE_SWITCH = "inline-flex gap-1 rounded-full border bg-background/60 p-1 shadow-xs";
export function modeSwitchItem(selected: boolean) {
  return cn(
    "flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-muted-foreground outline-offset-2 transition-colors hover:text-foreground",
    selected && "bg-foreground text-background shadow-sm hover:text-background",
  );
}

/** Portals its children (the Single/Bulk switch) to the start of the prompt card's top row; `end` to its end. */
export function DockToolbar({ end, children }: { end?: boolean; children: ReactNode }) {
  const dock = useContext(DockContext);
  if (!dock) return <>{children}</>;
  const slot = end ? dock.toolbarEnd : dock.toolbar;
  return slot ? createPortal(children, slot) : null;
}

/** Opens the dock panel holding `el`, then focuses it (e.g. "Edit details" on a failed result). */
export function revealField(el: HTMLElement | null) {
  if (!el) return;
  el.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
  requestAnimationFrame(() => {
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

export { chipLabel, shorten };

export function Section({
  title,
  aside,
  summary,
  inline,
  icon,
  bare,
  children,
}: {
  title: string;
  aside?: ReactNode;
  /** The current choice, shown on the chip (e.g. "Living Room · Scandinavian"). */
  summary?: string | null;
  /** Render in the bar itself instead of as a chip (the tool's main input). */
  inline?: boolean;
  /** A small icon at the start of the chip. */
  icon?: ReactNode;
  /** Inline only: no visible heading row (named for screen readers). */
  bare?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Workspace");
  const dock = useContext(DockContext);
  const disabled = useContext(BodyDisabled);
  const id = useId();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const required = isValidElement(aside) && aside.type === RequiredTag;
  const ready = isValidElement(aside) && aside.type === ReadyTag;
  const docked = !!dock && !inline;
  const setOpen = dock?.setOpen;

  useEffect(() => {
    if (!node || !setOpen) return;
    const reveal = () => setOpen(id);
    node.addEventListener(REVEAL_EVENT, reveal);
    return () => node.removeEventListener(REVEAL_EVENT, reveal);
  }, [node, setOpen, id]);

  if (!docked && bare) {
    return (
      <section aria-label={chipLabel(title)} className="flex flex-col gap-2.5">
        {children}
      </section>
    );
  }

  if (!docked) {
    return (
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold">{chipLabel(title)}</h2>
          {aside}
        </div>
        {children}
      </section>
    );
  }

  const label = chipLabel(title);
  const isOpen = dock.open === id;
  const panelId = `${id}-panel`;

  return (
    <>
      {dock.chips &&
        createPortal(
          <button
            type="button"
            aria-label={[summary ? `${label}: ${summary}` : label, required ? t("requiredSetting") : ready ? t("readySetting") : null].filter(Boolean).join(", ")}
            title={summary ? `${label}: ${summary}` : undefined}
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => dock.setOpen(isOpen ? null : id)}
            className={cn(
              "flex h-8 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold text-foreground/80 outline-none hover:bg-muted focus-visible:border-ring",
              isOpen ? "border-border bg-muted" : "border-transparent bg-muted/70",
            )}
          >
            {icon}
            {(!icon || !summary) && <span className="shrink-0">{label}</span>}
            {summary && (
              <span dir="auto" className={cn("min-w-0 truncate", !icon && "font-medium text-muted-foreground")}>
                {summary}
              </span>
            )}
            {required && (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            )}
            {ready && (
              <Check className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
            )}
            <ChevronDown className={cn("size-3 shrink-0 opacity-60 transition-transform", isOpen && "rotate-180")} aria-hidden />
          </button>,
          dock.chips,
        )}
      {dock.panel &&
        createPortal(
          <section
            ref={setNode}
            id={panelId}
            aria-label={label}
            className={cn("max-h-[min(var(--panel-room),36rem)] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[0_16px_48px_rgba(17,24,39,0.16)]", isOpen ? "flex" : "hidden")}
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{label}</h2>
              <div className="flex items-center gap-3">
                {aside}
                <button
                  type="button"
                  aria-label={t("close")}
                  onClick={() => dock.setOpen(null)}
                  className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
            <fieldset disabled={disabled} className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4">
              {children}
            </fieldset>
          </section>,
          dock.panel,
        )}
    </>
  );
}

/**
 * A tilted image tile at the start of the bar (like Studio's Reference): the product photo or swatch,
 * or an empty "add" tile. Clicking opens the panel where it is set.
 */
export function DockTile({ label, preview, onClick, tilt = -6 }: { label: string; preview?: string | null; onClick: () => void; tilt?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{ rotate: `${tilt}deg` }}
      className={cn(
        "flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg text-muted-foreground transition-[rotate,color,border-color] hover:rotate-0! hover:text-primary",
        preview ? "border bg-muted shadow-sm" : "border border-dashed bg-muted/40 hover:border-primary/50",
      )}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL
        <img src={preview} alt={label} className="size-full object-cover" />
      ) : (
        <>
          <ImagePlus className="size-4" aria-hidden />
          <span className="max-w-full truncate px-0.5 text-[9px] leading-none font-semibold">{label}</span>
        </>
      )}
    </button>
  );
}

export function RequiredTag() {
  const t = useTranslations("Workspace");
  return <span className="text-[11px] font-semibold text-primary">{t("required")}</span>;
}

export function OptionalTag() {
  const t = useTranslations("Workspace");
  return <span className="text-[11px] text-muted-foreground">{t("optional")}</span>;
}

export function ReadyTag() {
  const t = useTranslations("Workspace");
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      {t("ready")}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  gap = "gap-1.5",
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
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground/80">
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
      <Field label={t("aspectRatio")} gap="gap-2">
        <div role="radiogroup" aria-label={t("aspectRatio")} className="flex flex-wrap gap-2">
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
                  "flex h-14 w-16 flex-col items-center justify-center gap-1.5 rounded-xl border text-[11px] font-semibold text-muted-foreground",
                  selected && "border-primary bg-accent text-primary",
                )}
              >
                <span
                  style={{ width: ratio.w, height: ratio.h }}
                  className={cn("rounded-[2px] border-[1.5px] border-muted-foreground", selected && "border-primary")}
                />
                <span dir="ltr">{ratio.key}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("resolution")}>
          <div role="radiogroup" aria-label={t("resolution")} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
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
                    "flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground",
                    selected && "bg-background text-foreground shadow-xs",
                  )}
                >
                  {res}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t("targetSize")}>
          <div className="rounded-lg bg-muted px-2 py-1.5 text-center font-mono text-xs">{t("autoDetect")}</div>
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
  note,
  actions,
  submitIcon,
  submitLabel,
  canSubmit,
  busy,
  onReset,
}: {
  /** Credits the job will use; omit for free tools and pass `note` instead. */
  cost?: number;
  note?: string;
  /** Extra buttons before the submit button (e.g. QR's SVG download). */
  actions?: ReactNode;
  submitIcon?: ReactNode;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onReset: () => void;
}) {
  const t = useTranslations("Workspace");
  const format = useFormatter();
  const dock = useContext(DockContext);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-2 pb-3 sm:px-4 sm:pb-4">
      <div ref={dock?.setChips} role="group" aria-label={t("settings")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 empty:hidden" />
      <div className="ms-auto flex items-center gap-2.5">
        <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={onReset} aria-label={t("reset")} title={t("reset")} className="size-8 rounded-full text-muted-foreground">
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
        {cost !== undefined && (
          <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground tabular-nums">
            <Sparkles className="size-3.5" aria-hidden />
            <span aria-hidden>{format.number(cost, LATN)}</span>
            <span className="sr-only">{t("cost", { count: cost, display: format.number(cost, LATN) })}</span>
          </span>
        )}
        {note && <span className="hidden text-[11px] text-muted-foreground sm:inline">{note}</span>}
        {actions}
        {/* Round like Studio's; the action ("Generate 3 images") is its name and tooltip. */}
        <Button type="submit" size="icon" disabled={!canSubmit || busy} aria-busy={busy} aria-label={submitLabel} title={submitLabel} className="size-9 rounded-full">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : (submitIcon ?? <ArrowUp className="size-4.5" aria-hidden />)}
        </Button>
      </div>
    </div>
  );
}
