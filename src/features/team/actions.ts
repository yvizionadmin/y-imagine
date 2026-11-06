"use server";

import { listAudit, recordAudit } from "@/lib/audit";
import { findUserByEmail } from "@/lib/auth/users";
import { getOrganization } from "@/lib/platform/organizations";
import { PLANS } from "@/lib/plans";
import { sendInvitationEmail } from "@/lib/team/invitations";
import { insertInvite, isRole, listMembers, removeMember, updateMember, type Member, type Role } from "@/lib/team/members";
import { startOfMonth } from "@/lib/time";
import { creditsOf, isJobBy, listUsage } from "@/lib/usage";
import { getWorkspace } from "@/lib/workspace";

export type MemberView = Omit<Member, "orgId" | "userId" | "invitedBy"> & {
  isYou: boolean;
  /** Credits used by successful jobs this calendar month in the org time zone. */
  creditsUsed: number;
  lastActiveAt: string | null;
};

type Failure = { ok: false; error: "forbidden" | "invalid_input" | "already_member" | "not_found" | "self" | "last_admin" | "seat_limit" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanDepartment = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "");

async function requireAdmin() {
  const workspace = await getWorkspace();
  return workspace.role === "admin" ? workspace : null;
}

export async function getTeam(): Promise<{ members: MemberView[]; departments: string[]; canManage: boolean }> {
  const workspace = await getWorkspace();
  const [members, usage] = await Promise.all([listMembers(workspace), listUsage(workspace.orgId)]);

  const monthStart = startOfMonth().toISOString();

  const views = members.map((member): MemberView => {
    const isYou = member.userId === workspace.user.id;
    const own = member.status === "active" ? usage.filter((e) => isJobBy(e, member)) : [];
    const latest = own.reduce<string | null>((max, j) => (!max || j.at > max ? j.at : max), null);
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      department: member.department,
      status: member.status,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      isYou,
      creditsUsed: creditsOf(own.filter((j) => j.at >= monthStart)),
      lastActiveAt: member.status === "invited" ? null : isYou ? new Date().toISOString() : latest,
    };
  });

  return {
    members: views,
    departments: [...new Set(members.map((m) => m.department).filter(Boolean))].sort(),
    canManage: workspace.role === "admin",
  };
}

export async function inviteMember(input: { email: string; role: string; department: string }): Promise<{ ok: true; emailed: boolean } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254 || !isRole(input.role)) return { ok: false, error: "invalid_input" };

  const members = await listMembers(workspace);
  if (members.some((m) => m.email.toLowerCase() === email)) return { ok: false, error: "already_member" };
  // Pending invitations take a seat too, so a plan can't be exceeded by inviting first.
  const org = await getOrganization(workspace.orgId);
  const seats = org ? PLANS[org.plan].seats : null;
  if (seats !== null && members.length >= seats) return { ok: false, error: "seat_limit" };

  await insertInvite({ orgId: workspace.orgId, email, role: input.role, department: cleanDepartment(input.department), invitedBy: workspace.user.name });
  // People who already have an account get the org on their next sign-in; the email says so.
  const emailed = await sendInvitationEmail({ email, orgName: workspace.orgName, inviter: workspace.user.name, role: input.role, hasAccount: !!(await findUserByEmail(email)) });
  await recordAudit({ orgId: workspace.orgId, action: "member.invited", actor: workspace.user.name, target: email, meta: { role: input.role } });
  return { ok: true, emailed };
}

async function editable(id: string) {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false as const, error: "forbidden" as const };
  const members = await listMembers(workspace);
  const member = members.find((m) => m.id === id);
  if (!member) return { ok: false as const, error: "not_found" as const };
  if (member.userId === workspace.user.id) return { ok: false as const, error: "self" as const };
  return { ok: true as const, workspace, member, members };
}

const isLastAdmin = (members: Member[], member: Member) =>
  member.role === "admin" && member.status === "active" && members.filter((m) => m.role === "admin" && m.status === "active").length === 1;

export async function changeMemberRole(id: string, role: Role): Promise<{ ok: true } | Failure> {
  if (!isRole(role)) return { ok: false, error: "invalid_input" };
  const found = await editable(id);
  if (!found.ok) return found;
  const { workspace, member, members } = found;
  if (member.role === role) return { ok: true };
  if (role !== "admin" && isLastAdmin(members, member)) return { ok: false, error: "last_admin" };

  await updateMember(workspace.orgId, id, { role });
  await recordAudit({ orgId: workspace.orgId, action: "member.role_changed", actor: workspace.user.name, target: member.email, meta: { from: member.role, to: role } });
  return { ok: true };
}

export async function changeMemberDepartment(id: string, department: string): Promise<{ ok: true } | Failure> {
  const workspace = await requireAdmin();
  if (!workspace) return { ok: false, error: "forbidden" };
  const updated = await updateMember(workspace.orgId, id, { department: cleanDepartment(department) });
  return updated ? { ok: true } : { ok: false, error: "not_found" };
}

/** Sends the invitation email again. `emailed` is false when no email transport is set up. */
export async function resendInvite(id: string): Promise<{ ok: true; emailed: boolean } | Failure> {
  const found = await editable(id);
  if (!found.ok) return found;
  const { workspace, member } = found;
  if (member.status !== "invited") return { ok: false, error: "invalid_input" };
  const emailed = await sendInvitationEmail({ email: member.email, orgName: workspace.orgName, inviter: workspace.user.name, role: member.role, hasAccount: !!(await findUserByEmail(member.email)) });
  await recordAudit({ orgId: workspace.orgId, action: "member.invite_resent", actor: workspace.user.name, target: member.email });
  return { ok: true, emailed };
}

export async function removeTeamMember(id: string): Promise<{ ok: true } | Failure> {
  const found = await editable(id);
  if (!found.ok) return found;
  const { workspace, member, members } = found;
  if (isLastAdmin(members, member)) return { ok: false, error: "last_admin" };
  await removeMember(workspace.orgId, id);
  await recordAudit({ orgId: workspace.orgId, action: "member.removed", actor: workspace.user.name, target: member.email, meta: { status: member.status } });
  return { ok: true };
}

export async function getTeamActivity() {
  const workspace = await getWorkspace();
  return listAudit(workspace.orgId, { prefix: "member.", limit: 10 });
}
