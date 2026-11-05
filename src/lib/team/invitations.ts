import "server-only";
import { getLocale } from "next-intl/server";
import { appUrl } from "@/lib/app-url";
import { sendClerkInvitation } from "@/lib/auth/clerk";
import { clerkEnabled } from "@/lib/auth/constants";
import { reportError } from "@/lib/observability/report";

// Invitation emails. The invitation itself is a `members` row (status "invited") that becomes an
// active membership when that email signs in; this only tells the person. Clerk sends the email
// (its sign-up link carries a ticket, so the address arrives verified). The local login sends none.

/** Emails a sign-up link to someone without an account. Returns whether an email went out. */
export async function sendInvitationEmail(email: string) {
  if (!clerkEnabled()) return false;
  try {
    await sendClerkInvitation(email, `${await appUrl()}/${await getLocale()}/sign-up`);
    return true;
  } catch (error) {
    // The membership row is what grants access; a failed email shouldn't undo the invite.
    reportError("invitation email failed", error, { code: (error as { errors?: { code?: string }[] }).errors?.[0]?.code ?? "unknown" });
    return false;
  }
}
