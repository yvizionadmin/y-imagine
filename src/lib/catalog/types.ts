// Platform-agnostic catalog model. Every connector (Shopify, Magento, WooCommerce, custom REST, ...)
// maps its platform's product into CatalogProduct, so the tools never see platform specifics.

export type ConnectorType = "demo" | "shopify" | "magento" | "woocommerce" | "custom-rest";

export type CatalogProduct = {
  externalId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  category: string | null;
  /** Absolute https URLs (or same-origin paths for the demo catalog). */
  images: string[];
};

export type FieldKind = "text" | "url" | "secret" | "select";

export type ConnectorField = {
  key: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  defaultValue?: string;
  placeholder?: string;
  /** Server-side format check (case-insensitive), e.g. a Shopify domain. */
  pattern?: string;
  /** Only show/require this field when another field has one of these values. */
  when?: { field: string; in: readonly string[] };
};

/** Declarative description the Integrations UI renders its settings form from. */
export type ConnectorDefinition = {
  type: ConnectorType;
  fields: readonly ConnectorField[];
  /** Hidden from the picker when false (e.g. demo in production). */
  available: boolean;
  /** Can push generated images back to the store (History → Upload to Website). */
  canPublish: boolean;
};

export type PublishImage = { bytes: Uint8Array; mimeType: string; filename: string; alt: string };

export type ConnectorSettings = { config: Record<string, string>; secrets: Record<string, string> };

export interface CatalogConnector {
  findBySku(sku: string): Promise<CatalogProduct | null>;
  /** Free-text product search (SKU or name). Connectors without it fall back to an exact SKU lookup. */
  search?(query: string, limit: number): Promise<CatalogProduct[]>;
  /** Attach an image to the product with this SKU. Present only when the definition has canPublish. */
  publishImage?(sku: string, image: PublishImage): Promise<void>;
}

export type CatalogErrorCode = "auth_failed" | "unreachable" | "bad_response" | "misconfigured" | "not_found";

export class CatalogError extends Error {
  constructor(public readonly code: CatalogErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CatalogError";
  }
}

export const isFieldActive = (field: ConnectorField, config: Record<string, string>) =>
  !field.when || field.when.in.includes(config[field.when.field] ?? "");
