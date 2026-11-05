"use client";

import { useRef, useState } from "react";
import { LayoutTemplate, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { LookItem } from "../config";

type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; item: LookItem; rect: DOMRect };

/**
 * Arrangement canvas. Items are stored as fractions of the canvas, rendered back to front in array
 * order. Physical left/right is kept in RTL because it represents the room, not reading order.
 */
export function LookCanvas({
  items,
  selectedId,
  backgroundUrl,
  ratio,
  showGrid,
  zoom,
  onSelect,
  onPreview,
  onCommit,
  onBringFront,
  onToggleLock,
  onDelete,
  onAddClick,
}: {
  items: LookItem[];
  selectedId: string | null;
  backgroundUrl: string | null;
  ratio: { w: number; h: number };
  showGrid: boolean;
  zoom: number;
  onSelect: (id: string | null) => void;
  /** Live update while dragging (not recorded in undo history). */
  onPreview: (items: LookItem[]) => void;
  /** Final update at the end of a drag (recorded in undo history). */
  onCommit: (items: LookItem[]) => void;
  onBringFront: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onAddClick: () => void;
}) {
  const t = useTranslations("Looks");
  const frameRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function start(e: React.PointerEvent, item: LookItem, mode: Drag["mode"]) {
    e.stopPropagation();
    onSelect(item.id);
    if (item.locked || !frameRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: item.id, mode, startX: e.clientX, startY: e.clientY, item, rect: frameRef.current.getBoundingClientRect() });
  }

  function next(e: React.PointerEvent) {
    if (!drag) return null;
    const dx = (e.clientX - drag.startX) / drag.rect.width;
    const dy = (e.clientY - drag.startY) / drag.rect.height;
    return items.map((i) => {
      if (i.id !== drag.id) return i;
      if (drag.mode === "move") return { ...i, x: drag.item.x + dx, y: drag.item.y + dy };
      const w = Math.max(0.05, drag.item.w + dx);
      return { ...i, w, h: w * (drag.item.h / drag.item.w) };
    });
  }

  const selected = items.find((i) => i.id === selectedId);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-8 py-14 text-center">
          <LayoutTemplate className="size-8 text-primary" strokeWidth={1.5} aria-hidden />
          <h2 className="text-base font-bold">{t("arrangeTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("arrangeBody")}</p>
          <button type="button" onClick={onAddClick} className="mt-1 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">
            {t("addFirst")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden p-6" onPointerDown={() => onSelect(null)}>
      <div
        ref={frameRef}
        dir="ltr"
        className="relative w-full max-w-[560px] touch-none overflow-hidden rounded-xl bg-muted shadow-sm select-none"
        style={{ aspectRatio: `${ratio.w} / ${ratio.h}`, transform: `scale(${zoom / 100})` }}
      >
        {backgroundUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route
          <img src={backgroundUrl} alt="" className="pointer-events-none absolute inset-0 size-full object-cover opacity-90" />
        )}
        {showGrid && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: "linear-gradient(rgba(79,70,229,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(79,70,229,.18) 1px, transparent 1px)", backgroundSize: "10% 10%" }}
          />
        )}

        {items.map((item) =>
          item.hidden ? null : (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={item.name}
              aria-pressed={item.id === selectedId}
              onPointerDown={(e) => start(e, item, "move")}
              onPointerMove={(e) => {
                const updated = next(e);
                if (updated) onPreview(updated);
              }}
              onPointerUp={(e) => {
                const updated = next(e);
                setDrag(null);
                if (updated) onCommit(updated);
              }}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") onDelete(item.id);
              }}
              className={cn(
                "absolute outline-none",
                item.locked ? "cursor-default" : "cursor-move",
                item.id === selectedId && "ring-2 ring-primary ring-offset-1",
              )}
              style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
              <img src={item.imageUrl} alt="" draggable={false} className="pointer-events-none size-full object-contain drop-shadow-[0_6px_8px_rgba(0,0,0,0.18)]" />
              {item.locked && <Lock className="absolute end-1 top-1 size-3.5 text-white drop-shadow" aria-hidden />}
              {item.id === selectedId && !item.locked && (
                <span
                  role="slider"
                  aria-label={t("resize", { name: item.name })}
                  aria-valuenow={Math.round(item.w * 100)}
                  onPointerDown={(e) => start(e, item, "resize")}
                  className="absolute -end-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-primary bg-white"
                />
              )}
            </div>
          ),
        )}

        {selected && !selected.hidden && (
          <div
            className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-md bg-[#1e293b] px-2.5 py-1 text-[11px] whitespace-nowrap text-white shadow"
            style={{ left: `${(selected.x + selected.w / 2) * 100}%`, top: `calc(${selected.y * 100}% - 6px)` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="max-w-32 truncate font-semibold">{selected.name}</span>
            <span className="h-3 w-px bg-white/25" />
            <button type="button" onClick={() => onBringFront(selected.id)} className="text-white/75 hover:text-white">
              {t("bringFront")}
            </button>
            <button type="button" onClick={() => onToggleLock(selected.id)} className="text-white/75 hover:text-white">
              {selected.locked ? t("unlockItem") : t("lockItem")}
            </button>
            <button type="button" onClick={() => onDelete(selected.id)} className="text-[#f87171] hover:text-[#fca5a5]">
              {t("delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
