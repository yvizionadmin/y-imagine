import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { AiProviderId, KeyError, KeyStatus } from "@/lib/ai/providers-info";
import type { ModelFeature } from "@/lib/ai/models";
import type { CopyLanguage, Feature, ProductCopy, ProviderId } from "@/lib/ai/types";
import type { CopySettings } from "@/lib/copy/copies";
import type { ReviewStatus } from "@/lib/copy/review-status";
import type { AplusRowData, ImageBatchSettings, ImageBatchTool } from "@/lib/image-batch/rows";
import type { BatchItemStatus, BatchStatus, BatchDefaults } from "@/lib/copy/batches";
import type { CatalogErrorCode, ConnectorType } from "@/lib/catalog/types";
import type { EncryptedSecret } from "@/lib/crypto/secrets";
import type { LookItem } from "@/features/looks/config";
import type { BillingStatus, PlanId } from "@/lib/plans";

// Postgres schema (Drizzle, snake_case columns). Every tenant table has `org_id` and is queried
// through db.forOrg(orgId); organizations, users, sessions and platform_settings are platform
// tables. Columns are named in camelCase here and mapped by `casing: "snake_case"`.

/** timestamptz exposed as an ISO string, the shape the repositories already return. */
const timestamp = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamp(3) with time zone",
  fromDriver: (value) => new Date(value).toISOString(),
});
const now = () => timestamp().notNull().$defaultFn(() => new Date().toISOString());

const orgId = () =>
  text()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

// ── Platform ─────────────────────────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull(),
  plan: text().$type<PlanId>().notNull(),
  /** Replaces the plan's monthly job quota when set. */
  creditsOverride: integer(),
  status: text().$type<"active" | "suspended">().notNull().default("active"),
  suspendedReason: text(),
  /** Starter room backgrounds were added once; an admin who deletes them all doesn't get them back. */
  roomBackgroundsSeeded: boolean().notNull().default(false),
  /** Stripe billing (synced by its webhook). `plan` follows the subscription while one exists. */
  stripeCustomerId: text().unique(),
  stripeSubscriptionId: text().unique(),
  billingStatus: text().$type<BillingStatus>(),
  billingInterval: text().$type<"month" | "year">(),
  billingPeriodEnd: timestamp(),
  cancelAtPeriodEnd: boolean().notNull().default(false),
  createdBy: text().notNull(),
  createdAt: now(),
  updatedAt: now(),
});

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  /** Local sign-in only; null for Clerk accounts (Clerk owns their password). */
  passwordHash: text(),
  /** Set once the user has signed in through Clerk (CLERK_SECRET_KEY set). */
  clerkUserId: text().unique(),
  /** Last Clerk session seen, so a new sign-in is noticed (last sign-in, pending invitations). */
  lastSessionId: text(),
  platformRole: text().$type<"super_admin">(),
  status: text().$type<"active" | "disabled">().notNull().default("active"),
  createdBy: text(),
  createdAt: now(),
  lastSignInAt: timestamp(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    tokenHash: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text(),
    createdAt: now(),
    expiresAt: timestamp().notNull(),
  },
  (t) => [index().on(t.userId)],
);

export const platformSettings = pgTable("platform_settings", {
  id: integer().primaryKey().default(1),
  maintenance: jsonb().$type<{ enabled: boolean; message: string }>().notNull(),
  signupsEnabled: boolean().notNull(),
  defaultPlan: text().$type<PlanId>().notNull(),
  disabledFeatures: jsonb().$type<Feature[]>().notNull(),
  /** Credit rules from Admin → Credits (src/lib/credits.ts); null until an admin saves them. */
  creditRules: jsonb().$type<Record<string, unknown>>(),
  updatedAt: timestamp(),
  updatedBy: text(),
});

/** Stripe webhook events already applied (Stripe retries and may deliver twice). Platform table. */
export const stripeEvents = pgTable("stripe_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  processedAt: now(),
});

/** org_id is "platform" for user/settings entries, so it has no foreign key. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text().primaryKey(),
    orgId: text().notNull(),
    action: text().notNull(),
    actor: text().notNull(),
    target: text().notNull(),
    meta: jsonb().$type<Record<string, string>>(),
    at: now(),
  },
  (t) => [index().on(t.orgId, t.at)],
);

// ── Tenant ───────────────────────────────────────────────────────────────────────────────────

export const members = pgTable(
  "members",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    userId: text().references(() => users.id, { onDelete: "set null" }),
    name: text().notNull(),
    email: text().notNull(),
    role: text().$type<"admin" | "editor" | "viewer">().notNull(),
    department: text().notNull().default(""),
    status: text().$type<"active" | "invited">().notNull(),
    invitedBy: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [uniqueIndex().on(t.orgId, t.email), index().on(t.userId)],
);

/** One row per provider job. `running` rows hold a quota reservation until the job finishes. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    feature: text().$type<Feature>().notNull(),
    userId: text(),
    /** Display name when the job ran, so history survives a removed user. */
    userName: text().notNull(),
    provider: text().$type<ProviderId>().notNull(),
    model: text(),
    status: text().$type<"running" | "ok" | "error">().notNull(),
    error: text(),
    durationMs: integer().notNull().default(0),
    /** Credits the job reserved (its tool's cost when it started). */
    credits: integer().notNull().default(1),
    at: now(),
  },
  (t) => [index().on(t.orgId, t.at), index().on(t.at)],
);

