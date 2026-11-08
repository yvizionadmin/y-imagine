"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, CircleCheck, CircleDashed, ExternalLink, KeyRound, Loader2, Minus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProviderKeyView } from "@/lib/ai/provider-keys";
import { isModelFeature, providersFor, type ModelFeature, type ModelPreference } from "@/lib/ai/models";
import { AI_PROVIDERS, CAPABILITIES, FEATURE_NEEDS, PROVIDER_INFO, type AiProviderId } from "@/lib/ai/providers-info";
import { LATN } from "@/lib/format";
import { deleteKey, getProviderKeys, revalidateKey, saveKey, setToolModel } from "../actions";

type State = Awaited<ReturnType<typeof getProviderKeys>>;

/**
 * AI provider keys (BYOK). No Figma frame exists for this screen (only the "API Keys" item in the
 * settings nav of 30:430), so it follows the Integrations settings layout.
 */
export function ProviderKeysSettings() {
  const t = useTranslations("AiProviders");
  const [state, setState] = useState<State | null>(null);

  const refresh = () => getProviderKeys().then(setState);
  useEffect(() => {
    getProviderKeys().then(setState);
  }, []);

  const keys = new Map((state?.keys ?? []).map((k) => [k.provider, k]));
  const usable = (provider: AiProviderId) => keys.get(provider)?.status === "valid";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="max-w-2xl text-[13px] text-muted-foreground">{t("description")}</p>
      </div>

      {state?.demo && <p className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground">{t("demoNotice")}</p>}
      {state && !state.canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}

      {!state ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2">
            {AI_PROVIDERS.map((provider) => (
              <ProviderCard key={provider} provider={provider} stored={keys.get(provider) ?? null} canManage={state.canManage} onChanged={refresh} />
            ))}
          </ul>

          <section className="flex flex-col gap-3 rounded-2xl border bg-background p-4 md:p-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-[15px] font-bold">{t("coverageTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("coverageHint")}</p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-[11px] font-semibold text-muted-foreground uppercase">
                <tr className="border-b">
                  <th scope="col" className="py-2 text-start">{t("feature")}</th>
                  <th scope="col" className="py-2 text-start">{t("needs")}</th>
                  <th scope="col" className="py-2 text-start">{t("servedBy")}</th>
                  <th scope="col" className="py-2 text-start">{t("model")}</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(FEATURE_NEEDS) as (keyof typeof FEATURE_NEEDS)[]).map((feature) => {
                  const need = FEATURE_NEEDS[feature];
                  const providers = AI_PROVIDERS.filter((p) => usable(p) && PROVIDER_INFO[p].capabilities.includes(need));
                  return (
                    <tr key={feature} className="border-b last:border-b-0">
                      <td className="py-2.5 font-semibold">{t(`features.${feature}`)}</td>
                      <td className="py-2.5 text-muted-foreground">{t(`capabilities.${need}`)}</td>
                      <td className="py-2.5">
                        {providers.length ? (
                          <span className="flex flex-wrap gap-1.5">
                            {providers.map((p) => (
                              <span key={p} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                {t(`providers.${p}.name`)}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-amber-700">{t("noProvider")}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {isModelFeature(feature) ? (
                          <ModelSelect feature={feature} state={state} onChanged={refresh} />
                        ) : (
                          <Minus className="size-3.5 text-muted-foreground" aria-label={t("notApplicable")} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>

          <ActivityList entries={state.activity} />
        </>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  stored,
  canManage,
  onChanged,
}: {
  provider: AiProviderId;
  stored: ProviderKeyView | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("AiProviders");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const info = PROVIDER_INFO[provider];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    const response = await saveKey(provider, value);
    setBusy(null);
    if (!response.ok) return setError(t(`errors.${response.error}`, { provider: t(`providers.${provider}.name`) }));
    setValue("");
    setEditing(false);
    onChanged();
  }

  async function check() {
    setBusy("check");
    setError(null);
    const response = await revalidateKey(provider);
    setBusy(null);
    if (!response.ok) setError(t(`errors.${response.error}`, { provider: t(`providers.${provider}.name`) }));
    onChanged();
  }

  async function remove() {
    if (!window.confirm(t("removeConfirm", { provider: t(`providers.${provider}.name`) }))) return;
    setBusy("delete");
    const response = await deleteKey(provider);
    setBusy(null);
    if (!response.ok) setError(t(`errors.${response.error}`, { provider: t(`providers.${provider}.name`) }));
    onChanged();
  }

  return (
    <li className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-extrabold">
          {t(`providers.${provider}.name`).slice(0, 1)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-bold">{t(`providers.${provider}.name`)}</h3>
          <p className="text-[11px] text-muted-foreground">{t(`providers.${provider}.blurb`)}</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label={t("capabilitiesLabel")}>
        {CAPABILITIES.map((c) => {
          const has = info.capabilities.includes(c);
          return (
            <li
              key={c}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                has ? "border-primary/30 bg-accent text-primary" : "text-subtle line-through decoration-subtle/60",
              )}
            >
              {has ? <Check className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
              {t(`capabilities.${c}`)}
              <span className="sr-only">{has ? t("supported") : t("notSupported")}</span>
            </li>
          );
        })}
      </ul>
      {provider === "openrouter" && <p className="-mt-2 text-[11px] text-muted-foreground">{t("openrouterNote")}</p>}

      <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-[12px]">
        {!stored ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CircleDashed className="size-3.5" aria-hidden />
            {t("notConnected")}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              {stored.status === "valid" ? (
                <CircleCheck className="size-3.5 text-emerald-500" aria-hidden />
              ) : (
                <CircleAlert className="size-3.5 text-[#ef4444]" aria-hidden />
              )}
              <span className={stored.status === "valid" ? "font-semibold text-emerald-700" : "font-semibold text-danger"}>
                {t(`status.${stored.status}`)}
              </span>
              <span className="font-mono text-muted-foreground" dir="ltr">
                {stored.hint}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {/* Clamped so a server clock slightly ahead of the browser never reads "in 1 second". */}
              {t("checked", { when: format.relativeTime(new Date(Math.min(Date.parse(stored.validatedAt), now.getTime())), now) })}
              {stored.modelCount !== null && ` · ${t("models", { count: stored.modelCount, display: format.number(stored.modelCount, LATN) })}`}
            </span>
            {stored.lastError && stored.lastError !== "invalid_key" && (
              <span className="text-[11px] text-amber-700">{t(`errors.${stored.lastError}`, { provider: t(`providers.${provider}.name`) })}</span>
            )}
          </>
        )}
      </div>

      {canManage && editing && (
        <form onSubmit={save} className="flex flex-col gap-2">
          <label htmlFor={`key-${provider}`} className="text-[11px] font-semibold text-muted-foreground">
            {stored ? t("newKey") : t("apiKey")}
          </label>
          <Input
            id={`key-${provider}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`${info.keyPrefix}…`}
            className="h-10 font-mono text-[13px]"
          />
          <a href={info.consoleUrl} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-[11px] font-semibold text-primary">
            {t("getKey", { provider: t(`providers.${provider}.name`) })}
            <ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden />
          </a>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null || value.trim().length === 0}>
              {busy === "save" && <Loader2 className="animate-spin" aria-hidden />}
              {busy === "save" ? t("validating") : t("saveAndValidate")}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}

      {canManage && !editing && (
        <div className="mt-auto flex flex-wrap gap-2">
          <Button size="sm" variant={stored ? "outline" : "default"} onClick={() => setEditing(true)}>
            <KeyRound aria-hidden />
            {stored ? t("rotate") : t("add")}
          </Button>
          {stored && (
            <>
              <Button size="sm" variant="outline" onClick={check} disabled={busy !== null}>
                {busy === "check" && <Loader2 className="animate-spin" aria-hidden />}
                {t("revalidate")}
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null} className="ms-auto text-danger hover:bg-red-50 hover:text-danger">
                {t("remove")}
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** "Automatic" resolves like the registry: the first connected provider for the tool, its best model. */
function automaticModel(feature: ModelFeature, options: State["models"][ModelFeature]): ModelPreference | null {
  for (const provider of providersFor(feature)) {
    const model = options[provider]?.[0];
    if (model) return { provider, model };
  }
  return null;
}

function ModelSelect({ feature, state, onChanged }: { feature: ModelFeature; state: State; onChanged: () => void }) {
  const t = useTranslations("AiProviders");
  const [saving, setSaving] = useState(false);
  const chosen = state.preferences[feature] ?? null;
  // A saved choice whose key was since removed or rejected: the registry falls back to Automatic.
  const options = state.models[feature];
  const stale = chosen !== null && !options[chosen.provider]?.includes(chosen.model);
  const auto = automaticModel(feature, options);
  const providerName = (p: AiProviderId) => t(`providers.${p}.name`);
  const autoLabel = auto ? t("automaticWith", { model: `${providerName(auto.provider)} · ${auto.model}` }) : t("automaticDemo");

  if (!state.canManage) {
    const label = chosen && !stale ? `${providerName(chosen.provider)} · ${chosen.model}` : autoLabel;
    return <span className="text-[12px] text-muted-foreground">{label}</span>;
  }

  async function change(value: string) {
    setSaving(true);
    const [provider, ...model] = value.split("/");
    // A refused choice means the options were stale (a key changed meanwhile); reloading shows the current ones.
    await setToolModel(feature, value === "auto" ? null : ({ provider, model: model.join("/") } as ModelPreference));
    setSaving(false);
    onChanged();
  }

  return (
    <span className="flex items-center gap-2">
      <select
        aria-label={t("modelFor", { feature: t(`features.${feature}`) })}
        value={chosen && !stale ? `${chosen.provider}/${chosen.model}` : "auto"}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        className="h-8 max-w-64 rounded-lg border bg-background px-2 text-[12px] outline-none focus-visible:border-ring disabled:opacity-60"
      >
        <option value="auto">{autoLabel}</option>
        {providersFor(feature).filter((p) => options[p]?.length).map((p) => (
          <optgroup key={p} label={providerName(p)}>
            {options[p]!.map((model) => (
              <option key={model} value={`${p}/${model}`}>
                {model}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
    </span>
  );
}

function ActivityList({ entries }: { entries: State["activity"] }) {
  const t = useTranslations("AiProviders");
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
      <h3 className="text-[15px] font-bold">{t("activityTitle")}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noActivity")}</p>
      ) : (
        <ul className="flex flex-col divide-y text-[12px]">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 py-2">
              <span>
                {e.action === "provider_model.changed"
                  ? t("audit.modelChanged", {
                      actor: e.actor,
                      feature: t(`features.${e.target as ModelFeature}`),
                      model: e.meta?.model === "auto" ? t("automatic") : (e.meta?.model ?? ""),
                    })
                  : t(`audit.${e.action.split(".")[1] as "added"}`, {
                  actor: e.actor,
                  provider: t(`providers.${e.target as AiProviderId}.name`),
                  hint: e.meta?.hint ?? "",
                  result: e.meta?.result ? t(e.meta.result === "valid" ? "status.valid" : `errors.${e.meta.result as "invalid_key"}`, { provider: t(`providers.${e.target as AiProviderId}.name`) }) : "",
                    })}
              </span>
              <time dateTime={e.at} className="shrink-0 text-[11px] text-muted-foreground">
                {format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
