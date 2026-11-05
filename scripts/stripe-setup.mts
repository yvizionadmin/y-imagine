// Creates (or reuses) the Stripe products and AED prices for the paid plans, and optionally the
// webhook endpoint, then prints the env lines to copy. Safe to re-run: prices are found by lookup key.
//
//   npm run stripe:setup                      (placeholder amounts below)
//   npm run stripe:setup -- --starter-monthly 199 --starter-yearly 1990 --pro-monthly 499 --pro-yearly 4990
//   npm run stripe:setup -- ... --webhook-url https://app.example.com/api/stripe/webhook
//
// Amounts are in AED (major units). Changing an amount creates a new price; the old one is archived,
// so re-running with real amounts later replaces the placeholders.
import { parseArgs } from "node:util";
import Stripe from "stripe";

const { values } = parseArgs({
  options: {
    // PLACEHOLDER prices until real pricing is decided (yearly = 10 × monthly).
    "starter-monthly": { type: "string", default: "99" },
    "starter-yearly": { type: "string", default: "990" },
    "pro-monthly": { type: "string", default: "299" },
    "pro-yearly": { type: "string", default: "2990" },
    currency: { type: "string", default: "aed" },
    "webhook-url": { type: "string" },
  },
});

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Set STRIPE_SECRET_KEY (in .env.local) first.");
const stripe = new Stripe(key);
const currency = values.currency!.toLowerCase();

const PLANS = [
  { plan: "starter", name: "Imagine AI Starter" },
  { plan: "pro", name: "Imagine AI Pro" },
] as const;

const env: string[] = [];
for (const { plan, name } of PLANS) {
  const found = await stripe.products.search({ query: `metadata['imagine_plan']:'${plan}'` });
  const product = found.data[0] ?? (await stripe.products.create({ name, metadata: { imagine_plan: plan } }));

  for (const interval of ["month", "year"] as const) {
    const arg = values[`${plan}-${interval === "month" ? "monthly" : "yearly"}`];
    if (!arg) continue;
    const amount = Math.round(Number(arg) * 100);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount for ${plan} ${interval}: ${arg}`);
    const lookupKey = `imagine_${plan}_${interval}`;
    const [existing] = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data;
    let price = existing;
    if (!existing || existing.unit_amount !== amount || existing.currency !== currency) {
      // transfer_lookup_key moves the key to the new price; the old one stops being sold.
      price = await stripe.prices.create({ product: product.id, currency, unit_amount: amount, recurring: { interval }, lookup_key: lookupKey, transfer_lookup_key: true });
      if (existing) await stripe.prices.update(existing.id, { active: false });
    }
    env.push(`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "YEARLY"}=${price.id}`);
  }
}

if (values["webhook-url"]) {
  const endpoint = await stripe.webhookEndpoints.create({
    url: values["webhook-url"],
    enabled_events: [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "invoice.paid",
      "invoice.payment_failed",
    ],
  });
  env.push(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
}

console.log("\nAdd these to the environment (.env.local / Railway web + worker):\n");
console.log(env.join("\n"));
console.log("\nLocally, forward webhooks with: stripe listen --forward-to localhost:3004/api/stripe/webhook\n");
