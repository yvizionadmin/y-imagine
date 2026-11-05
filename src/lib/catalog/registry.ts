import "server-only";
import { createCustomRestConnector, customRestDefinition } from "./connectors/custom-rest";
import { createDemoConnector, demoDefinition } from "./connectors/demo";
import { createMagentoConnector, magentoDefinition } from "./connectors/magento";
import { createShopifyConnector, shopifyDefinition } from "./connectors/shopify";
import { createWooCommerceConnector, woocommerceDefinition } from "./connectors/woocommerce";
import {
  isFieldActive,
  type CatalogConnector,
  type ConnectorDefinition,
  type ConnectorSettings,
  type ConnectorType,
} from "./types";

// Adding a platform: write src/lib/catalog/connectors/<platform>.ts (definition + factory),
// register it here, and add its labels under Integrations.connectors.<type> in messages.

const connectors: Record<ConnectorType, { definition: ConnectorDefinition; create: (s: ConnectorSettings) => CatalogConnector }> = {
  shopify: { definition: shopifyDefinition, create: createShopifyConnector },
  magento: { definition: magentoDefinition, create: createMagentoConnector },
  woocommerce: { definition: woocommerceDefinition, create: createWooCommerceConnector },
  "custom-rest": { definition: customRestDefinition, create: createCustomRestConnector },
  demo: { definition: demoDefinition, create: createDemoConnector },
};

export const isConnectorType = (value: string): value is ConnectorType => value in connectors;

export function availableDefinitions(): ConnectorDefinition[] {
  return Object.values(connectors)
    .map((c) => c.definition)
    .filter((d) => d.available);
}

export const canPublish = (type: ConnectorType) => connectors[type].definition.canPublish;

export function createConnector(type: ConnectorType, settings: ConnectorSettings): CatalogConnector {
  return connectors[type].create(settings);
}

const MAX_VALUE = 500;

/**
 * Keep only known, active fields; apply defaults; enforce required/url/select rules.
 * `keptSecrets` lists secret keys whose stored value is reused (left blank while editing).
 */
export function validateSettings(
  type: ConnectorType,
  input: { config: Record<string, unknown>; secrets: Record<string, unknown> },
  keptSecrets: string[] = [],
): { ok: true; settings: ConnectorSettings } | { ok: false; field: string } {
  const { definition } = connectors[type];
  if (!definition.available) return { ok: false, field: "type" };
  const config: Record<string, string> = {};
  for (const field of definition.fields) {
    if (field.kind !== "secret") config[field.key] = String(input.config[field.key] ?? field.defaultValue ?? "").trim();
  }

  const secrets: Record<string, string> = {};
  for (const field of definition.fields) {
    if (!isFieldActive(field, config)) {
      delete config[field.key];
      continue;
    }
    const value = field.kind === "secret" ? String(input.secrets[field.key] ?? "").trim() : config[field.key];
    if (value.length > MAX_VALUE) return { ok: false, field: field.key };
    if (!value) {
      if (field.required && !(field.kind === "secret" && keptSecrets.includes(field.key))) return { ok: false, field: field.key };
      continue;
    }
    if (field.kind === "url") {
      try {
        if (new URL(value.replace("{sku}", "SKU")).protocol !== "https:") return { ok: false, field: field.key };
      } catch {
        return { ok: false, field: field.key };
      }
    }
    if (field.kind === "select" && !field.options?.includes(value)) return { ok: false, field: field.key };
    if (field.pattern && !new RegExp(field.pattern, "i").test(value)) return { ok: false, field: field.key };
    if (field.kind === "secret") secrets[field.key] = value;
  }
  return { ok: true, settings: { config, secrets } };
}
