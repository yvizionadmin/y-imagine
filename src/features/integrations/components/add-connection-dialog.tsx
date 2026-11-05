"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isFieldActive, type CatalogProduct, type ConnectorDefinition, type ConnectorField } from "@/lib/catalog/types";
import { createCatalogConnection, testCatalogSettings } from "../actions";
import { ConnectorIcon, ProductPreview } from "./connector-visuals";

type Values = Record<string, string>;

const initialValues = (definition: ConnectorDefinition): Values =>
  Object.fromEntries(definition.fields.map((f) => [f.key, f.defaultValue ?? ""]));

export function AddConnectionDialog({
  open,
  onOpenChange,
  definitions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definitions: ConnectorDefinition[];
  onCreated: () => void;
}) {
  const t = useTranslations("Integrations");
  const [definition, setDefinition] = useState<ConnectorDefinition | null>(null);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Values>({});
  const [sampleSku, setSampleSku] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [tested, setTested] = useState<CatalogProduct | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  function reset() {
    setDefinition(null);
    setValues({});
    setName("");
    setSampleSku("");
    setTested(null);
    setError(null);
  }

  function choose(next: ConnectorDefinition) {
    setDefinition(next);
    setValues(initialValues(next));
    setName(t(`connectors.${next.type}.label`));
    setSampleSku(next.type === "demo" ? "SOFA-12345" : "");
    setTested(null);
    setError(null);
  }

  function payload() {
    const fields = definition!.fields;
    return {
      type: definition!.type,
      config: Object.fromEntries(fields.filter((f) => f.kind !== "secret").map((f) => [f.key, values[f.key] ?? ""])),
      secrets: Object.fromEntries(fields.filter((f) => f.kind === "secret").map((f) => [f.key, values[f.key] ?? ""])),
    };
  }

  function showError(result: { error: string; field?: string }) {
    const message = t(`errors.${result.error}` as "errors.invalid_input");
    setError({ message, field: result.field });
  }

  async function test() {
    setBusy("test");
    setError(null);
    setTested(null);
    const result = await testCatalogSettings({ ...payload(), sampleSku });
    setBusy(null);
    if (result.ok) setTested(result.product);
    else showError(result);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const result = await createCatalogConnection({ ...payload(), name, sampleSku });
    setBusy(null);
    if (!result.ok) return showError(result);
    reset();
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-4rem)] gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {!definition ? (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-base font-bold">{t("chooseTitle")}</DialogTitle>
              <DialogDescription className="text-[13px]">{t("chooseBody")}</DialogDescription>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {definitions.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  onClick={() => choose(d)}
                  className="flex items-start gap-3 rounded-xl border p-3 text-start transition-colors hover:border-primary hover:bg-accent/50"
                >
                  <ConnectorIcon type={d.type} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">{t(`connectors.${d.type}.label`)}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{t(`connectors.${d.type}.description`)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="flex items-center gap-3 border-b px-6 py-4">
              <button type="button" aria-label={t("back")} onClick={reset} className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
              <ConnectorIcon type={definition.type} className="size-8" />
              <div className="flex min-w-0 flex-col">
                <DialogTitle className="text-[15px] font-bold">
                  {t("configureTitle", { platform: t(`connectors.${definition.type}.label`) })}
                </DialogTitle>
                <DialogDescription className="text-[11px]">{t(`connectors.${definition.type}.description`)}</DialogDescription>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <LabeledInput label={t("name")} id="connection-name" invalid={error?.field === "name"}>
                <Input
                  id="connection-name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={error?.field === "name" || undefined}
                  required
                />
              </LabeledInput>

              {definition.fields
                .filter((field) => isFieldActive(field, values))
                .map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ""}
                    invalid={error?.field === field.key}
                    onChange={(value) => {
                      setValues((v) => ({ ...v, [field.key]: value }));
                      setTested(null);
                    }}
                  />
                ))}

              <div className="flex flex-col gap-2 rounded-xl bg-muted p-3">
                <LabeledInput label={t("sampleSku")} id="sample-sku" invalid={error?.field === "sampleSku"}>
                  <div className="flex gap-2">
                    <Input
                      id="sample-sku"
                      value={sampleSku}
                      maxLength={64}
                      onChange={(e) => setSampleSku(e.target.value)}
                      placeholder={t("sampleSkuPlaceholder")}
                      className="bg-background font-mono"
                      aria-invalid={error?.field === "sampleSku" || undefined}
                    />
                    <Button type="button" variant="outline" onClick={test} disabled={busy !== null || !sampleSku.trim()} className="bg-background">
                      {busy === "test" && <Loader2 className="animate-spin" aria-hidden />}
                      {busy === "test" ? t("testing") : t("testConnection")}
                    </Button>
                  </div>
                </LabeledInput>
                {tested && <ProductPreview product={tested} />}
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-danger">
                  {error.message}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button type="submit" disabled={busy !== null}>
                {busy === "save" && <Loader2 className="animate-spin" aria-hidden />}
                {busy === "save" ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabeledInput({
  label,
  id,
  help,
  invalid,
  children,
}: {
  label: string;
  id: string;
  help?: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-invalid={invalid || undefined}>
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      {children}
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

function FieldInput({
  field,
  value,
  invalid,
  onChange,
}: {
  field: ConnectorField;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("Integrations");
  const id = `field-${field.key}`;
  const help = field.kind === "secret" ? t("secretHelp") : t(`fields.${field.key}.help` as "fields.token.help");
  const label = `${t(`fields.${field.key}.label` as "fields.token.label")}${field.required ? " *" : ""}`;

  return (
    <LabeledInput label={label} id={id} help={help || undefined} invalid={invalid}>
      {field.kind === "select" ? (
        <div className="relative">
          <select
            id={id}
            value={value}
            aria-invalid={invalid || undefined}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full appearance-none rounded-lg border bg-transparent ps-2.5 pe-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          >
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {t(`options.${option}` as "options.none")}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
        </div>
      ) : (
        <Input
          id={id}
          type={field.kind === "secret" ? "password" : field.kind === "url" ? "url" : "text"}
          autoComplete={field.kind === "secret" ? "new-password" : "off"}
          dir={field.kind === "text" && !field.key.endsWith("Path") ? undefined : "ltr"}
          value={value}
          maxLength={500}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={cn(field.kind !== "text" || field.key.endsWith("Path") ? "font-mono text-[13px]" : undefined)}
        />
      )}
    </LabeledInput>
  );
}
