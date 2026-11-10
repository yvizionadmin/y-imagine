import "server-only";
import { z } from "zod";
import { ProviderError } from "@/lib/ai/errors";
import { getImageProvider, type JobActor } from "@/lib/ai/registry";
import { COPY_CHANNELS, COPY_LANGUAGES, COPY_LENGTHS, COPY_TONES, type AgentTool } from "@/lib/ai/types";
import { categoryPresets } from "@/lib/catalog-presets";
import { loadConnection } from "@/lib/catalog/connections";
import { importProductPng, runLookup, runSearch } from "@/lib/catalog/lookup";
import type { CatalogProduct } from "@/lib/catalog/types";
import { writeCopy } from "@/lib/copy/write";
import { insertGeneration } from "@/lib/generations";
import { aspectRatios } from "@/lib/image-formats";
import { assetUrl, saveAsset } from "@/lib/storage/assets";
import { decodeImage } from "@/lib/storage/decode-image";
import { AGENT_TOOL_CALLS, guessCategory, type AgentToolErrorCode, type AgentToolName, type AgentToolOutput, type FoundProduct } from "./limits";

// The tools an agent can call. Each runs as the user who started the run, inside their org: the
// catalog through the org's store connection, copy and images through the registry like the Copy
// and Generate tools (each one a job with that tool's credit cost, saved to Copy / History). A
// product is always looked up again by SKU, so the model can only work on products in the catalog.

/** A tool call that can't go ahead; the model is told the code and the run screen shows it. */
export class AgentToolError extends Error {
  constructor(readonly code: AgentToolErrorCode) {
    super(code);
    this.name = "AgentToolError";
  }
}

/** The error code a tool call ended with, from what it threw. */
export function toolErrorCode(error: unknown): { code: AgentToolErrorCode; expected: boolean } {
  if (error instanceof AgentToolError) return { code: error.code, expected: true };
  if (error instanceof ProviderError) return { code: error.code, expected: true };
  // The AI SDK reports arguments that don't fit the schema as its own error type.
  if (error instanceof Error && /InvalidToolInput|TypeValidation|NoSuchTool/.test(error.name)) return { code: "invalid_input", expected: true };
  return { code: "failed", expected: false };
}

const SEARCH_RESULTS = 5;
const CATEGORY_KEYS = categoryPresets.map((c) => c.key) as [string, ...string[]];
const RATIO_KEYS = aspectRatios.map((r) => r.key) as [string, ...string[]];

const found = (p: CatalogProduct): FoundProduct => ({ sku: p.sku, name: p.name, nameAr: p.nameAr, category: p.category, image: p.images[0] ?? null });

async function connection(orgId: string) {
  const loaded = await loadConnection(orgId);
  if (!loaded) throw new AgentToolError("no_connection");
  return loaded;
}

/** The product with this SKU from a fresh catalog lookup. */
async function product(orgId: string, sku: string) {
  const { connection: c, settings } = await connection(orgId);
  const lookup = await runLookup(c.type, settings, sku);
  if (!lookup.ok) throw new AgentToolError(lookup.error === "not_found" ? "sku_not_found" : "catalog_error");
  return lookup.product;
}

/** The product's first catalog image as PNG, or null when it has none or it can't be fetched. */
async function productPhoto(orgId: string, p: CatalogProduct) {
  const url = p.images[0];
  if (!url) return null;
  const imported = await importProductPng(orgId, p.sku, url);
  return imported.ok ? { bytes: new Uint8Array(imported.png), mimeType: "image/png", name: `${p.sku.replace(/[^A-Za-z0-9_-]/g, "_")}.png` } : null;
}

const searchInput = z.object({
  query: z.string().trim().min(1).max(100).describe("SKU, product name or a word from it, e.g. 'sofa' or 'SOFA-12345'"),
});

const copyInput = z.object({
  sku: z.string().trim().min(1).max(64).describe("SKU of a product found with search_catalog"),
  languages: z.array(z.enum(COPY_LANGUAGES)).min(1).max(2).default(["en"]).describe("en, ar, or both"),
  tone: z.enum(COPY_TONES).default("professional"),
  length: z.enum(COPY_LENGTHS).default("medium"),
  channel: z.enum(COPY_CHANNELS).default("website").describe("Where the copy will be published"),
  details: z.string().trim().max(1000).default("").describe("Product facts the user gave (materials, sizes, features). Never invent any."),
});

