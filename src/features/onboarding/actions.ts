"use server";

import { setupChecklist, type SetupChecklist } from "@/lib/onboarding";
import { getWorkspace } from "@/lib/workspace";

export type SetupState = SetupChecklist & { orgId: string; isAdmin: boolean };

/** The org's first-run checklist for Home. Read only; only admins can do the key, store and team steps. */
export async function getSetupChecklist(): Promise<SetupState> {
  const workspace = await getWorkspace({ read: true });
  return { ...(await setupChecklist(workspace.orgId)), orgId: workspace.orgId, isAdmin: workspace.role === "admin" && !workspace.viewAs };
}
