import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PLANS, type BillingStatus, type PlanId } from "@/lib/plans";

// Tenants (becomes Clerk Organizations + this `organizations` table for plan/status). Platform
// scope: only the auth layer and the super-admin console read this list across orgs.

export type OrgStatus = "active" | "suspended";

export type Organization = {
  id: string;
  name: string;
  plan: PlanId;
  /** Replaces the plan's monthly job quota when set. */
  creditsOverride: number | null;
  status: OrgStatus;
  suspendedReason: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingStatus: BillingStatus | null;
  billingInterval: "month" | "year" | null;
  billingPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const { organizations } = schema;

const toOrganization = ({ roomBackgroundsSeeded, ...org }: typeof organizations.$inferSelect): Organization => (void roomBackgroundsSeeded, org);

export const creditsFor = (org: Pick<Organization, "plan" | "creditsOverride">) => org.creditsOverride ?? PLANS[org.plan].creditsMonthly;

export async function listOrganizations() {
  return (await db.select().from(organizations).orderBy(asc(organizations.createdAt))).map(toOrganization);
}

export async function getOrganization(id: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
  return row ? toOrganization(row) : null;
}

/** The org paying through a Stripe customer (webhooks without our metadata). */
export async function findOrganizationByCustomer(stripeCustomerId: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, stripeCustomerId));
  return row ? toOrganization(row) : null;
}

export async function insertOrganization(input: Pick<Organization, "name" | "plan" | "createdBy"> & { id?: string; creditsOverride?: number | null }) {
  const [row] = await db
    .insert(organizations)
    .values({ id: input.id ?? randomUUID(), name: input.name, plan: input.plan, creditsOverride: input.creditsOverride ?? null, createdBy: input.createdBy })
    .returning();
  return toOrganization(row);
}

export type BillingFields = Pick<Organization, "stripeCustomerId" | "stripeSubscriptionId" | "billingStatus" | "billingInterval" | "billingPeriodEnd" | "cancelAtPeriodEnd">;

export async function updateOrganization(id: string, patch: Partial<Pick<Organization, "name" | "plan" | "creditsOverride" | "status" | "suspendedReason"> & BillingFields>) {
  const [row] = await db
    .update(organizations)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(organizations.id, id))
    .returning();
  return row ? toOrganization(row) : null;
}
