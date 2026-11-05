import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Feature, ProviderId } from "@/lib/ai/types";

// One row per provider job (usage_events). Written by the registry, so every feature is covered
// without call sites doing anything. Feeds Analytics and the credit quota. A job is inserted as
// `running` before the provider call, which reserves its credit, and finished afterwards.

export type UsageEvent = {
  id: string;
  orgId: string;
  feature: Feature;
  /** Null for jobs recorded before user ids were stored. */
  userId: string | null;
  userName: string;
  provider: ProviderId;
  model: string | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
  at: string;
};

const { usageEvents } = schema;

/** A `running` row older than this is a crashed job and no longer holds a credit. */
const STALE_RUNNING_MS = 15 * 60 * 1000;

type Row = typeof usageEvents.$inferSelect;
const toEvent = ({ status, ...row }: Row): UsageEvent => ({ ...row, ok: status === "ok" });

/** Rows that count against the quota: successful jobs, plus jobs still running. */
const holdsCredit = () =>
  or(eq(usageEvents.status, "ok"), and(eq(usageEvents.status, "running"), gte(usageEvents.at, new Date(Date.now() - STALE_RUNNING_MS).toISOString())));

/**
 * Reserves one credit and records the job as running. Serialised per org with an advisory lock,
 * so parallel jobs can't overshoot the quota. Returns null when the quota is used up.
 */
export async function startJob(input: { orgId: string; feature: Feature; userId: string; userName: string; provider: ProviderId; quota: number; since: Date }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`usage:${input.orgId}`}))`);
    const [{ n }] = await tx
      .select({ n: count() })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, input.orgId), gte(usageEvents.at, input.since.toISOString()), holdsCredit()));
    if (n >= input.quota) return null;
    const id = randomUUID();
    await db.forOrg(input.orgId, tx).insert(usageEvents, {
      id,
      feature: input.feature,
      userId: input.userId,
      userName: input.userName,
      provider: input.provider,
      status: "running",
    });
    return id;
  });
}

export async function finishJob(orgId: string, id: string, outcome: { ok: boolean; error: string | null; model: string | null; durationMs: number }) {
  await db.forOrg(orgId).update(
    usageEvents,
    { status: outcome.ok ? "ok" : "error", error: outcome.error, model: outcome.model, durationMs: outcome.durationMs },
    eq(usageEvents.id, id),
  );
}

/**
 * Marks `running` rows past the stale limit as failed (`timed_out`): the process died mid-job (deploy,
 * crash). They already stopped holding a credit; this keeps Analytics and Monitoring honest.
 * Platform scope (all orgs), run by the worker. Returns how many rows were closed.
 */
export async function releaseStaleJobs() {
  const rows = await db
    .update(usageEvents)
    .set({ status: "error", error: "timed_out" })
    .where(and(eq(usageEvents.status, "running"), lt(usageEvents.at, new Date(Date.now() - STALE_RUNNING_MS).toISOString())))
    .returning({ id: usageEvents.id });
  return rows.length;
}

/** Successful jobs since a date (the credit badge). */
export async function countSuccessfulJobs(orgId: string, since: Date) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.status, "ok"), gte(usageEvents.at, since.toISOString())));
  return n;
}

/** Finished jobs, oldest first. */
export async function listUsage(orgId: string, since?: Date) {
  const rows = await db
    .forOrg(orgId)
    .select(usageEvents, and(ne(usageEvents.status, "running"), since ? gte(usageEvents.at, since.toISOString()) : undefined), { orderBy: [asc(usageEvents.at)] });
  return rows.map(toEvent);
}

/** Every org's finished jobs (super-admin console only). */
export async function listAllUsage(since?: Date) {
  const rows = await db
    .select()
    .from(usageEvents)
    .where(and(ne(usageEvents.status, "running"), since ? gte(usageEvents.at, since.toISOString()) : undefined))
    .orderBy(asc(usageEvents.at));
  return rows.map(toEvent);
}

/** Groups jobs by person: the user id, or the display name for rows recorded before ids existed. */
export const creatorKey = (e: Pick<UsageEvent, "userId" | "userName">) => e.userId ?? `name:${e.userName}`;

/** Whether a job was run by this member (by user id, falling back to the name for old rows). */
export const isJobBy = (e: Pick<UsageEvent, "userId" | "userName">, member: { userId: string | null; name: string }) =>
  e.userId ? e.userId === member.userId : e.userName === member.name;
