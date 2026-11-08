"use server";

import {
  insertConnection,
  listConnections,
  loadConnection,
  recordTest,
  removeConnection,
  setDefaultConnection,
  type ConnectionView,
} from "@/lib/catalog/connections";
import { runLookup, type LookupError } from "@/lib/catalog/lookup";
import { availableDefinitions, isConnectorType, validateSettings } from "@/lib/catalog/registry";
import type { CatalogProduct, ConnectorDefinition } from "@/lib/catalog/types";
import { recordAudit } from "@/lib/audit";
import { imageApprovalRequired, setImageApprovalRequired } from "@/lib/generations";
import { getWorkspace } from "@/lib/workspace";

type SettingsInput = { type: string; config: Record<string, unknown>; secrets: Record<string, unknown> };
type Failure = { ok: false; error: "forbidden" | "invalid_input" | LookupError; field?: string };

async function requireAdmin() {
  const workspace = await getWorkspace();
  return workspace.role === "admin" ? workspace : null;
}

const cleanSku = (sku: unknown) => (typeof sku === "string" ? sku.trim().slice(0, 64) : "");

export async function getCatalogIntegrations(): Promise<{
  connections: ConnectionView[];
  definitions: ConnectorDefinition[];
  canManage: boolean;
  imageApprovalRequired: boolean;
}> {
  const workspace = await getWorkspace();
  return {
    connections: await listConnections(workspace.orgId),
    definitions: availableDefinitions(),
    canManage: workspace.role === "admin",
    imageApprovalRequired: await imageApprovalRequired(workspace.orgId),
  };
}

/** Try unsaved settings against a real SKU before saving them. */
export async function testCatalogSettings(input: SettingsInput & { sampleSku: string }): Promise<{ ok: true; product: CatalogProduct } | Failure> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  if (!isConnectorType(input.type)) return { ok: false, error: "invalid_input", field: "type" };
  const sku = cleanSku(input.sampleSku);
  if (!sku) return { ok: false, error: "invalid_input", field: "sampleSku" };
  const valid = validateSettings(input.type, input);
  if (!valid.ok) return { ok: false, error: "invalid_input", field: valid.field };
  return runLookup(input.type, valid.settings, sku);
}

export async function createCatalogConnection(
  input: SettingsInput & { name: string; sampleSku?: string },
): Promise<{ ok: true; connection: ConnectionView } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!isConnectorType(input.type)) return { ok: false, error: "invalid_input", field: "type" };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) return { ok: false, error: "invalid_input", field: "name" };
  const valid = validateSettings(input.type, input);
  if (!valid.ok) return { ok: false, error: "invalid_input", field: valid.field };

  const sku = cleanSku(input.sampleSku);
  const test = sku ? await runLookup(input.type, valid.settings, sku) : null;
  const connection = await insertConnection({
    orgId: workspace.orgId,
    type: input.type,
    name,
    settings: valid.settings,
    createdBy: workspace.user.name,
    lastTest: test ? { ok: test.ok, at: new Date().toISOString(), error: test.ok ? undefined : test.error } : null,
  });
  return { ok: true, connection };
}

export async function retestCatalogConnection(id: string, sampleSku: string): Promise<{ ok: true; product: CatalogProduct } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  const sku = cleanSku(sampleSku);
  const loaded = await loadConnection(workspace.orgId, id);
  if (!loaded || !sku) return { ok: false, error: "invalid_input" };
  const result = await runLookup(loaded.connection.type, loaded.settings, sku);
  await recordTest(workspace.orgId, id, { ok: result.ok, at: new Date().toISOString(), error: result.ok ? undefined : result.error });
  return result;
}

export async function deleteCatalogConnection(id: string): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  await removeConnection(workspace.orgId, id);
  return { ok: true };
}

export async function makeDefaultCatalogConnection(id: string): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  await setDefaultConnection(workspace.orgId, id);
  return { ok: true };
}

/** Turns the publish gate on or off: with it on, only approved images can be uploaded to the store. */
export async function setImageApproval(required: boolean): Promise<{ ok: true } | { ok: false; error: "forbidden" }> {
  const workspace = await getWorkspace();
  if (workspace.role !== "admin") return { ok: false, error: "forbidden" };
  await setImageApprovalRequired(workspace.orgId, required === true);
  await recordAudit({ orgId: workspace.orgId, action: "org.image_approval_changed", actor: workspace.user.name, target: required === true ? "on" : "off" });
  return { ok: true };
}
