"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfigPanel, Field, OptionalTag, PanelBody, PanelFooter, PanelHeader, RequiredTag, Section } from "@/components/app/config-panel";
import { blockedReason } from "@/components/app/job-errors";
import { FilePickerRow } from "@/components/app/upload-inputs";
import { CatalogFetch } from "@/features/catalog/components/catalog-fetch";
import type { CopyChannel, CopyLanguage, CopyLength, CopyTone } from "@/lib/ai/types";
import { categoryPresets } from "@/lib/catalog-presets";
import { getBrandKitSummary } from "@/features/brand/actions";
import { generateProductCopy, getCopyReviewRights, getSavedCopy, listRecentCopies, saveCopyEdits, type CopyView, type ReviewRights } from "../actions";
import { CopyCanvas, type CopyCanvasState, type RecentFilter } from "./copy-canvas";
import { CategorySelect, CopyModeTabs, CopyStyleFields, type BrandSummary } from "./copy-fields";

const COPY_COST = 1;

type FormState = {
  sku: string;
  productName: string;
  image: File | null;
  category: string;
  details: string;
  keywords: string;
  tone: CopyTone;
  length: CopyLength;
  channel: CopyChannel;
  languages: CopyLanguage[];
  brandVoice: boolean;
};

const initialState: FormState = {
  sku: "",
  productName: "",
  image: null,
  category: categoryPresets[0].key,
  details: "",
  keywords: "",
  tone: "professional",
  length: "medium",
  channel: "website",
  languages: ["en", "ar"],
  brandVoice: true,
};

