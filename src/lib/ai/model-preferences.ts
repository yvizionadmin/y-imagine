import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ModelFeature, ModelPreference } from "./models";

// Per-tool model choice (model_preferences). No row means "Automatic": the registry picks the best
// model for the tool from the org's connected keys.

const { modelPreferences } = schema;

export async function listModelPreferences(orgId: string): Promise<Partial<Record<ModelFeature, ModelPreference>>> {
  const rows = await db.forOrg(orgId).select(modelPreferences);
  return Object.fromEntries(rows.map((r) => [r.feature, { provider: r.provider, model: r.model }]));
}

export async function getModelPreference(orgId: string, feature: ModelFeature): Promise<ModelPreference | null> {
  const row = await db.forOrg(orgId).first(modelPreferences, eq(modelPreferences.feature, feature));
  return row ? { provider: row.provider, model: row.model } : null;
}

/** Sets or clears (null = Automatic) the model for one tool. */
export async function setModelPreference(orgId: string, feature: ModelFeature, preference: ModelPreference | null, actor: string) {
  const org = db.forOrg(orgId);
  if (!preference) {
    await org.delete(modelPreferences, eq(modelPreferences.feature, feature));
    return;
  }
  const values = { ...preference, updatedBy: actor, updatedAt: new Date().toISOString() };
  await db
    .insert(modelPreferences)
    .values({ orgId, feature, ...values })
    .onConflictDoUpdate({ target: [modelPreferences.orgId, modelPreferences.feature], set: values });
}
