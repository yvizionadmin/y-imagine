import "server-only";
import { db, schema } from "@/lib/db";
import { listProviderKeys } from "@/lib/ai/provider-keys";
import { listConnections } from "@/lib/catalog/connections";
import { listMembers } from "@/lib/team/members";

export type SetupStep = "key" | "image" | "store" | "team";
export type SetupChecklist = { steps: Record<SetupStep, boolean> };

/** Home's first-run checklist (U6): what a new org has set up so far. Read only. */
export async function setupChecklist(orgId: string): Promise<SetupChecklist> {
  const [keys, image, stores, members] = await Promise.all([
    listProviderKeys(orgId),
    db.forOrg(orgId).first(schema.generations),
    listConnections(orgId),
    listMembers({ orgId }),
  ]);
  return { steps: { key: keys.length > 0, image: Boolean(image), store: stores.length > 0, team: members.length > 1 } };
}
