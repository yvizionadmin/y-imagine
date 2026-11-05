"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { BRAND_LIMITS, EMPTY_BRAND_KIT, type BrandKit } from "@/lib/brand/limits";
import { getBrandKitSettings, saveBrandKit } from "../actions";

type State = Awaited<ReturnType<typeof getBrandKitSettings>>;
type Form = Omit<BrandKit, "useWords" | "avoidWords"> & { useWords: string; avoidWords: string };

// Typed text follows its own script (Latin names in the Arabic UI); empty fields keep the page direction for placeholders.
const textDir = (value: string) => (value ? "auto" : undefined);
// Word lists are typed as one comma-separated line (Arabic commas too).
const toList = (text: string) => text.split(/[,،\n]/).map((w) => w.trim()).filter(Boolean);
const toForm = (kit: BrandKit | null): Form => {
  const k = kit ?? EMPTY_BRAND_KIT;
  return { name: k.name, about: k.about, voice: k.voice, audience: k.audience, useWords: k.useWords.join(", "), avoidWords: k.avoidWords.join(", "), rules: k.rules };
};

/**
 * Brand kit: how the org's product copy should sound. No Figma frame exists for this screen, so it
 * follows the API Keys settings layout. The Copy tool uses it when "Use brand kit" is on.
 */
export function BrandKitSettings() {
  const t = useTranslations("BrandKit");
  const format = useFormatter();
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<"saved" | "removed" | "error" | null>(null);

  const load = () =>
    getBrandKitSettings().then((s) => {
      setState(s);
      setForm(toForm(s.kit));
    });
  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  };

  async function submit(kit: Form | null) {
    setBusy(kit ? "save" : "remove");
    setNotice(null);
    const input = kit ? { ...kit, useWords: toList(kit.useWords), avoidWords: toList(kit.avoidWords) } : EMPTY_BRAND_KIT;
    const result = await saveBrandKit(input);
    setBusy(null);
    setConfirmRemove(false);
    if (!result.ok) return setNotice("error");
    setNotice(result.kit ? "saved" : "removed");
    await load();
  }

  const readOnly = !state?.canManage;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          {t.rich("description", { link: (chunks) => <Link href="/copy" className="font-semibold text-primary hover:underline">{chunks}</Link> })}
        </p>
      </div>

      {state && readOnly && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}

      {!state ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <>
          <form
            className="flex flex-col gap-5 rounded-2xl border bg-background p-6"
            onSubmit={(e) => {
              e.preventDefault();
              submit(form);
            }}
          >
            <fieldset disabled={readOnly || busy !== null} className="grid gap-5 md:grid-cols-2">
              <KitField id="brand-name" label={t("name")} hint={t("nameHint")}>
                <Input dir={textDir(form.name)} id="brand-name" value={form.name} maxLength={BRAND_LIMITS.name} onChange={(e) => set("name", e.target.value)} placeholder={t("namePlaceholder")} />
              </KitField>
              <KitField id="brand-audience" label={t("audience")} hint={t("audienceHint")}>
                <Input dir={textDir(form.audience)} id="brand-audience" value={form.audience} maxLength={BRAND_LIMITS.audience} onChange={(e) => set("audience", e.target.value)} placeholder={t("audiencePlaceholder")} />
              </KitField>
              <KitField id="brand-about" label={t("about")} hint={t("aboutHint")} count={[form.about.length, BRAND_LIMITS.about]} wide>
                <Textarea dir={textDir(form.about)} id="brand-about" rows={3} value={form.about} maxLength={BRAND_LIMITS.about} onChange={(e) => set("about", e.target.value)} placeholder={t("aboutPlaceholder")} />
              </KitField>
              <KitField id="brand-voice" label={t("voice")} hint={t("voiceHint")} count={[form.voice.length, BRAND_LIMITS.voice]} wide>
                <Textarea dir={textDir(form.voice)} id="brand-voice" rows={2} value={form.voice} maxLength={BRAND_LIMITS.voice} onChange={(e) => set("voice", e.target.value)} placeholder={t("voicePlaceholder")} />
              </KitField>
              <KitField id="brand-use" label={t("useWords")} hint={t("wordsHint", { max: BRAND_LIMITS.words })}>
                <Input dir={textDir(form.useWords)} id="brand-use" value={form.useWords} onChange={(e) => set("useWords", e.target.value)} placeholder={t("useWordsPlaceholder")} />
              </KitField>
              <KitField id="brand-avoid" label={t("avoidWords")} hint={t("wordsHint", { max: BRAND_LIMITS.words })}>
                <Input dir={textDir(form.avoidWords)} id="brand-avoid" value={form.avoidWords} onChange={(e) => set("avoidWords", e.target.value)} placeholder={t("avoidWordsPlaceholder")} />
              </KitField>
              <KitField id="brand-rules" label={t("rules")} hint={t("rulesHint")} count={[form.rules.length, BRAND_LIMITS.rules]} wide>
                <Textarea dir={textDir(form.rules)} id="brand-rules" rows={4} value={form.rules} maxLength={BRAND_LIMITS.rules} onChange={(e) => set("rules", e.target.value)} placeholder={t("rulesPlaceholder")} />
              </KitField>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground" role="status">
                {notice === "saved" ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-700">
                    <Check className="size-3.5" aria-hidden />
                    {t("saved")}
                  </span>
                ) : notice === "removed" ? (
                  t("removed")
                ) : notice === "error" ? (
                  <span className="text-danger">{t("error")}</span>
                ) : state.kit ? (
                  t("lastUpdated", { actor: state.kit.updatedBy, at: format.dateTime(new Date(state.kit.updatedAt), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }) })
                ) : (
                  t("empty")
                )}
              </p>
              {!readOnly && (
                <div className="flex gap-2">
                  {state.kit &&
                    (confirmRemove ? (
                      <>
                        <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy !== null}>
                          {t("cancel")}
                        </Button>
                        <Button type="button" variant="destructive" onClick={() => submit(null)} disabled={busy !== null}>
                          {busy === "remove" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                          {t("confirmRemove")}
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
                        {t("remove")}
                      </Button>
                    ))}
                  <Button type="submit" disabled={busy !== null}>
                    {busy === "save" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {t("save")}
                  </Button>
                </div>
              )}
            </div>
          </form>

          <section className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
            <h3 className="text-[15px] font-bold">{t("activityTitle")}</h3>
            {state.activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noActivity")}</p>
            ) : (
              <ul className="flex flex-col divide-y text-[12px]">
                {state.activity.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-4 py-2">
                    <span>{t(e.action === "brand_kit.removed" ? "audit.removed" : "audit.updated", { actor: e.actor })}</span>
                    <time dateTime={e.at} className="shrink-0 text-[11px] text-muted-foreground">
                      {format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function KitField({ id, label, hint, count, wide, children }: { id: string; label: string; hint: string; count?: [number, number]; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "flex flex-col gap-1.5 md:col-span-2" : "flex flex-col gap-1.5"}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold">
          {label}
        </label>
        {count && <span className="text-[11px] text-muted-foreground tabular-nums">{`${count[0]}/${count[1]}`}</span>}
      </div>
      {children}
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
