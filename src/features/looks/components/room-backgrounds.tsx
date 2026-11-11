"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { categoryPresets } from "@/lib/catalog-presets";
import type { RoomBackgroundView } from "@/lib/looks/room-backgrounds";
import { deleteRoomBackground, editRoomBackground, getRoomBackgrounds, uploadRoomBackground } from "../actions";
import { DEFAULT_LOOK_CATEGORY, LOOK_STYLES, ROOM_TYPES, lookStyles } from "../config";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import { confirmAction } from "@/components/app/confirm";
import { LoadingSkeleton } from "@/components/ui/skeleton";

type Editing = { mode: "upload" } | { mode: "edit"; background: RoomBackgroundView } | null;

export function RoomBackgroundsManager() {
  const t = useTranslations("Looks");
  const tp = useTranslations("Presets");
  const [data, setData] = useState<{ backgrounds: RoomBackgroundView[]; canManage: boolean } | null>(null);
  const [category, setCategory] = useState("");
  const [room, setRoom] = useState("");
  const [style, setStyle] = useState("");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<Editing>(null);

  const refresh = useCallback(async () => setData(await getRoomBackgrounds()), []);
  useEffect(() => {
    getRoomBackgrounds().then(setData);
  }, []);

  const visible = (data?.backgrounds ?? []).filter(
    (b) => (!category || b.category === category) && (!room || b.roomType === room) && (!style || b.style === style) && (status === "all" || (status === "active") === b.active),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex max-w-md flex-col gap-1">
          <h1 className="text-xl font-bold">{t("bgTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t("bgSubtitle")}</p>
        </div>
        {data?.canManage && (
          <Button onClick={() => setEditing({ mode: "upload" })}>
            <Plus aria-hidden />
            {t("upload")}
          </Button>
        )}
      </div>
      {data && !data.canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}

      <div className="flex flex-wrap gap-2">
        <FilterSelect label={t("category")} value={category} onChange={(c) => { setCategory(c); setStyle(""); }} options={[{ value: "", label: t("allCategories") }, ...categoryPresets.map((c) => ({ value: c.key, label: tp(`categories.${c.key}`) }))]} />
        <FilterSelect label={t("roomType")} value={room} onChange={setRoom} options={[{ value: "", label: t("allRooms") }, ...ROOM_TYPES.map((r) => ({ value: r, label: t(`rooms.${r}`) }))]} />
        <FilterSelect label={t("styleLabel")} value={style} onChange={setStyle} options={[{ value: "", label: t("allStyles") }, ...(category ? lookStyles(category) : LOOK_STYLES).map((s) => ({ value: s, label: t(`styles.${s}` as "styles.luxury") }))]} />
        <FilterSelect label={t("status")} value={status} onChange={setStatus} options={[{ value: "active", label: t("activeOnly") }, { value: "inactive", label: t("inactiveOnly") }, { value: "all", label: t("allStatuses") }]} />
      </div>

      {!data ? (
        <LoadingSkeleton variant="cards" className="p-4" />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border bg-background px-6 py-12 text-center text-[13px] text-muted-foreground">{t("noBackgrounds")}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {visible.map((b) => (
            <article key={b.id} className="flex flex-col overflow-hidden rounded-xl border bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
              <img src={thumbnailUrl(b.imageUrl, 640)} alt={b.name} loading="lazy" className="aspect-[16/9] w-full object-cover" />
              <div className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <h2 className="truncate text-[13px] font-bold">{b.name}</h2>
                    <span className="text-[11px] text-muted-foreground">
                      {tp(`categories.${b.category}`)} • {t(`rooms.${b.roomType}` as "rooms.livingRoom")}
                    </span>
                  </div>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", b.active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>
                    {b.active ? t("active") : t("inactive")}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-[11px]">
                  <span className="text-muted-foreground">
                    {t("styleLabel")}: <b className="text-foreground">{t(`styles.${b.style}` as "styles.luxury")}</b>
                  </span>
                  {data.canManage && (
                    <span className="flex gap-3 font-semibold">
                      <button type="button" onClick={() => setEditing({ mode: "edit", background: b })} className="text-primary">{t("edit")}</button>
                      <button
                        type="button"
                        className="text-danger"
                        onClick={async () => {
                          if (!(await confirmAction(t("deleteConfirm", { name: b.name })))) return;
                          await deleteRoomBackground(b.id);
                          refresh();
                        }}
                      >
                        {t("delete")}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <BackgroundDialog editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
      {label}:
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent font-semibold text-foreground outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function BackgroundDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("Looks");
  const tp = useTranslations("Presets");
  const existing = editing?.mode === "edit" ? editing.background : null;
  // Controlled, so the style list follows the picked category; reset whenever the dialog target changes.
  const [category, setCategory] = useState({ for: existing?.id, value: existing?.category ?? DEFAULT_LOOK_CATEGORY });
  if (category.for !== existing?.id) setCategory({ for: existing?.id, value: existing?.category ?? DEFAULT_LOOK_CATEGORY });
  const styles = lookStyles(category.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError(false);
    const data = new FormData(form);
    const result = existing
      ? await editRoomBackground(existing.id, {
          name: String(data.get("name")),
          roomType: String(data.get("roomType")),
          category: String(data.get("category")),
          style: String(data.get("style")),
          active: data.get("active") === "on",
        })
      : await uploadRoomBackground(data);
    setBusy(false);
    if (result.ok) onSaved();
    else setError(true);
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[420px]">
        <DialogTitle className="text-base font-bold">{existing ? t("editTitle") : t("uploadTitle")}</DialogTitle>
        <form key={existing?.id ?? "new"} className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
          {!existing && (
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              {t("image")}
              <input name="image" type="file" accept="image/png,image/jpeg,image/webp" required className="text-xs font-normal" />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            {t("name")}
            <input name="name" defaultValue={existing?.name} maxLength={80} required className="h-9 rounded-lg border px-3 text-[13px] font-normal outline-none focus-visible:border-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            {t("category")}
            <select name="category" value={category.value} onChange={(e) => setCategory({ for: existing?.id, value: e.target.value })} className="h-9 rounded-lg border px-2 text-[13px] font-normal">
              {categoryPresets.map((c) => <option key={c.key} value={c.key}>{tp(`categories.${c.key}`)}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              {t("roomType")}
              <select name="roomType" defaultValue={existing?.roomType ?? ROOM_TYPES[0]} className="h-9 rounded-lg border px-2 text-[13px] font-normal">
                {ROOM_TYPES.map((r) => <option key={r} value={r}>{t(`rooms.${r}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              {t("styleLabel")}
              {/* Keyed by category: a style from the old category isn't offered by the new one. */}
              <select key={category.value} name="style" defaultValue={existing && styles.includes(existing.style) ? existing.style : styles[0]} className="h-9 rounded-lg border px-2 text-[13px] font-normal">
                {styles.map((s) => <option key={s} value={s}>{t(`styles.${s}` as "styles.luxury")}</option>)}
              </select>
            </label>
          </div>
          {existing && (
            <label className="flex items-center gap-2 text-xs font-medium">
              <input name="active" type="checkbox" defaultChecked={existing.active} />
              {t("activeToggle")}
            </label>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">{t("invalid")}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" aria-hidden />}{t("save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
