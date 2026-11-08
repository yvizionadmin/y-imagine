"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, Loader2, Plus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ConnectionView } from "@/lib/catalog/connections";
import type { CatalogProduct, ConnectorDefinition } from "@/lib/catalog/types";
import {
  deleteCatalogConnection,
  getCatalogIntegrations,
  setImageApproval,
  makeDefaultCatalogConnection,
  retestCatalogConnection,
} from "../actions";
import { AddConnectionDialog } from "./add-connection-dialog";
import { ConnectorIcon, ProductPreview } from "./connector-visuals";

type State = { connections: ConnectionView[]; definitions: ConnectorDefinition[]; canManage: boolean; imageApprovalRequired: boolean };

export function IntegrationsSettings() {
  const t = useTranslations("Integrations");
  const [state, setState] = useState<State | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => setState(await getCatalogIntegrations()), []);
  const [savingApproval, setSavingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState(false);

  async function saveApproval(required: boolean) {
    setSavingApproval(true);
    setApprovalError(false);
    const result = await setImageApproval(required);
    if (result.ok) await refresh();
    else setApprovalError(true);
    setSavingApproval(false);
  }
  useEffect(() => {
    getCatalogIntegrations().then(setState);
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("description")}</p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border bg-background p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-bold">{t("catalogs")}</h3>
            <p className="text-xs text-muted-foreground">{t("catalogsHint")}</p>
          </div>
          {state?.canManage && (
            <Button onClick={() => setAdding(true)} className="shrink-0">
              <Plus aria-hidden />
              {t("add")}
            </Button>
          )}
        </div>

        {state && !state.canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{t("readOnly")}</p>}

        {!state ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </div>
        ) : state.connections.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center">
            <p className="text-sm font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-sm text-xs text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.connections.map((connection) => (
              <ConnectionCard key={connection.id} connection={connection} canManage={state.canManage} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      {state && (
        <section className="flex flex-col gap-3 rounded-2xl border bg-background p-4 md:p-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-bold">{t("approvalTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("approvalHint")}</p>
          </div>
          <label className="flex items-start gap-2.5 rounded-xl border p-3">
            <Checkbox
              checked={state.imageApprovalRequired}
              disabled={!state.canManage || savingApproval}
              onCheckedChange={(checked) => saveApproval(checked === true)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{t("approvalToggle")}</span>
              <span className="text-[11px] text-muted-foreground">{t("approvalDetail")}</span>
            </span>
          </label>
          {approvalError && (
            <p role="alert" className="text-xs text-danger">
              {t("approvalError")}
            </p>
          )}
        </section>
      )}

      {state && (
        <AddConnectionDialog open={adding} onOpenChange={setAdding} definitions={state.definitions} onCreated={refresh} />
      )}
    </div>
  );
}

function ConnectionCard({
  connection,
  canManage,
  onChanged,
}: {
  connection: ConnectionView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("Integrations");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [testing, setTesting] = useState(false);
  const [sku, setSku] = useState(connection.type === "demo" ? "SOFA-12345" : "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CatalogProduct | null>(null);

  const summary = t(`connectors.${connection.type}.summary`, connection.config);
  const last = connection.lastTest;

  async function runTest() {
    setBusy(true);
    setResult(null);
    const response = await retestCatalogConnection(connection.id, sku);
    setBusy(false);
    if (response.ok) setResult(response.product);
    onChanged();
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <ConnectorIcon type={connection.type} />
        {/* Narrow screens: the buttons wrap under the details instead of squeezing them. */}
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{connection.name}</span>
            {connection.isDefault && (
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">{t("default")}</span>
            )}
          </div>
          <span className="truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
            {t(`connectors.${connection.type}.label`)} · {summary}
            {Object.values(connection.secretHints).length > 0 && ` · ${Object.values(connection.secretHints).join(" ")}`}
          </span>
          <span className="flex items-center gap-1 text-[11px]">
            {!last ? (
              <>
                <CircleDashed className="size-3.5 text-subtle" aria-hidden />
                <span className="text-muted-foreground">{t("statusNever")}</span>
              </>
            ) : last.ok ? (
              <>
                <CircleCheck className="size-3.5 text-emerald-500" aria-hidden />
                <span className="text-emerald-700">{t("statusOk", { when: format.relativeTime(new Date(last.at), now) })}</span>
              </>
            ) : (
              <>
                <CircleAlert className="size-3.5 text-[#ef4444]" aria-hidden />
                <span className="text-danger">{t("statusError", { error: t(`errors.${last.error ?? "bad_response"}`) })}</span>
              </>
            )}
          </span>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setTesting((v) => !v)} aria-expanded={testing}>
              {t("test")}
            </Button>
            {!connection.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await makeDefaultCatalogConnection(connection.id);
                  onChanged();
                }}
              >
                {t("makeDefault")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-[#ef4444] hover:text-[#ef4444]"
              onClick={async () => {
                if (!window.confirm(t("removeConfirm", { name: connection.name }))) return;
                await deleteCatalogConnection(connection.id);
                onChanged();
              }}
            >
              {t("remove")}
            </Button>
          </div>
        )}
      </div>

      {testing && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (sku.trim()) runTest();
            }}
          >
            <Input
              value={sku}
              maxLength={64}
              onChange={(e) => setSku(e.target.value)}
              placeholder={t("sampleSkuPlaceholder")}
              aria-label={t("sampleSku")}
              className="bg-background font-mono"
            />
            <Button type="submit" variant="outline" className="bg-background" disabled={busy || !sku.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {busy ? t("testing") : t("test")}
            </Button>
          </form>
          {result && <ProductPreview product={result} />}
        </div>
      )}
    </li>
  );
}
