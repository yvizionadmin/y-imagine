"use client";

import { blockedReason } from "@/components/app/job-errors";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Check, Eye, EyeOff, Image as ImageIcon, Link2, Loader2, Lock, Plus, Search, Shapes, Square, Type, Unlock, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { ConfigPanel, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { ExportDialog } from "@/components/app/export-dialog";
import { HiddenFileInput } from "@/components/app/upload-inputs";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { GeneratedImage } from "@/lib/ai/types";
import type { CatalogProduct } from "@/lib/catalog/types";
import { LATN } from "@/lib/format";
import type { RoomBackgroundView } from "@/lib/looks/room-backgrounds";
import { useCategoryParam, useCategorySync, useSubcategorySync } from "@/lib/use-category-param";
import { CategoryFields } from "@/features/image-batch/components/bulk-fields";
import { addLookProduct, generateLook, getLookById, getRoomBackgrounds, saveLook, searchLookProducts, uploadLookBackground } from "../actions";
import {
  DEFAULT_LOOK_CATEGORY,
  LOOK_RATIOS,
  MAX_LOOK_PRODUCTS,
  categoryBackgrounds,
  lookStyles,
  sceneBackgroundId,
  type LookItem,
  type LookRatio,
} from "../config";
import { LookCanvas } from "./look-canvas";
import { useJobCost } from "@/features/credits/use-job-cost";

type Settings = { title: string; prompt: string; category: string; style: string | null; ratio: LookRatio; backgroundId: string | null };
type Result = { image: GeneratedImage; saved: "none" | "look" | "board" };

/** Shop-the-look builder. With `?look=<id>` (Edit Look) it loads that look and saves back into it. */
export function LooksBuilder() {
  const lookId = useSearchParams().get("look");
  // Keyed so switching between editing a look and a fresh builder resets the canvas.
  return <Builder key={lookId ?? "new"} lookId={lookId} />;
}

function Builder({ lookId }: { lookId: string | null }) {
  const lookCost = useJobCost("looks");
  const t = useTranslations("Looks");
  const tp = useTranslations("Presets");
  const format = useFormatter();
  const tw = useTranslations("Workspace");
  // The template picker (and a reload) passes ?category= / ?sub=, as in Generate.
  const paramCategory = useCategoryParam();
  const searchRef = useRef<HTMLInputElement>(null);
  // Snapshot taken when a drag starts, so undo returns to the pre-drag layout.
  const dragBase = useRef<LookItem[] | null>(null);
  const [items, setItems] = useState<LookItem[]>([]);
  const [past, setPast] = useState<LookItem[][]>([]);
  const [future, setFuture] = useState<LookItem[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    title: "",
    prompt: "",
    category: paramCategory ?? DEFAULT_LOOK_CATEGORY,
    style: null,
    ratio: "1:1",
    backgroundId: null,
  });
  // Styles and backgrounds belong to a category, so a new category starts on its own.
  const chooseCategory = useCategorySync(settings.category, (category) => setSettings((s) => ({ ...s, category, style: null, backgroundId: null })));
  const [subcategory, chooseSubcategory] = useSubcategorySync(settings.category);
  const [backgrounds, setBackgrounds] = useState<RoomBackgroundView[]>([]);
  // Backgrounds the merchant uploaded here: kept across category switches, like Generate's own scene.
  const [uploads, setUploads] = useState<{ id: string; imageUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(100);
  const [grid, setGrid] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    getRoomBackgrounds().then(({ backgrounds }) => setBackgrounds(backgrounds));
  }, []);

  useEffect(() => {
    if (!lookId) return;
    getLookById(lookId).then((found) => {
      if (!found) return setError(t("notFound"));
      const { look } = found;
      setItems(look.items);
      setSettings({
        title: look.title,
        prompt: look.prompt,
        category: look.category,
        style: look.style,
        ratio: look.aspectRatio as LookRatio,
        backgroundId: look.backgroundId,
      });
      if (look.backgroundId && look.uploadedBackgroundUrl) setUploads([{ id: look.backgroundId, imageUrl: look.uploadedBackgroundUrl }]);
      // The category is already set above, so the address change below keeps the look's style.
      const params = new URLSearchParams(window.location.search);
      params.set("category", look.category);
      if (look.subcategory) params.set("sub", look.subcategory);
      else params.delete("sub");
      window.history.replaceState(null, "", `?${params}`);
    });
  }, [lookId, t]);

  const ratio = LOOK_RATIOS.find((r) => r.key === settings.ratio)!;
  // Same list (and fallback to the first) the server renders with: the org's backgrounds for the category, else its preset scenes.
  const { own, scenes } = categoryBackgrounds(settings.category, backgrounds);
  const choices = [
    ...own.map((b) => ({ id: b.id, name: b.name, imageUrl: b.imageUrl, roomType: b.roomType as string | null })),
    ...scenes.map((sc) => ({ id: sceneBackgroundId(sc.key), name: tp(`scenes.${sc.key}`), imageUrl: sc.image, roomType: null })),
    ...uploads.map((u) => ({ ...u, name: t("uploadedBackground"), roomType: null })),
  ];
  const background = choices.find((b) => b.id === settings.backgroundId) ?? choices[0] ?? null;
  const categoryLabel = tp(`categories.${settings.category}`);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  function commit(next: LookItem[]) {
    setPast((p) => [...p.slice(-49), items]);
    setFuture([]);
    setItems(next);
  }
  const update = (id: string, patch: Partial<LookItem>) => commit(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function addItem(product: { sku: string; name: string; category: string | null; assetId: string; imageUrl: string; aspect: number }) {
    const w = 0.34;
    const h = Math.min(0.7, (w * (ratio.w / ratio.h)) / product.aspect);
    const offset = (items.length % 5) * 0.04;
    const item: LookItem = { id: crypto.randomUUID(), ...product, x: 0.33 + offset, y: 0.5 - h / 2 + offset, w, h, locked: false, hidden: false };
    commit([...items, item]);
    setSelectedId(item.id);
  }

  function rearrange() {
    const visible = items.length;
    commit(
      items.map((item, index) => {
        const w = Math.min(0.32, 0.9 / Math.max(1, Math.ceil(visible / 2)));
        const h = w * (item.h / item.w);
        const col = index % Math.ceil(visible / 2 || 1);
        const row = Math.floor(index / Math.ceil(visible / 2 || 1));
        return { ...item, w, h, x: 0.05 + col * (0.9 / Math.ceil(visible / 2 || 1)), y: (row === 0 ? 0.88 : 0.62) - h };
      }),
    );
  }

  async function uploadBackground(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const data = new FormData();
    data.set("image", file);
    const response = await uploadLookBackground(data);
    setUploading(false);
    if (!response.ok) return setError(t("uploadBackgroundFailed"));
    setUploads((u) => [...u, response.background]);
    set("backgroundId", response.background.id);
  }

  async function generate() {
    setError(null);
    setGenerating(true);
    const response = await generateLook({ ...lookPayload() });
    setGenerating(false);
    if (!response.ok) {
      const blocked = blockedReason(response.error);
      return setError(blocked ? tw(`blocked.${blocked}.body`) : response.error === "invalid_input" ? t("invalid") : t("failed"));
    }
    setResult({ image: response.image, saved: "none" });
  }

  const lookPayload = () => ({
    title: settings.title,
    prompt: settings.prompt,
    style: settings.style,
    aspectRatio: settings.ratio,
    category: settings.category,
    subcategory,
    backgroundId: background?.id ?? null,
    items,
  });

  async function save(asBoard: boolean) {
    if (!result) return false;
    const response = await saveLook({ ...lookPayload(), image: result.image.url, asBoard, id: lookId });
    if (response.ok) setResult({ ...result, saved: asBoard ? "board" : "look" });
    return response.ok;
  }

  const header = (
    <div className="flex flex-col gap-1 px-6 pt-5">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
    </div>
  );

  if (result) {
    const roomLabel = background?.roomType ? t(`rooms.${background.roomType}` as "rooms.livingRoom") : (background?.name ?? "");
    return (
      <div className="flex flex-col gap-4 pb-6">
        {header}
        <div className="grid grid-cols-[280px_1fr] gap-4 px-6">
          <aside className="flex flex-col gap-3 rounded-2xl border bg-background p-4">
            <h2 className="text-sm font-bold">{t("arranged")}</h2>
            <div className="flex flex-wrap gap-1.5">
              {[
                t("items", { count: items.length }),
                subcategory ? tp(`subcategories.${subcategory}`) : categoryLabel,
                roomLabel,
                settings.style ? t(`styles.${settings.style}` as "styles.luxury") : null,
              ]
                .filter(Boolean)
                .map((tag) => (
                <span key={tag} className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold">{tag}</span>
              ))}
            </div>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <ProductRow key={item.id} name={item.name} sku={item.sku} category={item.category} imageUrl={item.imageUrl} />
              ))}
            </ul>
          </aside>
          <section className="flex flex-col gap-4 rounded-2xl border bg-background p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- provider output URL */}
            <img src={result.image.url} alt={settings.title || t("untitled")} className="w-full rounded-xl object-cover" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-lg font-bold">{settings.title || background?.name || t("untitled")}</h2>
                <span className="text-xs text-muted-foreground">
                  {t("resultMeta", { count: items.length, room: roomLabel, ratio: settings.ratio })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={result.saved === "board"} onClick={() => save(true)} className="px-2 text-[13px] font-semibold text-primary disabled:text-emerald-700">
                  {result.saved === "board" ? t("savedBoard") : t("createBoard")}
                </button>
                <Button variant="outline" onClick={() => setResult(null)}>{t("editLook")}</Button>
                <Button variant="outline" onClick={generate} disabled={generating}>
                  {generating && <Loader2 className="animate-spin" aria-hidden />}
                  {t("regenerate")}
                </Button>
                <Button variant="outline" onClick={() => setExportOpen(true)}>{t("export")}</Button>
                <Button disabled={result.saved !== "none"} onClick={() => save(false)}>
                  {result.saved !== "none" ? t("saved") : t("saveLook")}
                </Button>
              </div>
            </div>
          </section>
        </div>
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          image={result.image}
          filenameBase={`look_${(settings.title || "untitled").replace(/[^A-Za-z0-9_-]+/g, "_")}`}
          aspectRatio={settings.ratio}
          resolution={`${ratio.w}×${ratio.h}`}
          onSave={() => save(false)}
        />
      </div>
    );
  }

  const styleLabel = settings.style ? t(`styles.${settings.style}` as "styles.luxury") : null;

  return (
    // A column so the prompt dock stays pinned under the builder (the Looks layout scrolls this area).
    <div className="flex min-h-full flex-col">
      <ConfigPanel tool="looks" onSubmit={() => void generate()}>
        <PanelHeader title={settings.title || t("title")} />
        <PanelBody disabled={generating}>
          <label htmlFor="look-prompt" className="sr-only">
            {t("prompt")}
          </label>
          <textarea
            id="look-prompt"
            value={settings.prompt}
            maxLength={1000}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder={t("promptPlaceholder")}
            className="field-sizing-content max-h-32 min-h-14 w-full resize-none rounded-xl border border-input bg-muted/40 px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground hover:border-ring/50 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30"
          />
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
              {error}
            </p>
          )}

          <Section title={t("chips.scene")} summary={[subcategory ? tp(`subcategories.${subcategory}`) : categoryLabel, styleLabel].filter(Boolean).join(" · ")} icon={<Shapes className="size-3.5 shrink-0" aria-hidden />}>
            <CategoryFields
              label={t("category")}
              category={settings.category}
              subcategory={subcategory}
              onCategory={chooseCategory}
              onSubcategory={chooseSubcategory}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t("style")}</span>
              <div role="radiogroup" aria-label={t("style")} className="flex flex-wrap gap-1.5">
                {lookStyles(settings.category).map((style) => (
                  <button key={style} type="button" role="radio" aria-checked={settings.style === style} onClick={() => set("style", settings.style === style ? null : style)}
                    className={cn("rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground", settings.style === style && "border-primary bg-primary text-primary-foreground")}>
                    {t(`styles.${style}` as "styles.luxury")}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t("chips.background")} summary={background?.name ?? null} icon={<ImageIcon className="size-3.5 shrink-0" aria-hidden />}>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t("roomBackground")}</span>
              <div role="radiogroup" aria-label={t("roomBackground")} className="flex flex-wrap gap-1.5">
                {choices.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={background?.id === b.id} aria-label={b.name} title={b.name} onClick={() => set("backgroundId", b.id)}
                    className={cn("h-9 w-12 overflow-hidden rounded-md border-2 border-transparent", background?.id === b.id && "border-primary")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- org-scoped asset route */}
                    <img src={b.imageUrl} alt="" className="size-full object-cover" />
                  </button>
                ))}
                <button type="button" aria-label={t("uploadBackground")} title={t("uploadBackground")} disabled={uploading} onClick={() => uploadRef.current?.click()}
                  className="flex h-9 w-12 items-center justify-center rounded-md border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">
                  {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                </button>
                <HiddenFileInput inputRef={uploadRef} accept="image/png,image/jpeg,image/webp" onChange={uploadBackground} />
              </div>
            </div>
          </Section>

          <Section title={t("chips.format")} summary={settings.ratio} icon={<Square className="size-3.5 shrink-0" aria-hidden />}>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t("aspectRatio")}</span>
              <div role="radiogroup" aria-label={t("aspectRatio")} className="grid grid-cols-4 gap-1.5">
                {LOOK_RATIOS.map((r) => (
                  <button key={r.key} type="button" role="radio" aria-checked={settings.ratio === r.key} onClick={() => set("ratio", r.key)}
                    className={cn("flex flex-col items-center rounded-lg border py-1.5", settings.ratio === r.key && "border-primary bg-accent text-primary")}>
                    <span className="text-xs font-bold" dir="ltr">{r.key}</span>
                    <span className="text-[9px] text-muted-foreground">{t(`ratios.${r.label}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t("chips.title")} summary={settings.title || null} icon={<Type className="size-3.5 shrink-0" aria-hidden />}>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              {t("lookTitle")}
              <input value={settings.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder={t("lookTitlePlaceholder")} className="h-9 rounded-lg border px-3 text-[13px] font-normal outline-none placeholder:text-subtle focus-visible:border-ring" />
            </label>
          </Section>
        </PanelBody>
        <PanelFooter
          cost={lookCost}
          submitLabel={generating ? t("generating") : t("generate")}
          canSubmit={items.length > 0}
          busy={generating}
          onReset={() => {
            commit([]);
            setSelectedId(null);
          }}
        />
      </ConfigPanel>

      {/* The work area: products to add, the arranging canvas, and the layers of what is placed. */}
      <div className="grid min-h-[34rem] shrink-0 grow grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_240px]">
        <ProductPanel searchRef={searchRef} disabled={items.length >= MAX_LOOK_PRODUCTS} addedSkus={items.map((i) => i.sku)} onAdd={addItem} />

        <section className="relative flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-background to-canvas">
          {/* Canvas tools on top, so they stay in view above the prompt dock. */}
          {items.length > 0 && (
            <div className="mx-auto mt-4 flex items-center gap-4 rounded-full border bg-background px-4 py-1.5 text-[11px] font-medium shadow-sm">
              <button type="button" disabled={past.length === 0} onClick={() => { setFuture((f) => [items, ...f]); setItems(past.at(-1)!); setPast((p) => p.slice(0, -1)); }} className="disabled:opacity-40">{t("undo")}</button>
              <button type="button" disabled={future.length === 0} onClick={() => { setPast((p) => [...p, items]); setItems(future[0]); setFuture((f) => f.slice(1)); }} className="disabled:opacity-40">{t("redo")}</button>
              <span className="flex items-center gap-1.5">
                <button type="button" aria-label={t("zoomOut")} onClick={() => setZoom((z) => Math.max(50, z - 10))}>−</button>
                <span className="w-10 text-center font-bold" dir="ltr">{zoom}%</span>
                <button type="button" aria-label={t("zoomIn")} onClick={() => setZoom((z) => Math.min(150, z + 10))}>+</button>
              </span>
              <button type="button" aria-pressed={grid} onClick={() => setGrid((g) => !g)} className={cn(grid && "text-primary")}>{t("grid")}</button>
              <button type="button" onClick={() => setZoom(100)}>{t("fit")}</button>
              <button type="button" onClick={() => { commit([]); setSelectedId(null); }} className="text-[#ef4444]">{t("reset")}</button>
            </div>
          )}
          <LookCanvas
            items={items}
            selectedId={selectedId}
            backgroundUrl={background?.imageUrl ?? null}
            ratio={ratio}
            showGrid={grid}
            zoom={zoom}
            onSelect={setSelectedId}
            onPreview={(next) => {
              dragBase.current ??= items;
              setItems(next);
            }}
            onCommit={(next) => {
              const base = dragBase.current ?? items;
              dragBase.current = null;
              setPast((p) => [...p.slice(-49), base]);
              setFuture([]);
              setItems(next);
            }}
            onBringFront={(id) => commit([...items.filter((i) => i.id !== id), items.find((i) => i.id === id)!])}
            onToggleLock={(id) => update(id, { locked: !items.find((i) => i.id === id)!.locked })}
            onDelete={(id) => {
              commit(items.filter((i) => i.id !== id));
              setSelectedId(null);
            }}
            onAddClick={() => searchRef.current?.focus()}
          />
          <p className="pb-2 text-center text-[11px] text-muted-foreground">
            {t("limit", { count: format.number(items.length, LATN), max: MAX_LOOK_PRODUCTS })}
          </p>
          {items.length > 0 && <p className="px-4 pb-2 text-center text-[11px] text-muted-foreground">{t("tip")}</p>}
        </section>

        {items.length > 0 && (
          <aside className="flex flex-col gap-2 rounded-2xl border bg-background p-4 lg:col-span-2 xl:col-span-1">
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold">{t("layers")}</h2>
              <ol className="flex flex-col gap-1.5">
                {[...items].reverse().map((item, index) => (
                  <li key={item.id}>
                    <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", item.id === selectedId && "border-primary bg-accent text-primary")}>
                      <button type="button" onClick={() => setSelectedId(item.id)} className={cn("min-w-0 flex-1 truncate text-start font-medium", item.hidden && "opacity-50")}>
                        {index + 1}. {item.name}
                      </button>
                      <button type="button" aria-label={item.hidden ? t("show", { name: item.name }) : t("hide", { name: item.name })} onClick={() => update(item.id, { hidden: !item.hidden })}>
                        {item.hidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                      </button>
                      <button type="button" aria-label={item.locked ? t("unlock", { name: item.name }) : t("lock", { name: item.name })} onClick={() => update(item.id, { locked: !item.locked })}>
                        {item.locked ? <Lock className="size-3.5" aria-hidden /> : <Unlock className="size-3.5" aria-hidden />}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <Button onClick={rearrange} className="mt-1 bg-[#1e293b] hover:bg-[#1e293b]/90">{t("rearrange")}</Button>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

function ProductRow({ name, sku, category, imageUrl, action }: { name: string; sku: string; category: string | null; imageUrl: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- catalog / asset image */}
      <img src={imageUrl} alt="" className="size-11 shrink-0 rounded-lg bg-muted object-cover" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="truncate text-[10px] text-muted-foreground" dir="ltr">#{sku}{category ? ` • ${category}` : ""}</span>
      </span>
      {action}
    </li>
  );
}

/**
 * The products to place: the catalog opens as a grid of cards (search narrows it), products already in the
 * scene are marked Added, and a product can also come from its web page. No catalog: a card says how to connect.
 */
function ProductPanel({
  searchRef,
  disabled,
  addedSkus,
  onAdd,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  addedSkus: string[];
  onAdd: (product: { sku: string; name: string; category: string | null; assetId: string; imageUrl: string; aspect: number }) => void;
}) {
  const t = useTranslations("Looks");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<CatalogProduct[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "no_connection" | "error" | "unusable_photo">("searching");
  const [adding, setAdding] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");

  function load(term: string) {
    setState("searching");
    setSearched(term);
    searchLookProducts(term)
      .then((response) => {
        if (response.ok) {
          setResults(response.products);
          setState("idle");
        } else setState(response.error === "no_connection" ? "no_connection" : "error");
      })
      .catch(() => setState("error"));
  }

  // The catalog's products show as soon as the builder opens.
  useEffect(() => {
    let live = true;
    searchLookProducts("")
      .then((response) => {
        if (!live) return;
        if (response.ok) {
          setResults(response.products);
          setState("idle");
        } else setState(response.error === "no_connection" ? "no_connection" : "error");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);

  async function add(input: Parameters<typeof addLookProduct>[0], key: string) {
    setAdding(key);
    const response = await addLookProduct(input);
    setAdding(null);
    if (response.ok) {
      onAdd(response.product);
      if (input.source === "url") setUrl("");
    } else setState(response.error === "unusable_photo" ? "unusable_photo" : "error");
  }

  return (
    <aside className="flex max-h-[max(24rem,calc(100dvh-19rem))] min-h-0 flex-col gap-3 rounded-2xl border bg-background p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">{t("yourProducts")}</h2>
        <span className="text-[11px] text-muted-foreground" dir="ltr">
          {addedSkus.length}/{MAX_LOOK_PRODUCTS}
        </span>
      </div>
      {state !== "no_connection" && (
        <form className="relative" onSubmit={(e) => { e.preventDefault(); load(query); }}>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input ref={searchRef} value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")}
            className="h-10 w-full rounded-xl border border-input bg-muted/40 ps-9 pe-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background" />
          {query && (
            <button type="button" aria-label={t("clearSearch")} onClick={() => { setQuery(""); load(""); }} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </form>
      )}

      {state === "no_connection" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/40 p-4 text-center">
          <Box className="size-7 text-primary" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-semibold">{t("noCatalogTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("noCatalogBody")}</p>
          <Link href="/settings/integrations" className="mt-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
            {t("connect")}
          </Link>
        </div>
      )}
      {state === "error" && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[11px] text-danger">{t("failed")}</p>}
      {state === "unusable_photo" && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[11px] text-danger">{t("unusablePhoto")}</p>}
      {disabled && <p className="text-[11px] text-muted-foreground">{t("limitReached", { max: MAX_LOOK_PRODUCTS })}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "searching" ? (
          <ul className="grid grid-cols-2 gap-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
            ))}
          </ul>
        ) : state === "idle" && results && results.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2">
            {results.map((p) => {
              const added = addedSkus.includes(p.sku);
              return (
                <li key={p.sku}>
                  <button
                    type="button"
                    disabled={disabled || adding !== null}
                    onClick={() => add({ source: "catalog", sku: p.sku, imageUrl: p.images[0] }, p.sku)}
                    aria-label={t("addTo", { name: p.name })}
                    className={cn(
                      "group relative flex w-full flex-col overflow-hidden rounded-xl border bg-background text-start transition hover:border-primary/50 hover:shadow-sm disabled:cursor-not-allowed",
                      added && "border-primary/50",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- catalog image */}
                    <img src={p.images[0]} alt="" className="aspect-square w-full bg-muted object-contain p-2" />
                    <span className="flex flex-col gap-0.5 border-t px-2 py-1.5">
                      <span className="truncate text-[11px] font-semibold">{p.name}</span>
                      <span className="truncate text-[10px] text-muted-foreground" dir="ltr">#{p.sku}</span>
                    </span>
                    <span
                      className={cn(
                        "absolute end-1.5 top-1.5 flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-semibold shadow-sm",
                        added ? "bg-primary text-primary-foreground" : "bg-background/95 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
                      )}
                    >
                      {adding === p.sku ? <Loader2 className="size-3 animate-spin" aria-hidden /> : added ? <Check className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                      {adding === p.sku ? t("adding") : added ? t("added") : t("add")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          state === "idle" && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center">
              <Box className="size-7 text-subtle" strokeWidth={1.5} aria-hidden />
              <p className="text-xs font-semibold">{searched ? t("noMatch", { query: searched }) : t("noProducts")}</p>
            </div>
          )
        )}
      </div>

      <div className="border-t pt-3">
        <button type="button" aria-expanded={urlOpen} onClick={() => setUrlOpen((o) => !o)} className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Link2 className="size-3.5" aria-hidden />
          {t("orUrl")}
        </button>
        {urlOpen && (
          <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (url.trim()) add({ source: "url", url: url.trim() }, "url"); }}>
            <input type="url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("urlPlaceholder")} aria-label={t("urlPlaceholder")} className="h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-xs outline-none focus-visible:border-ring" />
            <Button type="submit" size="sm" className="h-9" disabled={disabled || adding !== null || !url.trim()}>{adding === "url" ? <Loader2 className="animate-spin" aria-hidden /> : t("importBtn")}</Button>
          </form>
        )}
      </div>
    </aside>
  );
}
