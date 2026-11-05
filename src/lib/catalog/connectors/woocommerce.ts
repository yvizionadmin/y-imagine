import "server-only";
import { absoluteImages, asText, fetchJson, getPath, normaliseBaseUrl } from "../http";
import type { CatalogConnector, ConnectorDefinition, ConnectorSettings } from "../types";

// WooCommerce REST API v3 with a consumer key/secret (basic auth over https).

export const woocommerceDefinition: ConnectorDefinition = {
  type: "woocommerce",
  available: true,
  // The WooCommerce API only accepts image URLs it can download; enabled once assets are publicly hosted.
  canPublish: false,
  fields: [
    { key: "storeUrl", kind: "url", required: true, placeholder: "https://shop.example.com" },
    { key: "consumerKey", kind: "secret", required: true, placeholder: "ck_…" },
    { key: "consumerSecret", kind: "secret", required: true, placeholder: "cs_…" },
  ],
};

export function createWooCommerceConnector({ config, secrets }: ConnectorSettings): CatalogConnector {
  const base = normaliseBaseUrl(config.storeUrl);
  const auth = Buffer.from(`${secrets.consumerKey}:${secrets.consumerSecret}`).toString("base64");

  const toProduct = (product: unknown, sku = "") => ({
    externalId: asText(getPath(product, "id")),
    sku: asText(getPath(product, "sku")) || sku,
    name: asText(getPath(product, "name")),
    nameAr: null,
    category: asText(getPath(product, "categories.0.name")) || null,
    images: absoluteImages(((getPath(product, "images") as unknown[] | undefined) ?? []).map((image) => getPath(image, "src")), base),
  });
  const get = (query: string) => fetchJson(`${base}/wp-json/wc/v3/products?${query}`, { headers: { authorization: `Basic ${auth}` } });

  return {
    async findBySku(sku) {
      const json = await get(`sku=${encodeURIComponent(sku)}`);
      const product = Array.isArray(json) ? json[0] : null;
      return product ? toProduct(product, sku) : null;
    },
    async search(query, limit) {
      const json = await get(`search=${encodeURIComponent(query)}&per_page=${limit}`);
      return Array.isArray(json) ? json.map((p) => toProduct(p)).filter((p) => p.sku) : [];
    },
  };
}
