import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Organization } from "@/lib/platform/organizations";
import { makeOrg } from "../helpers";

// Billing against a local Stripe stub (form-encoded requests in, JSON out) via STRIPE_API_URL.

const PRICES = { starterM: "price_starter_m", proM: "price_pro_m", proY: "price_pro_y" };
type Call = { method: string; path: string; body: URLSearchParams; idem?: string };
const calls: Call[] = [];
const subs = new Map<string, Record<string, unknown>>();
const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
let server: Server;

function sub(id: string, customer: string, price: string, status: string, extra: Record<string, unknown> = {}) {
  const s = { object: "subscription", id, customer, status, cancel_at_period_end: false, metadata: {}, items: { object: "list", data: [{ object: "subscription_item", id: `si_${id}`, price: { object: "price", id: price }, current_period_end: periodEnd }] }, ...extra };
  subs.set(id, s);
  return s;
}

let billing: typeof import("@/lib/billing/billing");
let stripeMod: typeof import("@/lib/billing/stripe");
let orgs: typeof import("@/lib/platform/organizations");
let webhook: typeof import("@/app/api/stripe/webhook/route");
let audit: typeof import("@/lib/audit");

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const body = new URLSearchParams(raw);
      calls.push({ method: req.method!, path: url.pathname, body, idem: req.headers["idempotency-key"] as string | undefined });
      const send = (obj: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      let m: RegExpMatchArray | null;
      if (req.method === "POST" && url.pathname === "/v1/customers") return send({ object: "customer", id: `cus_${calls.length}` });
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") return send({ object: "checkout.session", id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
      if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") return send({ object: "billing_portal.session", id: "bps_1", url: "https://billing.stripe.test/p" });
      if ((m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
        const s = subs.get(m[1]);
        if (!s) return send({ error: { type: "invalid_request_error", message: "No such subscription" } }, 404);
        if (req.method === "POST") {
          if (body.get("cancel_at_period_end")) s.cancel_at_period_end = body.get("cancel_at_period_end") === "true";
          const price = body.get("items[0][price]");
          if (price) (s.items as { data: { price: { id: string } }[] }).data[0].price.id = price;
        }
        return send(s);
      }
      if ((m = url.pathname.match(/^\/v1\/prices\/([^/]+)$/))) return send({ object: "price", id: m[1], active: true, unit_amount: m[1].includes("pro") ? 29900 : 9900, currency: "aed" });
      send({ error: { type: "invalid_request_error", message: `not stubbed ${url.pathname}` } }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  vi.stubEnv("STRIPE_API_URL", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_stub");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_stub");
  vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", PRICES.starterM);
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", PRICES.proM);
  vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", PRICES.proY);
  billing = await import("@/lib/billing/billing");
  stripeMod = await import("@/lib/billing/stripe");
  orgs = await import("@/lib/platform/organizations");
  webhook = await import("@/app/api/stripe/webhook/route");
  audit = await import("@/lib/audit");
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

const get = async (id: string) => (await orgs.getOrganization(id)) as Organization;
const returnUrl = "https://app.test/en/settings/billing";

async function signed(type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const header = stripeMod.stripe().webhooks.generateTestHeaderString({ payload, secret: "whsec_test_stub" });
  return webhook.POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
}

describe("Stripe billing", () => {
  it("loads AED display prices for configured plans", async () => {
    const prices = await stripeMod.planPrices();
    expect(prices.starter?.month).toEqual({ amount: 9900, currency: "aed" });
    expect(prices.pro?.year?.amount).toBe(29900);
    expect(prices.starter?.year).toBeUndefined();
  });

  it("full lifecycle: checkout with trial → webhook → switch → cancel/resume → past_due → canceled → resubscribe", async () => {
    const { org } = await makeOrg("free");

    const url = await billing.createCheckout({ org: await get(org.id), plan: "starter", interval: "month", email: "a@test.local", returnUrl });
    expect(url).toBe("https://checkout.stripe.test/cs_1");
    const customer = calls.find((c) => c.path === "/v1/customers")!;
    expect(customer.idem).toBe(`customer:${org.id}`);
    const session = calls.find((c) => c.path === "/v1/checkout/sessions")!.body;
    expect(Object.fromEntries(session)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": PRICES.starterM,
      "subscription_data[trial_period_days]": "14",
      "subscription_data[metadata][orgId]": org.id,
      success_url: `${returnUrl}?checkout=success`,
    });
    const customerId = (await get(org.id)).stripeCustomerId!;
    expect(customerId).toMatch(/^cus_/);

    // Webhook: bad signature, then checkout completed.
    const bad = await webhook.POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } }));
    expect(bad.status).toBe(400);
    const subId = `sub_${org.id}`;
    sub(subId, customerId, PRICES.starterM, "trialing", { metadata: { orgId: org.id } });
    const eventId = `evt_${crypto.randomUUID()}`;
    expect((await signed("checkout.session.completed", { object: "checkout.session", mode: "subscription", subscription: subId }, eventId)).status).toBe(200);
    expect(await get(org.id)).toMatchObject({ plan: "starter", billingStatus: "trialing", stripeSubscriptionId: subId, billingInterval: "month" });
    expect((await audit.listAudit(org.id, { prefix: "billing.plan_changed" }))[0]).toMatchObject({ actor: "Stripe", meta: { to: "starter" } });
    expect(await (await signed("checkout.session.completed", { object: "checkout.session", mode: "subscription", subscription: subId }, eventId)).json()).toMatchObject({ duplicate: true });

    // Switch plans now, prorated.
    await billing.changePlan(await get(org.id), "pro", "year");
    const update = calls.filter((c) => c.method === "POST" && c.path === `/v1/subscriptions/${subId}`).at(-1)!.body;
    expect(Object.fromEntries(update)).toMatchObject({ "items[0][id]": `si_${subId}`, "items[0][price]": PRICES.proY, proration_behavior: "create_prorations" });
    expect(await get(org.id)).toMatchObject({ plan: "pro", billingInterval: "year" });

    await billing.setCancelAtPeriodEnd(await get(org.id), true);
    expect(await get(org.id)).toMatchObject({ cancelAtPeriodEnd: true, plan: "pro" });
    await billing.setCancelAtPeriodEnd(await get(org.id), false);
    expect((await get(org.id)).cancelAtPeriodEnd).toBe(false);

    subs.get(subId)!.status = "past_due";
    await signed("invoice.payment_failed", { object: "invoice", parent: { subscription_details: { subscription: subId } } });
    expect(await get(org.id)).toMatchObject({ plan: "pro", billingStatus: "past_due" });

    subs.get(subId)!.status = "canceled";
    await signed("customer.subscription.deleted", subs.get(subId)!);
    expect(await get(org.id)).toMatchObject({ plan: "free", stripeSubscriptionId: null, billingStatus: "canceled" });

    // Resubscribe: no second trial, same customer; a late event for the old subscription changes nothing.
    calls.length = 0;
    await billing.createCheckout({ org: await get(org.id), plan: "pro", interval: "month", email: "a@test.local", returnUrl });
    expect(calls.find((c) => c.path === "/v1/checkout/sessions")!.body.has("subscription_data[trial_period_days]")).toBe(false);
    expect(calls.some((c) => c.path === "/v1/customers")).toBe(false);
    await billing.syncSubscription(sub(`${subId}_2`, customerId, PRICES.proM, "active") as never);
    await billing.syncSubscription(subs.get(subId) as never);
    expect(await get(org.id)).toMatchObject({ plan: "pro", stripeSubscriptionId: `${subId}_2` });
  });

  it("subscription metadata can't take over an org that pays with another customer", async () => {
    const { org } = await makeOrg("free");
    await orgs.updateOrganization(org.id, { stripeCustomerId: `cus_owner_${org.id}` });
    await billing.syncSubscription(sub(`sub_attack_${org.id}`, "cus_attacker", PRICES.proM, "active", { metadata: { orgId: org.id } }) as never);
    expect(await get(org.id)).toMatchObject({ plan: "free", stripeSubscriptionId: null });
  });

  it("webhook is off without Stripe configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await webhook.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(404);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_stub");
  });
});
