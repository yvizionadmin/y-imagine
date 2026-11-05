import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Workspace } from "@/lib/workspace";

// Org members and pending invitations (becomes Clerk organization memberships + invitations;
// `department` stays in our DB as org metadata).

export { isRole, ROLES, type Role } from "./roles";
import type { Role } from "./roles";

export type Member = {
  id: string;
  orgId: string;
  /** Null until an invitation is accepted. */
  userId: string | null;
  name: string;
  email: string;
  role: Role;
  department: string;
  status: "active" | "invited";
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const { members } = schema;
const oldestFirst = [asc(members.createdAt)];

export async function listMembers(workspace: Pick<Workspace, "orgId">): Promise<Member[]> {
  return db.forOrg(workspace.orgId).select(members, undefined, { orderBy: oldestFirst });
}

/** Every membership on the platform (super-admin console only). */
export async function listAllMembers(): Promise<Member[]> {
  return db.select().from(members).orderBy(...oldestFirst);
}

/** Active memberships of one user, oldest first (the first is the default org). */
export async function listMembershipsForUser(userId: string): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.status, "active")))
    .orderBy(...oldestFirst);
}

/** Adds an active member, or activates and updates an existing row for the same org + email. */
export async function ensureMembership(input: Pick<Member, "orgId" | "userId" | "name" | "email" | "role" | "invitedBy"> & { department?: string }): Promise<Member> {
  const email = input.email.toLowerCase();
  const org = db.forOrg(input.orgId);
  const match = input.userId ? or(eq(members.userId, input.userId), eq(sql`lower(${members.email})`, email)) : eq(sql`lower(${members.email})`, email);
  const existing = await org.first(members, match);
  if (existing) {
    const [row] = await org.update(members, { userId: input.userId, name: input.name, role: input.role, status: "active", updatedAt: new Date().toISOString() }, eq(members.id, existing.id));
    return row;
  }
  const [row] = await org.insert(members, {
    id: randomUUID(),
    userId: input.userId,
    name: input.name,
    email,
    role: input.role,
    department: input.department ?? "",
    status: "active",
    invitedBy: input.invitedBy,
  });
  return row;
}

/** Turns pending invitations for this email (any org) into active memberships. */
export async function acceptInvites(user: { id: string; name: string; email: string }) {
  await db
    .update(members)
    .set({ userId: user.id, name: user.name, status: "active", updatedAt: new Date().toISOString() })
    .where(and(eq(members.status, "invited"), eq(sql`lower(${members.email})`, user.email.toLowerCase())));
  return listMembershipsForUser(user.id);
}

export async function insertInvite(input: Pick<Member, "orgId" | "email" | "role" | "department" | "invitedBy">): Promise<Member> {
  const [row] = await db.forOrg(input.orgId).insert(members, {
    id: randomUUID(),
    userId: null,
    name: "",
    email: input.email.toLowerCase(),
    role: input.role,
    department: input.department,
    status: "invited",
    invitedBy: input.invitedBy,
  });
  return row;
}

export async function updateMember(orgId: string, id: string, patch: Partial<Pick<Member, "role" | "department">>): Promise<Member | null> {
  const [row] = await db.forOrg(orgId).update(members, { ...patch, updatedAt: new Date().toISOString() }, eq(members.id, id));
  return row ?? null;
}

export async function removeMember(orgId: string, id: string) {
  await db.forOrg(orgId).delete(members, eq(members.id, id));
}
