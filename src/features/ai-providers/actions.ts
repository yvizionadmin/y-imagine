"use server";

import { listAudit, recordAudit, type AuditEntry } from "@/lib/audit";
import { listModelPreferences, setModelPreference } from "@/lib/ai/model-preferences";
import { describeImageModel, type ImageModelEntry } from "@/lib/ai/image-model-info";
import { IMAGE_PROVIDERS, isModelFeature, MODEL_FEATURES, modelsFor, providersFor, type ModelFeature, type ModelPreference } from "@/lib/ai/models";
import { listKeyModels, listProviderKeys, recordKeyCheck, removeProviderKey, revealProviderKey, saveProviderKey, type ProviderKeyView } from "@/lib/ai/provider-keys";
import { isAiProvider, type AiProviderId, type KeyError } from "@/lib/ai/providers-info";
import { checkProviderKey } from "@/lib/ai/validate-key";
import { hit, LIMITS } from "@/lib/rate-limit";
import { getWorkspace } from "@/lib/workspace";

type Failure = { ok: false; error: "forbidden" | "invalid_input" | "not_found" | KeyError };

const KEY_SHAPE = /^[A-Za-z0-9._\-]{16,300}$/;

async function requireAdmin() {
  const workspace = await getWorkspace();
  return workspace.role === "admin" ? workspace : null;
}

export type ModelOptions = Record<ModelFeature, Partial<Record<AiProviderId, string[]>>>;

/** Per tool: the models each connected (valid) key can call for it, best first. */
async function modelOptions(orgId: string): Promise<ModelOptions> {
  const keyModels = await listKeyModels(orgId);
  return Object.fromEntries(
    MODEL_FEATURES.map((feature) => [
      feature,
      Object.fromEntries(
        providersFor(feature)
          .filter((p) => p in keyModels)
          .map((p) => [p, modelsFor(feature, p, keyModels[p] ?? null)])
          .filter(([, models]) => models.length),
      ),
    ]),
  ) as ModelOptions;
}

export async function getProviderKeys(): Promise<{
  keys: ProviderKeyView[];
  activity: AuditEntry[];
  canManage: boolean;
  demo: boolean;
  models: ModelOptions;
  preferences: Partial<Record<ModelFeature, ModelPreference>>;
}> {
  const workspace = await getWorkspace();
  const [keys, activity, models, preferences] = await Promise.all([
    listProviderKeys(workspace.orgId),
    listAudit(workspace.orgId, { prefix: "provider_", limit: 10 }),
    modelOptions(workspace.orgId),
    listModelPreferences(workspace.orgId),
  ]);
  return { keys, activity, canManage: workspace.role === "admin", demo: process.env.IMAGINE_DEMO === "1", models, preferences };
}

/**
 * The image models the org's keys can call for the Studio ("create"), for the rail's AI Image menu.
 * `inUse` marks the one Studio images run on: the tool's chosen model, else Automatic's first pick.
 */
export async function getImageModelMenu(): Promise<{ models: ImageModelEntry[]; canManage: boolean }> {
  const workspace = await getWorkspace();
  const [options, preferences] = await Promise.all([modelOptions(workspace.orgId), listModelPreferences(workspace.orgId)]);
  const byProvider = options.create;
  const automatic = IMAGE_PROVIDERS.find((p) => byProvider[p]?.length);
  const current = preferences.create ?? (automatic ? { provider: automatic, model: byProvider[automatic]![0] } : null);
  const models = IMAGE_PROVIDERS.flatMap((provider) =>
    (byProvider[provider] ?? []).map((model) => describeImageModel(provider, model, current?.provider === provider && current.model === model)),
  );
  return { models, canManage: workspace.role === "admin" };
}

/** Picks the model for one tool; null goes back to Automatic. Only models a connected key can call. */
export async function setToolModel(feature: string, preference: ModelPreference | null): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!isModelFeature(feature)) return { ok: false, error: "invalid_input" };
  if (preference) {
    if (!isAiProvider(preference.provider) || typeof preference.model !== "string") return { ok: false, error: "invalid_input" };
    const options = (await modelOptions(workspace.orgId))[feature][preference.provider];
    if (!options?.includes(preference.model)) return { ok: false, error: "invalid_input" };
  }
  const value = preference ? { provider: preference.provider, model: preference.model } : null;
  await setModelPreference(workspace.orgId, feature, value, workspace.user.name);
  await recordAudit({
    orgId: workspace.orgId,
    action: "provider_model.changed",
    actor: workspace.user.name,
    target: feature,
    meta: { model: value ? `${value.provider}/${value.model}` : "auto" },
  });
  return { ok: true };
}

/** Validates first and only stores keys the provider accepts. Saving over an existing key rotates it. */
export async function saveKey(provider: string, rawKey: string): Promise<{ ok: true; key: ProviderKeyView } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!isAiProvider(provider) || !KEY_SHAPE.test(key)) return { ok: false, error: "invalid_input" };
  // Each check calls the provider; don't let the form become a key-testing service.
  if (!(await hit("key-checks", workspace.orgId, LIMITS.keyChecksPerOrg)).ok) return { ok: false, error: "rate_limited" };

  const check = await checkProviderKey(provider, key);
  if (!check.ok) return check;

  const existed = (await listProviderKeys(workspace.orgId)).some((k) => k.provider === provider);
  const saved = await saveProviderKey({ orgId: workspace.orgId, provider, key, models: check.models, createdBy: workspace.user.name });
  await recordAudit({
    orgId: workspace.orgId,
    action: existed ? "provider_key.rotated" : "provider_key.added",
    actor: workspace.user.name,
    target: provider,
    meta: { hint: saved.hint },
  });
  return { ok: true, key: saved };
}

export async function revalidateKey(provider: string): Promise<{ ok: true; key: ProviderKeyView } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!isAiProvider(provider)) return { ok: false, error: "invalid_input" };
  const key = await revealProviderKey(workspace.orgId, provider);
  if (!key) return { ok: false, error: "not_found" };
  if (!(await hit("key-checks", workspace.orgId, LIMITS.keyChecksPerOrg)).ok) return { ok: false, error: "rate_limited" };

  const check = await checkProviderKey(provider, key);
  const view = await recordKeyCheck(workspace.orgId, provider, check);
  await recordAudit({
    orgId: workspace.orgId,
    action: "provider_key.validated",
    actor: workspace.user.name,
    target: provider,
    meta: { result: check.ok ? "valid" : check.error },
  });
  return view ? { ok: true, key: view } : { ok: false, error: "not_found" };
}

export async function deleteKey(provider: string): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  if (!isAiProvider(provider)) return { ok: false, error: "invalid_input" };
  const existing = (await listProviderKeys(workspace.orgId)).find((k) => k.provider === provider);
  if (!existing) return { ok: false, error: "not_found" };
  await removeProviderKey(workspace.orgId, provider);
  await recordAudit({ orgId: workspace.orgId, action: "provider_key.removed", actor: workspace.user.name, target: provider, meta: { hint: existing.hint } });
  return { ok: true };
}
