import "server-only";
import { appUrl } from "@/lib/app-url";
import { sendClerkInvitation } from "@/lib/auth/clerk";
import { clerkEnabled } from "@/lib/auth/constants";
import { requestEmailLocale, sendInviteEmail } from "@/lib/email/notify";
import { reportError } from "@/lib/observability/report";

// Invitation emails. The invitation itself is a `members` row (status "invited") that becomes an
// active membership when that email signs in; this only tells the person. New people with Clerk get
// Clerk's sign-up email (its ticket verifies the address); everyone else gets ours (sign-up link for
// the local login, sign-in link for an existing account) when an email transport is configured.

export type Invitation = { email: string; orgName: string; inviter: string; role: "admin" | "editor" | "viewer"; hasAccount: boolean };

/** Tells someone about a workspace invitation. Returns whether an email went out. */
export async function sendInvitationEmail(invitation: Invitation): Promise<boolean> {
  const locale = await requestEmailLocale();
  if (!invitation.hasAccount && clerkEnabled()) {
    try {
      await sendClerkInvitation(invitation.email, `${await appUrl()}/${locale}/sign-up`);
      return true;
    } catch (error) {
      // The membership row is what grants access; a failed email shouldn't undo the invite.
      reportError("invitation email failed", error, { code: (error as { errors?: { code?: string }[] }).errors?.[0]?.code ?? "unknown" });
      return false;
    }
  }
  try {
    const result = await sendInviteEmail({ to: invitation.email, orgName: invitation.orgName, inviter: invitation.inviter, role: invitation.role, hasAccount: invitation.hasAccount, locale });
    return result === "sent" || result === "outbox";
  } catch (error) {
    reportError("invitation email failed", error, {});
    return false;
  }
}
