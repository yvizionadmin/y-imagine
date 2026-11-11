"use server";

import { trayFor, type TrayState } from "@/lib/tray";
import { getWorkspace } from "@/lib/workspace";

/** The top bar's jobs tray: the signed-in user's running and recently finished background work. Read only. */
export async function getTray(): Promise<TrayState> {
  const workspace = await getWorkspace({ read: true });
  return trayFor(workspace.orgId, workspace.user.id);
}