/** Credits a super admin added (positive) or removed (negative) for one org, counted in the month made. */
export const creditAdjustments = pgTable(
  "credit_adjustments",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    amount: integer().notNull(),
    reason: text().notNull(),
    actor: text().notNull(),
    at: now(),
  },
  (t) => [index().on(t.orgId, t.at)],
);

export const assets = pgTable(
  "assets",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    mimeType: text().notNull(),
    kind: text().$type<"generation" | "look-product" | "room-background" | "look-background" | "look" | "swatch" | "video" | "video-frame">().notNull(),
    byteSize: integer(),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId)],
);

export const generations = pgTable(
  "generations",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    mode: text().$type<"create" | "video" | "lifestyle" | "recolor" | "aplus">().notNull(),
    sku: text().notNull(),
    title: text().notNull(),
    assetId: text().notNull(),
    mimeType: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    settings: jsonb().$type<Record<string, string | null>>().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    status: text().$type<"pending" | "uploaded" | "failed">().notNull(),
    publishedTo: text(),
    publishedAt: timestamp(),
    publishError: text(),
    createdBy: text().notNull(),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId, t.createdAt)],
);

/**
 * Studio video jobs, one row per video. `pending` → claimed `running` by one worker → `ok` (asset
 * saved) or `failed`. The credit is reserved in usage_events when the provider call starts.
 */
export const videoJobs = pgTable(
  "video_jobs",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    status: text().$type<"pending" | "running" | "ok" | "failed">().notNull(),
    prompt: text().notNull(),
    /** aspectRatio, seconds, resolution, camera, motion. */
    settings: jsonb().$type<Record<string, string | number>>().notNull(),
    /** First frame for image-to-video (asset kind video-frame). */
    startFrameAssetId: text(),
    startFrameMime: text(),
    /** The finished clip (asset kind video). */
    assetId: text(),
    mimeType: text(),
    credits: integer().notNull(),
    provider: text(),
    model: text(),
    error: text(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
    finishedAt: timestamp(),
  },
  (t) => [index().on(t.orgId, t.createdAt), index().on(t.status, t.updatedAt)],
);

export const looks = pgTable(
  "looks",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    title: text().notNull(),
    prompt: text().notNull(),
    style: text(),
    aspectRatio: text().notNull(),
    backgroundId: text(),
    roomType: text(),
    category: text().notNull().default("furniture"),
    subcategory: text(),
    items: jsonb().$type<LookItem[]>().notNull(),
    resultAssetId: text().notNull(),
    isBoard: boolean().notNull().default(false),
    mode: text().$type<"generated" | "regenerated">().notNull().default("generated"),
    createdBy: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.orgId)],
);

export const roomBackgrounds = pgTable(
  "room_backgrounds",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    roomType: text().notNull(),
    category: text().notNull().default("furniture"),
    style: text().notNull(),
    assetId: text().notNull(),
    mimeType: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId)],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    provider: text().$type<AiProviderId>().notNull(),
    secret: jsonb().$type<EncryptedSecret>().notNull(),
    hint: text().notNull(),
    status: text().$type<KeyStatus>().notNull(),
    lastError: text().$type<KeyError>(),
    models: jsonb().$type<string[]>(),
    validatedAt: timestamp().notNull(),
    createdBy: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [uniqueIndex().on(t.orgId, t.provider)],
);

export const catalogConnections = pgTable(
  "catalog_connections",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    type: text().$type<ConnectorType>().notNull(),
    name: text().notNull(),
    config: jsonb().$type<Record<string, string>>().notNull(),
    secret: jsonb().$type<EncryptedSecret>(),
    /** Masked secret values for display, e.g. { accessToken: "••••a1b2" } */
    secretHints: jsonb().$type<Record<string, string>>().notNull(),
    isDefault: boolean().notNull().default(false),
    createdBy: text().notNull(),
    createdAt: now(),
    lastTest: jsonb().$type<{ ok: boolean; at: string; error?: CatalogErrorCode | "not_found" }>(),
  },
  (t) => [index().on(t.orgId)],
);

