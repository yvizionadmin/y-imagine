import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertConnection } from "@/lib/catalog/connections";
import { createMagentoConnector } from "@/lib/catalog/connectors/magento";
import { createShopifyConnector } from "@/lib/catalog/connectors/shopify";
import { claimForPublish, releaseStalePublishes, runPublish, STALE_PUBLISH_MS } from "@/lib/catalog/publish";
import { db, schema } from "@/lib/db";
import { getGenerations, insertGeneration } from "@/lib/generations";
import { saveAsset } from "@/lib/storage/assets";
import type { Workspace } from "@/lib/workspace";
import { eq } from "drizzle-orm";
import { makeOrg } from "../helpers";

// B8: real store uploads, with Shopify's and Magento's APIs stubbed at the network (the SSRF guard
// still runs; DNS answers a public address). One queued job per image, never uploaded twice.

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
let workspace: Workspace;
const queued: string[] = [];
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => workspace }));
vi.mock("@/lib/catalog/publish-queue", () => ({ dispatchPublishes: async (_o: string, ids: string[]) => void queued.push(...ids) }));

const history = await import("@/features/history/actions");

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[] = [];
type Responder = (call: Call, operation: string) => Response;
let respond: Responder;

beforeEach(() => {
  calls = [];
  queued.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body };
    calls.push(call);
    const operation = typeof call.body === "string" ? (/(?:query|mutation) (\w+)/.exec(JSON.parse(call.body).query ?? "")?.[1] ?? "") : "";
    return respond(call, operation);
  });
});
afterEach(() => vi.unstubAllGlobals());

const gql = (data: unknown, extra: Record<string, unknown> = {}) => Response.json({ data, ...extra });
const variables = (call: Call) => JSON.parse(call.body as string).variables;
const STAGED = { url: "https://shopify-staged-uploads.storage.googleapis.com/", resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/1/sofa.jpg", parameters: [{ name: "key", value: "tmp/1/sofa.jpg" }, { name: "policy", value: "abc" }] };

/** A store that answers the whole upload flow; `media` statuses are returned one per check. */
function shopify(options: { statuses?: string[]; stageErrors?: unknown[]; attachErrors?: unknown[]; product?: boolean } = {}): Responder {
  const statuses = [...(options.statuses ?? ["UPLOADED", "PROCESSING", "READY"])];
  return (call, operation) => {
    if (call.url.startsWith(STAGED.url)) return new Response('<?xml version="1.0"?><PostResponse><Key>tmp/1/sofa.jpg</Key></PostResponse>', { status: 201, headers: { "content-type": "application/xml" } });
    if (operation === "ProductId") return gql({ productVariants: { nodes: options.product === false ? [] : [{ product: { id: "gid://shopify/Product/7" } }] } });
    if (operation === "Stage") return gql({ stagedUploadsCreate: { stagedTargets: options.stageErrors?.length ? [] : [STAGED], userErrors: options.stageErrors ?? [] } });
    if (operation === "Attach") {
      return gql({ productUpdate: { product: { id: "gid://shopify/Product/7", media: { nodes: [{ id: "gid://shopify/MediaImage/99", status: statuses.shift() }] } }, userErrors: options.attachErrors ?? [] } });
    }
    if (operation === "MediaStatus") return gql({ node: { id: "gid://shopify/MediaImage/99", status: statuses.shift() ?? "READY", mediaErrors: [] } });
    return new Response("unexpected", { status: 500 });
  };
}

const shopifySettings = { config: { shopDomain: "acme-test.myshopify.com", apiVersion: "2026-07", arabicTranslations: "no" }, secrets: { accessToken: "shpat_test" } };
const image = { bytes: new Uint8Array([255, 216, 255, 224, 1, 2, 3]), mimeType: "image/jpeg", filename: "SOFA_lifestyle_ab.jpg", alt: "Grey sofa in a living room" };

describe("Shopify upload", () => {
  it("stages the file, attaches it with productUpdate and waits for Shopify to process it", async () => {
    respond = shopify();
    const result = await createShopifyConnector(shopifySettings, { mediaChecksMs: [0, 0, 0] }).publishImage!("SOFA-1", image);
    expect(result).toEqual({ ref: "gid://shopify/MediaImage/99" });

    const [lookup, stage, upload, attach, ...checks] = calls;
    expect(lookup.url).toBe("https://acme-test.myshopify.com/admin/api/2026-07/graphql.json");
    expect(lookup.headers.get("x-shopify-access-token")).toBe("shpat_test");
    expect(variables(stage).input).toEqual([{ resource: "IMAGE", filename: "SOFA_lifestyle_ab.jpg", mimeType: "image/jpeg", httpMethod: "POST", fileSize: "7" }]);
    // The signed fields first, the file last, as the storage requires; its XML answer is fine.
    const form = upload.body as FormData;
    expect([...form.keys()]).toEqual(["key", "policy", "file"]);
    expect((form.get("file") as File).type).toBe("image/jpeg");
    expect(JSON.parse(attach.body as string).query).toContain("productUpdate(product: $product, media: $media)");
    expect(variables(attach)).toEqual({ product: { id: "gid://shopify/Product/7" }, media: [{ originalSource: STAGED.resourceUrl, mediaContentType: "IMAGE", alt: "Grey sofa in a living room" }] });
    expect(checks.map((c) => variables(c).id)).toEqual(["gid://shopify/MediaImage/99", "gid://shopify/MediaImage/99"]);
  });

  it("maps every failure to a stable code", async () => {
    const connector = createShopifyConnector(shopifySettings, { mediaChecksMs: [0, 0] });
    respond = shopify({ product: false });
    await expect(connector.publishImage!("NOPE", image)).rejects.toMatchObject({ code: "not_found" });
    respond = shopify({ stageErrors: [{ field: ["input"], message: "Invalid mime type" }] });
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "media_rejected" });
    respond = shopify({ attachErrors: [{ field: ["media"], message: "Image is too large" }] });
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "media_rejected" });
    respond = shopify({ statuses: ["PROCESSING", "FAILED"] });
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "media_rejected" });
    respond = () => gql(null, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "rate_limited" });
    respond = () => new Response("Unauthorized", { status: 401 });
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "auth_failed" });
    // The storage refusing the signed upload isn't the store's token being rejected: it's this image that failed.
    respond = (call, op) => (call.url.startsWith(STAGED.url) ? new Response("<Error>AccessDenied</Error>", { status: 403 }) : shopify()(call, op));
    await expect(connector.publishImage!("SOFA-1", image)).rejects.toMatchObject({ code: "media_rejected" });
  });

  it("still processing after the checks counts as uploaded (Shopify finishes it)", async () => {
    respond = shopify({ statuses: ["UPLOADED", "PROCESSING", "PROCESSING"] });
    expect(await createShopifyConnector(shopifySettings, { mediaChecksMs: [0, 0] }).publishImage!("SOFA-1", image)).toEqual({ ref: "gid://shopify/MediaImage/99" });
  });
});

