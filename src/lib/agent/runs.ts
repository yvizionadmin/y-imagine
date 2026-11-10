import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { ProviderId } from "@/lib/ai/types";
import { db, schema } from "@/lib/db";
import { AGENT_RUNS_SHOWN, type AgentRun, type AgentRunStatus, type AgentRunSummary, type AgentStep } from "./limits";

// Agent runs (agent_runs). A tenant table (db.forOrg); a run also belongs to one user, and every
// read here takes that user, so nobody else in the org can open it.

const { agentRuns } = schema;

/** A run still `running` this long after its last change was cut off (a crash or a restart). */
export const STALE_RUN_MS = 15 * 60_000;

const toRun = ({ id, goal, status, steps, error, createdAt, finishedAt }: typeof agentRuns.$inferSelect): AgentRun => ({
  id,
  goal,
  status,
  steps,
  error: error ?? null,
  createdAt,
  finishedAt: finishedAt ?? null,
});

export async function createRun(orgId: string, userId: string, goal: string): Promise<AgentRun> {
  const [row] = await db.forOrg(orgId).insert(agentRuns, { id: randomUUID(), userId, goal });
  return toRun(row);
}

export async function getRun(orgId: string, userId: string, id: string): Promise<AgentRun | null> {
  const row = await db.forOrg(orgId).first(agentRuns, and(eq(agentRuns.userId, userId), eq(agentRuns.id, id)));
  return row ? toRun(row) : null;
}

/** The user's runs, newest first. */
export async function listRuns(orgId: string, userId: string, limit = AGENT_RUNS_SHOWN): Promise<AgentRunSummary[]> {
  const rows = await db.forOrg(orgId).select(agentRuns, eq(agentRuns.userId, userId), { orderBy: [desc(agentRuns.createdAt)], limit });
  return rows.map(({ id, goal, status, createdAt }) => ({ id, goal, status, createdAt }));
}

/** Saves the run's steps while it works. Only a running run changes (a closed one stays as it was). */
export async function saveSteps(orgId: string, id: string, steps: AgentStep[]) {
  await db.forOrg(orgId).update(agentRuns, { steps, updatedAt: new Date().toISOString() }, and(eq(agentRuns.id, id), eq(agentRuns.status, "running")));
}

export async function finishRun(
  orgId: string,
  id: string,
  outcome: { status: Exclude<AgentRunStatus, "running">; steps: AgentStep[]; error?: string | null; provider?: ProviderId | null; model?: string | null },
): Promise<AgentRun | null> {
  const now = new Date().toISOString();
  const [row] = await db.forOrg(orgId).update(
    agentRuns,
    { status: outcome.status, steps: outcome.steps, error: outcome.error ?? null, provider: outcome.provider ?? null, model: outcome.model ?? null, updatedAt: now, finishedAt: now },
    and(eq(agentRuns.id, id), eq(agentRuns.status, "running")),
  );
  return row ? toRun(row) : null;
}

/** Deletes a run (its copy and images stay in Copy and History). A running run can't be deleted. */
export async function deleteRun(orgId: string, userId: string, id: string): Promise<boolean> {
  const rows = await db.forOrg(orgId).delete(agentRuns, and(eq(agentRuns.userId, userId), eq(agentRuns.id, id), ne(agentRuns.status, "running")));
  return rows.length > 0;
}

/** Removes a run that failed before doing anything, so the goal can simply be sent again. */
export async function discardRun(orgId: string, id: string) {
  await db.forOrg(orgId).delete(agentRuns, eq(agentRuns.id, id));
}

/** Platform maintenance: closes runs left `running` by a crash or restart. Returns how many. */
export async function releaseStaleRuns() {
  const now = new Date().toISOString();
  const rows = await db
    .update(agentRuns)
    .set({ status: "failed", error: "timed_out", updatedAt: now, finishedAt: now })
    .where(and(eq(agentRuns.status, "running"), lt(agentRuns.updatedAt, new Date(Date.now() - STALE_RUN_MS).toISOString())))
    .returning({ id: agentRuns.id });
  return rows.length;
}