const imageInput = z.object({
  sku: z.string().trim().min(1).max(64).describe("SKU of a product found with search_catalog"),
  category: z.enum(CATEGORY_KEYS).optional().describe("Product category; left out, it is worked out from the catalog"),
  scene: z.string().trim().max(300).default("").describe("The setting in a few words, e.g. 'bright modern living room'. Empty lets the model choose."),
  aspectRatio: z.enum(RATIO_KEYS).default("1:1"),
});

/**
 * The run's tools. `onLimit` counts calls per tool, so one run stays within AGENT_TOOL_CALLS.
 * Outputs are what the run screen shows and what the model reads: names, SKUs and links, nothing secret.
 */
export function agentTools(actor: JobActor, runId: string): AgentTool[] {
  const used: Record<AgentToolName, number> = { search_catalog: 0, write_copy: 0, generate_image: 0 };
  const limited = <I>(name: AgentToolName, run: (input: I) => Promise<AgentToolOutput>) => async (input: unknown) => {
    if (used[name] >= AGENT_TOOL_CALLS[name]) throw new AgentToolError("limit");
    used[name] += 1;
    return run(input as I);
  };

  return [
    {
      name: "search_catalog",
      description: "Search the team's product catalog (their connected store) by SKU or name. Returns up to 5 products with SKU, name and category.",
      input: searchInput,
      execute: limited("search_catalog", async ({ query }: z.infer<typeof searchInput>) => {
        const { connection: c, settings } = await connection(actor.orgId);
        const result = await runSearch(c.type, settings, query, SEARCH_RESULTS);
        if (!result.ok) throw new AgentToolError("catalog_error");
        return { tool: "search_catalog", query, products: result.products.slice(0, SEARCH_RESULTS).map(found) };
      }),
    },
    {
      name: "write_copy",
      description:
        "Write product copy (title, bullets, description, SEO meta and tags) for one catalog product, in the team's brand voice. Saved to the Copy tool for review. Costs the Copy tool's credits.",
      input: copyInput,
      execute: limited("write_copy", async (input: z.infer<typeof copyInput>) => {
        const p = await product(actor.orgId, input.sku);
        const saved = await writeCopy(actor, {
          sku: p.sku,
          productName: p.name,
          image: await productPhoto(actor.orgId, p),
          settings: {
            category: guessCategory(`${p.category ?? ""} ${p.name}`),
            tone: input.tone,
            length: input.length,
            channel: input.channel,
            languages: [...new Set(input.languages)],
            keywords: [],
            details: input.details,
            brandVoice: true,
          },
        });
        const title = saved.copy.en?.title ?? saved.copy.ar?.title ?? p.name;
        return { tool: "write_copy", copyId: saved.id, sku: p.sku, productName: p.name, title, languages: Object.keys(saved.copy) };
      }),
    },
    {
      name: "generate_image",
      description:
        "Make a lifestyle image of one catalog product (its catalog photo placed in a realistic scene). Saved to History. Costs the Generate tool's credits.",
      input: imageInput,
      execute: limited("generate_image", async (input: z.infer<typeof imageInput>) => {
        const p = await product(actor.orgId, input.sku);
        const photo = await productPhoto(actor.orgId, p);
        if (!photo) throw new AgentToolError("no_image");
        const category = input.category ?? guessCategory(`${p.category ?? ""} ${p.name}`);
        const provider = await getImageProvider(actor, "generate");
        const image = await provider.generateLifestyle({
          sku: p.sku,
          product: photo,
          reference: null,
          category,
          subcategory: null,
          scene: null,
          customScene: input.scene || null,
          sceneUpload: null,
          style: null,
          productSize: "",
          aspectRatio: input.aspectRatio,
          resolution: "HD",
          instructions: "",
        });
        const decoded = await decodeImage(image.url);
        if (!decoded) throw new ProviderError("generation_failed");
        const assetId = await saveAsset(actor.orgId, decoded.bytes, decoded.mimeType, "generation");
        const generation = await insertGeneration({
          orgId: actor.orgId,
          mode: "lifestyle",
          sku: p.sku,
          title: p.name,
          assetId,
          mimeType: decoded.mimeType,
          width: image.width,
          height: image.height,
          settings: { category, customScene: input.scene || null, aspectRatio: input.aspectRatio, resolution: "HD", agentRunId: runId },
          provider: image.provider,
          model: image.model,
          createdBy: actor.user.name,
          createdById: actor.user.id,
        });
        return { tool: "generate_image", generationId: generation.id, sku: p.sku, productName: p.name, url: assetUrl(assetId), width: image.width, height: image.height };
      }),
    },
  ];
}