/** Product copy (EN/AR) tool: same config-panel + canvas layout as the image tools. */
export function CopyWorkspace() {
  const t = useTranslations("Copy");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormState>(() => ({ ...initialState, sku: searchParams.get("sku")?.slice(0, 64) ?? "" }));
  const [state, setState] = useState<CopyCanvasState>({ kind: "empty" });
  const [recent, setRecent] = useState<CopyView[]>([]);
  const [brand, setBrand] = useState<BrandSummary>(undefined);
  const [rights, setRights] = useState<ReviewRights | null>(null);
  const [filter, setFilter] = useState<RecentFilter>("all");
  const [pending, startTransition] = useTransition();
  const skuRef = useRef<HTMLInputElement>(null);

  const openId = searchParams.get("copy");
  useEffect(() => {
    getBrandKitSummary().then(setBrand);
    getCopyReviewRights().then(setRights);
  }, []);
  useEffect(() => {
    listRecentCopies(filter === "all" ? undefined : filter).then(setRecent);
  }, [filter]);

  // ?copy=<id> (a product written by a bulk run): open it in the editor.
  useEffect(() => {
    if (openId) getSavedCopy(openId).then((copy) => copy && open(copy));
  }, [openId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canSubmit = form.sku.trim() !== "" && form.productName.trim() !== "" && form.languages.length > 0;

  function write() {
    if (!canSubmit || pending) return;
    const data = new FormData();
    for (const key of ["sku", "productName", "category", "details", "keywords", "tone", "length", "channel"] as const) data.set(key, form[key]);
    for (const language of form.languages) data.append("languages", language);
    if (!form.brandVoice) data.set("brandVoice", "off");
    if (form.image) data.set("image", form.image);
    setState({ kind: "writing", languages: form.languages });
    startTransition(async () => {
      const result = await generateProductCopy(data);
      if (result.ok) {
        setState({ kind: "result", copy: result.copy });
        if (filter === "all") setRecent((r) => [result.copy, ...r.filter((c) => c.id !== result.copy.id)].slice(0, 20));
      } else {
        setState({ kind: "failed", reason: result.error === "invalid_input" ? "input" : (blockedReason(result.error) ?? "generation") });
      }
    });
  }

  /** Loads saved copy into the canvas and its settings into the form, ready to regenerate. */
  function open(copy: CopyView) {
    const s = copy.settings;
    setForm((f) => ({ ...f, sku: copy.sku, productName: copy.productName, category: s.category, details: s.details, keywords: s.keywords.join(", "), tone: s.tone, length: s.length, channel: s.channel, languages: s.languages, brandVoice: s.brandVoice ?? true }));
    setState({ kind: "result", copy });
  }

  async function save(copy: CopyView["copy"]) {
    if (state.kind !== "result") return false;
    const result = await saveCopyEdits(state.copy.id, copy);
    if (!result.ok) return false;
    reviewed(result.copy);
    return true;
  }

  /** After a review step (or an edit that reset an approval): the "In review" list only keeps copy still in review. */
  function reviewed(copy: CopyView) {
    setState((s) => (s.kind === "result" && s.copy.id === copy.id ? { kind: "result", copy } : s));
    setRecent((r) => r.flatMap((c) => (c.id !== copy.id ? [c] : filter === "all" || copy.reviewStatus === filter ? [copy] : [])));
  }

  function editSettings() {
    setState((s) => (s.kind === "failed" ? { kind: "empty" } : s));
    skuRef.current?.focus();
  }

  return (
    <>
      <ConfigPanel onSubmit={write}>
        <PanelHeader title={form.productName.trim() || form.sku.trim() || t("panelTitle")} />

        <PanelBody disabled={pending}>
          <CopyModeTabs mode="single" />
          <Section title={t("product")} aside={<RequiredTag />}>
            <Field label={t("sku")} htmlFor="copy-sku">
              <Input ref={skuRef} id="copy-sku" value={form.sku} maxLength={64} onChange={(e) => set("sku", e.target.value)} placeholder="SOFA-2041" className="font-mono text-[13px] md:text-[13px]" />
            </Field>
            <CatalogFetch
              sku={form.sku}
              onImport={(file, product) =>
                setForm((f) => ({
                  ...f,
                  image: file,
                  productName: (locale === "ar" && product.nameAr) || product.name || f.productName,
                  category: categoryPresets.some((c) => c.key === product.category) ? product.category! : f.category,
                }))
              }
            />
            <Field label={t("productName")} htmlFor="copy-name">
              <Input id="copy-name" value={form.productName} maxLength={200} onChange={(e) => set("productName", e.target.value)} placeholder={t("productNamePlaceholder")} className="text-[13px] md:text-[13px]" />
            </Field>
            <CategorySelect id="copy-category" label={t("category")} value={form.category} onChange={(category) => set("category", category)} />
            <Field label={t("photo")}>
              <FilePickerRow file={form.image} onChange={(file) => set("image", file)} placeholder={t("photoPlaceholder")} />
            </Field>
          </Section>

          <Section title={t("detailsTitle")} aside={<OptionalTag />}>
            <Field label={t("details")} htmlFor="copy-details">
              <Textarea
                id="copy-details"
                value={form.details}
                maxLength={3000}
                onChange={(e) => set("details", e.target.value)}
                placeholder={t("detailsPlaceholder")}
                className="h-28 min-h-28 resize-none rounded-lg bg-muted p-3 text-xs leading-[1.5] placeholder:text-subtle md:text-xs"
              />
            </Field>
            <Field label={t("keywords")} htmlFor="copy-keywords">
              <Input id="copy-keywords" value={form.keywords} maxLength={400} onChange={(e) => set("keywords", e.target.value)} placeholder={t("keywordsPlaceholder")} className="text-[13px] md:text-[13px]" />
            </Field>
          </Section>

          <Section title={t("style")}>
            <CopyStyleFields idPrefix="copy" value={form} brand={brand} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          </Section>
        </PanelBody>

        <PanelFooter
          cost={COPY_COST}
          submitLabel={t("write")}
          canSubmit={canSubmit}
          busy={pending}
          onReset={() => {
            setForm(initialState);
            setState({ kind: "empty" });
          }}
        />
      </ConfigPanel>

      <CopyCanvas
        state={state}
        recent={recent}
        onOpen={open}
        onRegenerate={write}
        onEditSettings={editSettings}
        onSave={save}
        rights={rights}
        onReviewed={reviewed}
        filter={filter}
        onFilter={setFilter}
      />
    </>
  );
}
