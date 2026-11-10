"use server";

import type { AgentRun, AgentRunSummary } from "@/lib/agent/limits";
import { deleteRun, getRun, listRuns } from "@/lib/agent/runs";
import { getWorkspace } from "@/lib/workspace";

// Runs are private to the user who started them (inside the current org). Starting one is the
// /api/agent route (streamed); these read and tidy the list. Viewers can read their runs.

/** The user's runs, and whether they can start one (viewers and a read-only org view can't). */
export async function getAgentState(): Promise<{ runs: AgentRunSummary[]; canRun: boolean }> {
  const workspace = await getWorkspace({ read: true });
  return { runs: await listRuns(workspace.orgId, workspace.user.id), canRun: workspace.role !== "viewer" && !workspace.viewAs };
}

export async function openAgentRun(id: string): Promise<AgentRun | null> {
  const workspace = await getWorkspace({ read: true });
  if (typeof id !== "string" || id.length > 64) return null;
  return getRun(workspace.orgId, workspace.user.id, id);
}

export async function deleteAgentRun(id: string): Promise<{ ok: boolean }> {
  const workspace = await getWorkspace();
  if (workspace.role === "viewer" || typeof id !== "string" || id.length > 64) return { ok: false };
  return { ok: await deleteRun(workspace.orgId, workspace.user.id, id) };
}
