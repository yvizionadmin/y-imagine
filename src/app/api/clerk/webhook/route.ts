import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { clerkEnabled } from "@/lib/auth/constants";
import { syncClerkProfile } from "@/lib/auth/profile-sync";
import { reportError } from "@/lib/observability/report";

// Clerk webhook (dashboard endpoint: /api/clerk/webhook, event `user.updated`). The signature is
// checked with CLERK_WEBHOOK_SIGNING_SECRET; the profile itself is then re-read from Clerk.

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!clerkEnabled() || !signingSecret) return new Response("Clerk webhooks are not configured", { status: 404 });

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (event.type !== "user.updated" || !event.data.id) return new Response(null, { status: 204 });

  try {
    await syncClerkProfile(event.data.id);
  } catch (error) {
    // 500 makes Clerk retry later.
    reportError("clerk profile sync failed", error, {});
    return new Response("Sync failed", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
