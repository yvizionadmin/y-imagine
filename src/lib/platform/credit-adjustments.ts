import "server-only";
import { randomUUID } from "node:crypto";
import { desc, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { planCreditsFor, type CreditRules } from "@/lib/credits";
import type { Organization } from "@/lib/platform/organizations";
import { startOfMonth } from "@/lib/time";

// One-off credit grants (+) and deductions (−) a super admin makes for one org, for example a
// goodwill top-up. They count in the month they were made, on top of the plan's monthly credits.

export type CreditAdjustment = { id: string; amount: number; reason: string; actor: string; at: string };

const { creditAdjustments } = schema;

export const ADJUSTMENT_LIMIT = 1_000_000;

export async function addCreditAdjustment(orgId: string, input: { amount: number; reason: string; actor: string }) {
  const [row] = await db.forOrg(orgId).insert(creditAdjustments, { id: randomUUID(), ...input });
  return row as CreditAdjustment & { orgId: string };
}

export async function listCreditAdjustments(orgId: string, limit = 20): Promise<CreditAdjustment[]> {
  const rows = await db.forOrg(orgId).select(creditAdjustments, undefined, { orderBy: [desc(creditAdjustments.at)], limit });
  return rows.map(({ orgId: _org, ...row }) => (void _org, row));
}

/** Net credits added to an org since a date (negative when more was removed than added). */
export async function adjustmentTotal(orgId: string, since: Date) {
  const rows = await db.forOrg(orgId).select(creditAdjustments, gte(creditAdjustments.at, since.toISOString()));
  return rows.reduce((total, row) => total + row.amount, 0);
}

/** Credits an org can use this month: plan (or override) plus this month's adjustments, never below 0. */
export async function monthlyAllowance(org: Pick<Organization, "id" | "plan" | "creditsOverride">, rules: CreditRules, since = startOfMonth()) {
  return Math.max(0, planCreditsFor(rules, org) + (await adjustmentTotal(org.id, since)));
}

/** Net adjustment per org since a date, for every org (super-admin console only). */
export async function adjustmentTotalsByOrg(since: Date) {
  const rows = await db
    .select({ orgId: creditAdjustments.orgId, amount: creditAdjustments.amount })
    .from(creditAdjustments)
    .where(gte(creditAdjustments.at, since.toISOString()));
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.orgId, (totals.get(row.orgId) ?? 0) + row.amount);
  return totals;
}
