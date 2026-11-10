import "server-only";
import { absoluteImages, asText, fetchJson, getPath, normaliseBaseUrl } from "../http";
import { CatalogError, type CatalogConnector, type ConnectorDefinition, type ConnectorSettings } from "../types";

// Magento 2 / Adobe Commerce REST API with an integration access token.

export const magentoDefinition: ConnectorDefinition = {
  type: "magento",
  available: true,
  canPublish: true,
  fields: [
    { key: "baseUrl", kind: "url", required: true, placeholder: "https://shop.example.com" },
    { key: "arabicStoreCode", kind: "text", placeholder: "ar", pattern: "^[a-z0-9_]+$" },
    { key: "accessToken", kind: "secret", required: true },
  ],
};

export function createMagentoConnector({ config, secrets }: ConnectorSettings): CatalogConnector {
  const base = normaliseBaseUrl(config.baseUrl);
  const storeCode = config.arabicStoreCode?.trim();
  if (storeCode && !/^[a-z0-9_]+$/i.test(storeCode)) throw new CatalogError("misconfigured");
  const headers = { authorization: `Bearer ${secrets.accessToken}` };

  return {
    async findBySku(sku) {
      const path = `/V1/products/${encodeURIComponent(sku)}`;
      const product = await fetchJson(`${base}/rest${path}`, { headers });
      if (!product) return null;

      const categoryId = asText(getPath(product, "extension_attributes.category_links.0.category_id"));
      const [arabic, category] = await Promise.all([
        storeCode ? fetchJson(`${base}/rest/${storeCode}${path}`, { headers }).catch(() => null) : null,
        categoryId ? fetchJson(`${base}/rest/V1/categories/${encodeURIComponent(categoryId)}`, { headers }).catch(() => null) : null,
      ]);

      const media = ((getPath(product, "media_gallery_entries") as unknown[] | undefined) ?? []).filter(
        (entry) => getPath(entry, "media_type") === "image" && !getPath(entry, "disabled"),
      );
      return {
        externalId: asText(getPath(product, "id")),
        sku: asText(getPath(product, "sku")) || sku,
        name: asText(getPath(product, "name")),
        nameAr: asText(getPath(arabic, "name")) || null,
        category: asText(getPath(category, "name")) || null,
        images: absoluteImages(
          media.map((entry) => `/media/catalog/product${asText(getPath(entry, "file"))}`),
          base,
        ),
      };
    },

    async search(query, limit) {
      const like = encodeURIComponent(`%${query}%`);
      const criteria =
        `searchCriteria[filter_groups][0][filters][0][field]=name&searchCriteria[filter_groups][0][filters][0][value]=${like}` +
        `&searchCriteria[filter_groups][0][filters][0][condition_type]=like` +
        `&searchCriteria[filter_groups][0][filters][1][field]=sku&searchCriteria[filter_groups][0][filters][1][value]=${like}` +
        `&searchCriteria[filter_groups][0][filters][1][condition_type]=like&searchCriteria[pageSize]=${limit}`;
      const json = await fetchJson(`${base}/rest/V1/products?${criteria}`, { headers });
      const items = (getPath(json, "items") as unknown[] | undefined) ?? [];
      return items.map((item) => ({
        externalId: asText(getPath(item, "id")),
        sku: asText(getPath(item, "sku")),
        name: asText(getPath(item, "name")),
        nameAr: null,
        category: null,
        images: absoluteImages(
          ((getPath(item, "media_gallery_entries") as unknown[] | undefined) ?? []).map(
            (entry) => `/media/catalog/product${asText(getPath(entry, "file"))}`,
          ),
          base,
        ),
      }));
    },

    async publishImage(sku, image) {
      const result = await fetchJson(`${base}/rest/all/V1/products/${encodeURIComponent(sku)}/media`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          entry: {
            media_type: "image",
            label: image.alt,
            position: 0,
            disabled: false,
            types: [],
            content: {
              base64_encoded_data: Buffer.from(image.bytes).toString("base64"),
              type: image.mimeType,
              name: image.filename,
            },
          },
        }),
      });
      if (result === null) throw new CatalogError("not_found");
      // Magento answers with the new media entry's id (a JSON string or number).
      const ref = asText(result);
      return { ref: ref || null };
    },
  };
}
