import "server-only";
import { asText, fetchJson, getPath } from "../http";
import { CatalogError, type CatalogConnector, type ConnectorDefinition, type ConnectorSettings } from "../types";

// Shopify Admin GraphQL API with a custom-app access token (shpat_…). A public OAuth app replaces
// the pasted token once the product is deployed; the lookup code stays the same.

export const shopifyDefinition: ConnectorDefinition = {
  type: "shopify",
  available: true,
  canPublish: true,
  fields: [
    {
      key: "shopDomain",
      kind: "text",
      required: true,
      placeholder: "your-store.myshopify.com",
      pattern: "^(https?://)?[a-z0-9][a-z0-9-]*\\.myshopify\\.com/?$",
    },
    { key: "apiVersion", kind: "text", required: true, defaultValue: "2026-07", pattern: "^\\d{4}-\\d{2}$" },
    { key: "arabicTranslations", kind: "select", options: ["no", "yes"], defaultValue: "no" },
    { key: "accessToken", kind: "secret", required: true, placeholder: "shpat_…" },
  ],
};

const QUERY = `query ProductBySku($query: String!, $withAr: Boolean!) {
  productVariants(first: 1, query: $query) {
    nodes {
      sku
      product {
        id
        title
        productType
        translations(locale: "ar") @include(if: $withAr) { key value }
        media(first: 10) { nodes { ... on MediaImage { image { url } } } }
      }
    }
  }
}`;

const SEARCH_QUERY = `query Search($query: String!, $first: Int!) {
  products(first: $first, query: $query) {
    nodes {
      id
      title
      productType
      variants(first: 1) { nodes { sku } }
      media(first: 5) { nodes { ... on MediaImage { image { url } } } }
    }
  }
}`;

const PRODUCT_ID_QUERY = `query ProductId($query: String!) {
  productVariants(first: 1, query: $query) { nodes { product { id } } }
}`;

const STAGED_UPLOAD = `mutation Stage($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { message }
  }
}`;

const CREATE_MEDIA = `mutation Attach($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) { mediaUserErrors { message } }
}`;

export function createShopifyConnector({ config, secrets }: ConnectorSettings): CatalogConnector {
  const domain = config.shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain) || !/^\d{4}-\d{2}$/.test(config.apiVersion)) {
    throw new CatalogError("misconfigured");
  }
  const endpoint = `https://${domain}/admin/api/${config.apiVersion}/graphql.json`;

  async function graphql(query: string, variables: Record<string, unknown>) {
    const json = await fetchJson(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": secrets.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (json === null) throw new CatalogError("misconfigured");
    if (getPath(json, "errors")) throw new CatalogError("bad_response");
    return json;
  }

  return {
    // Staged upload → product media: the documented way to attach a local file to a product.
    async publishImage(sku, image) {
      const productId = asText(getPath(await graphql(PRODUCT_ID_QUERY, { query: `sku:${JSON.stringify(sku)}` }), "data.productVariants.nodes.0.product.id"));
      if (!productId) throw new CatalogError("not_found");

      const staged = await graphql(STAGED_UPLOAD, {
        input: [{ resource: "IMAGE", filename: image.filename, mimeType: image.mimeType, httpMethod: "POST" }],
      });
      const target = getPath(staged, "data.stagedUploadsCreate.stagedTargets.0") as
        | { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }
        | undefined;
      if (!target) throw new CatalogError("bad_response");

      const form = new FormData();
      for (const { name, value } of target.parameters) form.append(name, value);
      form.append("file", new Blob([Buffer.from(image.bytes)], { type: image.mimeType }), image.filename);
      await fetchJson(target.url, { method: "POST", body: form });

      const attached = await graphql(CREATE_MEDIA, {
        productId,
        media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt: image.alt }],
      });
      if ((getPath(attached, "data.productCreateMedia.mediaUserErrors") as unknown[] | undefined)?.length) {
        throw new CatalogError("bad_response");
      }
    },

    async search(query, limit) {
      const json = await graphql(SEARCH_QUERY, { query, first: limit });
      const nodes = (getPath(json, "data.products.nodes") as unknown[] | undefined) ?? [];
      return nodes
        .map((node) => ({
          externalId: asText(getPath(node, "id")),
          sku: asText(getPath(node, "variants.nodes.0.sku")),
          name: asText(getPath(node, "title")),
          nameAr: null,
          category: asText(getPath(node, "productType")) || null,
          images: ((getPath(node, "media.nodes") as unknown[] | undefined) ?? [])
            .map((m) => asText(getPath(m, "image.url")))
            .filter((url) => url.startsWith("https://")),
        }))
        .filter((p) => p.sku);
    },

    async findBySku(sku) {
      const json = await fetchJson(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-access-token": secrets.accessToken },
        body: JSON.stringify({
          query: QUERY,
          variables: { query: `sku:${JSON.stringify(sku)}`, withAr: config.arabicTranslations === "yes" },
        }),
      });
      if (json === null) throw new CatalogError("misconfigured");
      if (getPath(json, "errors")) throw new CatalogError("bad_response");
      const variant = getPath(json, "data.productVariants.nodes.0");
      if (!variant) return null;

      const translations = (getPath(variant, "product.translations") as { key: string; value: string }[] | undefined) ?? [];
      const media = (getPath(variant, "product.media.nodes") as unknown[] | undefined) ?? [];
      return {
        externalId: asText(getPath(variant, "product.id")),
        sku: asText(getPath(variant, "sku")) || sku,
        name: asText(getPath(variant, "product.title")),
        nameAr: translations.find((t) => t.key === "title")?.value ?? null,
        category: asText(getPath(variant, "product.productType")) || null,
        images: media.map((m) => asText(getPath(m, "image.url"))).filter((url) => url.startsWith("https://")),
      };
    },
  };
}
