import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { syncSubscription } from "@/lib/billing/billing";
import { billingEnabled, stripe } from "@/lib/billing/stripe";
import { db, schema } from "@/lib/db";
import { reportError } from "@/lib/observability/report";

// Stripe webhook (dashboard endpoint: /api/stripe/webhook). Verifies the signature on the raw body,
// then re-reads the subscription from Stripe rather than trusting the event's copy, so events that
// arrive out of order still leave the latest state. Applied events are recorded; repeats are skipped.

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function subscriptionOf(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as Record<string, unknown>;
  if (SUBSCRIPTION_EVENTS.has(event.type)) return object.id as string;
  if (event.type === "checkout.session.completed" && object.mode === "subscription") return object.subscription as string | null;
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const parent = object.parent as { subscription_details?: { subscription?: string | { id: string } } } | null;
    const sub = parent?.subscription_details?.subscription;
    return typeof sub === "string" ? sub : (sub?.id ?? null);
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!billingEnabled() || !secret) return new Response("Billing is not configured", { status: 404 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const [seen] = await db.select({ id: schema.stripeEvents.id }).from(schema.stripeEvents).where(eq(schema.stripeEvents.id, event.id));
  if (seen) return Response.json({ received: true, duplicate: true });

  const subscriptionId = subscriptionOf(event);
  if (subscriptionId) {
    try {
      await syncSubscription(await stripe().subscriptions.retrieve(subscriptionId));
    } catch (error) {
      // 500 makes Stripe retry later.
      reportError("stripe webhook failed", error, { type: event.type, id: event.id });
      return new Response("Sync failed", { status: 500 });
    }
  }
  await db.insert(schema.stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
  return Response.json({ received: true });
}
