import "server-only";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/observability/report";
import { listMembershipsForUser, updateMemberIdentity } from "@/lib/team/members";
import { getClerkProfile } from "./clerk";
import { findUserByClerkId, findUserByEmail, normalizeEmail, updateUser } from "./users";

// Clerk profile changes (name, primary email) copied to our user row and its memberships, so Team,
// History and the console show the current name. Fed by the Clerk webhook (user.updated). The
// profile is re-read from Clerk rather than taken from the event, so late or repeated events
// still leave the latest values. An email only moves once it is verified and not used by
// another account.

export type ProfileSync = "updated" | "unchanged" | "unknown_user";

export async function syncClerkProfile(clerkUserId: string): Promise<ProfileSync> {
  const user = await findUserByClerkId(clerkUserId);
  if (!user) return "unknown_user"; // Never signed in here yet: linked on first sign-in.
  const profile = await getClerkProfile(clerkUserId);

  const name = profile.name.trim().slice(0, 80) || user.name;
  let email = user.email;
  if (profile.email) {
    const next = normalizeEmail(profile.email);
    const owner = next === user.email ? null : await findUserByEmail(next);
    if (owner && owner.id !== user.id) reportError("clerk email already used", new Error("email_taken"), { userId: user.id });
    else email = next;
  }
  if (name === user.name && email === user.email) return "unchanged";

  await updateUser(user.id, { name, email });
  for (const member of await listMembershipsForUser(user.id)) {
    try {
      await updateMemberIdentity(member.orgId, member.id, { name, email });
    } catch (error) {
      // The org already has an invitation for the new email (unique per org): keep the old one there.
      reportError("member profile sync failed", error, { orgId: member.orgId, userId: user.id });
      await updateMemberIdentity(member.orgId, member.id, { name });
    }
    await recordAudit({
      orgId: member.orgId,
      action: "member.profile_updated",
      actor: name,
      target: email,
      meta: { ...(name !== user.name ? { name: "changed" } : {}), ...(email !== user.email ? { email: "changed" } : {}), via: "clerk" },
    });
  }
  return "updated";
}
