import { randomUUID } from "node:crypto";
import { insertOrganization } from "@/lib/platform/organizations";
import { insertUser } from "@/lib/auth/users";
import { ensureMembership } from "@/lib/team/members";
import type { PlanId } from "@/lib/plans";

/** A fresh org with an admin user, unique per call (tests share one database). */
export async function makeOrg(plan: PlanId = "pro") {
  const tag = randomUUID().slice(0, 8);
  const org = await insertOrganization({ name: `Test Org ${tag}`, plan, createdBy: "test" });
  const user = await insertUser({ name: `Admin ${tag}`, email: `admin-${tag}@test.local`, password: "test-password-1", createdBy: "test" });
  await ensureMembership({ orgId: org.id, userId: user.id, name: user.name, email: user.email, role: "admin", invitedBy: null });
  return { org, user, actor: { orgId: org.id, user: { id: user.id, name: user.name } } };
}

export const uniqueEmail = (prefix = "user") => `${prefix}-${randomUUID().slice(0, 8)}@test.local`;