export const bitlyConnections = pgTable("bitly_connections", {
  orgId: orgId().primaryKey(),
  secret: jsonb().$type<EncryptedSecret>().notNull(),
  hint: text().notNull(),
  login: text().notNull(),
  groupGuid: text().notNull(),
  createdBy: text().notNull(),
  createdAt: now(),
});

export const shortLinks = pgTable(
  "short_links",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    bitlinkId: text().notNull(),
    shortUrl: text().notNull(),
    longUrl: text().notNull(),
    title: text().notNull(),
    clicks: integer(),
    clicksCheckedAt: timestamp(),
    createdBy: text().notNull(),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId, t.createdAt)],
);

/** The image model an org picked per tool; no row means "Automatic". */
export const modelPreferences = pgTable(
  "model_preferences",
  {
    orgId: orgId(),
    feature: text().$type<ModelFeature>().notNull(),
    provider: text().$type<AiProviderId>().notNull(),
    model: text().notNull(),
    updatedBy: text().notNull(),
    updatedAt: now(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.feature] })],
);

/** How the org's product copy should sound (Settings → Brand Kit); no row means no brand voice. */
export const brandKits = pgTable("brand_kits", {
  orgId: orgId().primaryKey(),
  name: text().notNull(),
  about: text().notNull(),
  voice: text().notNull(),
  audience: text().notNull(),
  useWords: jsonb().$type<string[]>().notNull(),
  avoidWords: jsonb().$type<string[]>().notNull(),
  rules: text().notNull(),
  updatedBy: text().notNull(),
  updatedAt: now(),
});

/** Product copy written by the Copy tool (EN/AR), editable after generation. */
export const copyGenerations = pgTable(
  "copy_generations",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    sku: text().notNull(),
    productName: text().notNull(),
    /** Form settings the copy was written with (category, tone, length, channel, keywords, details). */
    settings: jsonb().$type<CopySettings>().notNull(),
    copy: jsonb().$type<Partial<Record<CopyLanguage, ProductCopy>>>().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    /** Approval state (see src/lib/copy/review-status.ts). */
    reviewStatus: text().$type<ReviewStatus>().notNull().default("draft"),
    /** The admin's note when changes were requested. */
    reviewNote: text(),
    reviewedBy: text(),
    reviewedAt: timestamp(),
    createdBy: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.orgId, t.createdAt), index().on(t.orgId, t.reviewStatus)],
);

/** A bulk Copy run: many products written with the same style, one queued job per product. */
export const copyBatches = pgTable(
  "copy_batches",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    /** Style shared by every product, plus the category for rows that don't name one. */
    settings: jsonb().$type<BatchDefaults>().notNull(),
    status: text().$type<BatchStatus>().notNull(),
    total: integer().notNull(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    finishedAt: timestamp(),
  },
  (t) => [index().on(t.orgId, t.createdAt)],
);

export const copyBatchItems = pgTable(
  "copy_batch_items",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    batchId: text()
      .notNull()
      .references(() => copyBatches.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    sku: text().notNull(),
    /** Empty when the row only had a SKU: filled from the catalog when the item runs. */
    productName: text().notNull(),
    category: text(),
    details: text().notNull(),
    keywords: jsonb().$type<string[]>().notNull(),
    status: text().$type<BatchItemStatus>().notNull(),
    error: text(),
    copyId: text().references(() => copyGenerations.id, { onDelete: "set null" }),
    updatedAt: now(),
  },
  (t) => [index().on(t.batchId, t.position), index().on(t.status, t.updatedAt)],
);

/** A bulk image run (Generate, Recolor or A+): one product photo from the catalog per item, same settings. */
export const imageBatches = pgTable(
  "image_batches",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    tool: text().$type<ImageBatchTool>().notNull(),
    name: text().notNull(),
    /** The tool's settings type (rows.ts), chosen by `tool`. */
    settings: jsonb().$type<ImageBatchSettings>().notNull(),
    status: text().$type<BatchStatus>().notNull(),
    total: integer().notNull(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    finishedAt: timestamp(),
  },
  (t) => [index().on(t.orgId, t.createdAt)],
);

export const imageBatchItems = pgTable(
  "image_batch_items",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    batchId: text()
      .notNull()
      .references(() => imageBatches.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    sku: text().notNull(),
    productSize: text().notNull(),
    /** Per-product input some tools need (A+: title, subtitle, features). */
    data: jsonb().$type<AplusRowData>(),
    status: text().$type<BatchItemStatus>().notNull(),
    error: text(),
    /** The saved History image (generations.id) once done. */
    generationId: text().references(() => generations.id, { onDelete: "set null" }),
    updatedAt: now(),
  },
  (t) => [index().on(t.batchId, t.position), index().on(t.status, t.updatedAt)],
);