describe("Magento upload", () => {
  const magento = () => createMagentoConnector({ config: { baseUrl: "https://shop.example.com" }, secrets: { accessToken: "mage-token" } });

  it("posts the image to the product's media gallery and keeps the entry id", async () => {
    respond = () => Response.json("345");
    expect(await magento().publishImage!("SOFA/1", image)).toEqual({ ref: "345" });
    const [call] = calls;
    expect(call.url).toBe("https://shop.example.com/rest/all/V1/products/SOFA%2F1/media");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer mage-token");
    const entry = JSON.parse(call.body as string).entry;
    expect(entry).toMatchObject({ media_type: "image", label: "Grey sofa in a living room", disabled: false, content: { type: "image/jpeg", name: "SOFA_lifestyle_ab.jpg" } });
    expect(Buffer.from(entry.content.base64_encoded_data, "base64")).toEqual(Buffer.from(image.bytes));
  });

  it("maps a missing product, a refused token and throttling", async () => {
    respond = () => new Response(JSON.stringify({ message: "The product that was requested doesn't exist." }), { status: 404 });
    await expect(magento().publishImage!("NOPE", image)).rejects.toMatchObject({ code: "not_found" });
    respond = () => new Response("{}", { status: 401 });
    await expect(magento().publishImage!("SOFA", image)).rejects.toMatchObject({ code: "auth_failed" });
    respond = () => new Response("{}", { status: 429 });
    await expect(magento().publishImage!("SOFA", image)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("queued uploads from History", () => {
  async function setup(withStore = true) {
    const made = await makeOrg();
    workspace = { orgId: made.org.id, orgName: made.org.name, role: "admin", plan: made.org.plan, user: { id: made.user.id, name: made.user.name, email: made.user.email }, isSuperAdmin: false, orgs: [], creditsMonthly: 500, creditsRemaining: 500 };
    if (withStore) await insertConnection({ orgId: made.org.id, type: "shopify", name: "Acme Shopify", settings: shopifySettings, createdBy: "t", lastTest: null });
    const png = new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", "sofa-grey-base.png")));
    const assetId = await saveAsset(made.org.id, png, "image/png", "generation");
    const generation = await insertGeneration({ orgId: made.org.id, mode: "lifestyle", sku: "SOFA-1", title: "Grey sofa", assetId, mimeType: "image/png", width: 1200, height: 800, settings: {}, provider: "demo", model: "demo", createdBy: "t", createdById: made.user.id });
    return { made, generation };
  }
  const one = async (orgId: string, id: string) => (await getGenerations(orgId, [id]))[0];

  it("claims the images, queues one job each, and a second click doesn't queue them again", async () => {
    const { made, generation } = await setup();
    expect(await history.publishGenerations([generation.id])).toEqual({ ok: true, queued: 1, notApproved: 0 });
    expect(queued).toEqual([generation.id]);
    expect(await one(made.org.id, generation.id)).toMatchObject({ status: "publishing", publishError: null });
    expect(await history.publishGenerations("all-pending")).toEqual({ ok: true, queued: 0, notApproved: 0 });
    expect(queued).toHaveLength(1);
  });

  it("uploads a JPEG to the store and records its media id; a retried job never uploads twice", async () => {
    const { made, generation } = await setup();
    respond = shopify({ statuses: ["READY"] });
    await claimForPublish(made.org.id, [generation.id]);
    expect(await runPublish(made.org.id, generation.id)).toBe("done");
    expect(await one(made.org.id, generation.id)).toMatchObject({ status: "uploaded", publishedTo: "Acme Shopify", publishRef: "gid://shopify/MediaImage/99", publishError: null });
    const file = (calls.find((c) => c.url.startsWith(STAGED.url))!.body as FormData).get("file") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe(`SOFA-1_lifestyle_${generation.id.slice(0, 8)}.jpg`);

    // The job runs again (e.g. the worker died after the upload but before acking): nothing is sent.
    await db.update(schema.generations).set({ status: "publishing" }).where(eq(schema.generations.id, generation.id));
    calls = [];
    expect(await runPublish(made.org.id, generation.id)).toBe("done");
    expect(calls).toHaveLength(0);
    expect((await one(made.org.id, generation.id)).status).toBe("uploaded");
    // Not claimed: nothing happens.
    expect(await runPublish(made.org.id, generation.id)).toBe("skipped");
  });

  it("a throttled store keeps the job for later; a refused image or a missing store fails it with its reason", async () => {
    const { made, generation } = await setup();
    await claimForPublish(made.org.id, [generation.id]);
    respond = () => gql(null, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    expect(await runPublish(made.org.id, generation.id)).toBe("retry");
    expect((await one(made.org.id, generation.id)).status).toBe("publishing");
    respond = shopify({ product: false });
    expect(await runPublish(made.org.id, generation.id)).toBe("failed");
    expect(await one(made.org.id, generation.id)).toMatchObject({ status: "failed", publishError: "not_found", publishStartedAt: null });
    // A failed one can be uploaded again.
    expect(await claimForPublish(made.org.id, [generation.id])).toEqual([generation.id]);

    const lonely = await setup(false);
    await claimForPublish(lonely.made.org.id, [lonely.generation.id]);
    expect(await runPublish(lonely.made.org.id, lonely.generation.id)).toBe("failed");
    expect((await one(lonely.made.org.id, lonely.generation.id)).publishError).toBe("no_target");
  });

  it("checks the approval gate again when the job runs, and closes uploads a crash left behind", async () => {
    const { made, generation } = await setup();
    await claimForPublish(made.org.id, [generation.id]);
    await db.update(schema.organizations).set({ requireImageApproval: true }).where(eq(schema.organizations.id, made.org.id));
    expect(await runPublish(made.org.id, generation.id)).toBe("failed");
    expect((await one(made.org.id, generation.id)).publishError).toBe("not_approved");
    expect(calls).toHaveLength(0);

    await db.update(schema.organizations).set({ requireImageApproval: false }).where(eq(schema.organizations.id, made.org.id));
    await claimForPublish(made.org.id, [generation.id]);
    await db.update(schema.generations).set({ publishStartedAt: new Date(Date.now() - STALE_PUBLISH_MS - 60_000).toISOString() }).where(eq(schema.generations.id, generation.id));
    expect(await releaseStalePublishes()).toBeGreaterThanOrEqual(1);
    expect(await one(made.org.id, generation.id)).toMatchObject({ status: "failed", publishError: "unreachable" });
  });

  it("viewers can't upload; an org without a store that can receive images is told so", async () => {
    const { generation } = await setup(false);
    expect(await history.publishGenerations([generation.id])).toEqual({ ok: false, error: "no_target" });
    workspace = { ...workspace, role: "viewer" };
    expect(await history.publishGenerations([generation.id])).toEqual({ ok: false, error: "forbidden" });
  });
});
