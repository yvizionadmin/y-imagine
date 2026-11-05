import "server-only";
import { absoluteImages, asText, fetchJson, getPath } from "../http";
import { CatalogError, type CatalogConnector, type ConnectorDefinition, type ConnectorSettings } from "../types";

// Any in-house product API / PIM: the admin supplies a URL template, the auth scheme and where each
// field lives in the JSON response (dotted paths such as "data.0.title").

const AUTH_WITH_SECRET = ["bearer", "header", "basic"] as const;

export const customRestDefinition: ConnectorDefinition = {
  type: "custom-rest",
  available: true,
  canPublish: false,
  fields: [
    { key: "urlTemplate", kind: "url", required: true, placeholder: "https://api.example.com/products?sku={sku}" },
    { key: "authType", kind: "select", options: ["none", ...AUTH_WITH_SECRET], defaultValue: "bearer" },
    {
      key: "headerName",
      kind: "text",
      defaultValue: "X-API-Key",
      pattern: "^[A-Za-z0-9-]{1,64}$",
      when: { field: "authType", in: ["header"] },
      required: true,
    },
    { key: "username", kind: "text", when: { field: "authType", in: ["basic"] }, required: true },
    { key: "token", kind: "secret", when: { field: "authType", in: AUTH_WITH_SECRET }, required: true },
    { key: "productPath", kind: "text", placeholder: "data.0" },
    { key: "idPath", kind: "text", defaultValue: "id" },
    { key: "skuPath", kind: "text", defaultValue: "sku" },
    { key: "namePath", kind: "text", required: true, defaultValue: "name" },
    { key: "nameArPath", kind: "text", placeholder: "translations.ar.name" },
    { key: "categoryPath", kind: "text", placeholder: "category" },
    { key: "imagesPath", kind: "text", required: true, defaultValue: "images" },
    { key: "imageKey", kind: "text", placeholder: "url" },
    { key: "searchUrlTemplate", kind: "url", placeholder: "https://api.example.com/products?q={query}" },
    { key: "resultsPath", kind: "text", placeholder: "data" },
  ],
};

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

export function createCustomRestConnector({ config, secrets }: ConnectorSettings): CatalogConnector {
  if (!config.urlTemplate.includes("{sku}")) throw new CatalogError("misconfigured");
  const headers: Record<string, string> = {};
  if (config.authType === "bearer") headers.authorization = `Bearer ${secrets.token}`;
  if (config.authType === "header") {
    if (!HEADER_NAME.test(config.headerName)) throw new CatalogError("misconfigured");
    headers[config.headerName] = secrets.token;
  }
  if (config.authType === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${config.username}:${secrets.token}`).toString("base64")}`;
  }

  function toProduct(product: unknown, sku: string, url: string) {
    const rawImages = getPath(product, config.imagesPath);
    const list = Array.isArray(rawImages) ? rawImages : rawImages ? [rawImages] : [];
    const name = asText(getPath(product, config.namePath));
    if (!name) throw new CatalogError("bad_response");
    return {
      externalId: asText(getPath(product, config.idPath || "id")) || sku,
      sku,
      name,
      nameAr: config.nameArPath ? asText(getPath(product, config.nameArPath)) || null : null,
      category: config.categoryPath ? asText(getPath(product, config.categoryPath)) || null : null,
      images: absoluteImages(config.imageKey ? list.map((item) => getPath(item, config.imageKey)) : list, url),
    };
  }

  const searchTemplate = config.searchUrlTemplate?.includes("{query}") ? config.searchUrlTemplate : null;

  return {
    async findBySku(sku) {
      const url = config.urlTemplate.replaceAll("{sku}", encodeURIComponent(sku));
      const product = getPath(await fetchJson(url, { headers }), config.productPath ?? "");
      return product && typeof product === "object" ? toProduct(product, sku, url) : null;
    },
    ...(searchTemplate && {
      async search(query: string, limit: number) {
        const url = searchTemplate.replaceAll("{query}", encodeURIComponent(query));
        const results = getPath(await fetchJson(url, { headers }), config.resultsPath ?? "");
        return (Array.isArray(results) ? results : [])
          .slice(0, limit)
          .map((item) => toProduct(item, asText(getPath(item, config.skuPath || "sku")), url))
          .filter((p) => p.sku);
      },
    }),
  };
}
