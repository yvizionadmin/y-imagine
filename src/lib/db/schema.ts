import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, text, uniqueIndex } from "drizzle-orm/pg-core";
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
import type { AgentRunStatus, AgentStep } from "@/lib/agent/limits";
import type { CharacterImage, CharacterSource } from "@/lib/characters/limits";
import type { DirectorScene, DirectorSettings, DirectorStatus, DirectorStep } from "@/lib/director/limits";
import type { EditTimeline } from "@/lib/editor/timeline";
import type { EditorMedia } from "@/lib/editor/media";
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
  /** Only approved images can be uploaded to the store (History). */
  requireImageApproval: boolean().notNull().default(false),
  /** Product categories the org doesn't sell: hidden in its pickers (still valid on the server). */
  hiddenCategories: jsonb().$type<string[]>().notNull().default([]),
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

/**
 * Local-login password reset links. Like sessions, these belong to the person, not an org. Only
 * the token's SHA-256 is stored; a link works once, for an hour.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: text().primaryKey(),
    tokenHash: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: now(),
    expiresAt: timestamp().notNull(),
    usedAt: timestamp(),
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
    kind: text().$type<"generation" | "look-product" | "room-background" | "look-background" | "look" | "swatch" | "video" | "video-frame" | "editor-media" | "edit-render" | "character">().notNull(),
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
    /** Store upload: `pending` → `publishing` (one queued job owns it) → `uploaded` / `failed`. */
    status: text().$type<"pending" | "publishing" | "uploaded" | "failed">().notNull(),
    publishedTo: text(),
    publishedAt: timestamp(),
    publishError: text(),
    /** The store's id for the uploaded image (Shopify media gid, Magento media entry id), so a retry never uploads it twice. */
    publishRef: text(),
    /** When the upload job took it (stuck uploads are failed by the stale-job sweep). */
    publishStartedAt: timestamp(),
    /** Approval state of an image (see src/lib/copy/review-status.ts). Videos stay draft. */
    reviewStatus: text().$type<ReviewStatus>().notNull().default("draft"),
    reviewNote: text(),
    reviewedBy: text(),
    reviewedAt: timestamp(),
    createdBy: text().notNull(),
    /** Who made it, for review notices (null on rows saved before 2026-11-08). */
    createdById: text(),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId, t.createdAt), index().on(t.orgId, t.reviewStatus)],
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
    /** When the creator confirmed they may use the start frame and the likeness of anyone in it. */
    consentedAt: timestamp(),
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

/**
 * Video editor projects (B10). `timeline` is the edit (src/lib/editor/timeline.ts); `media` lists the
 * files uploaded into this project (asset kind editor-media), removed with it. Exporting renders the
 * timeline in the worker (FFmpeg): status pending → running → ok | failed, with the MP4 in `outputAssetId`.
 */
export const videoEdits = pgTable(
  "video_edits",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    timeline: jsonb().$type<EditTimeline>().notNull(),
    media: jsonb().$type<EditorMedia[]>().notNull().default([]),
    status: text().$type<"draft" | "pending" | "running" | "ok" | "failed">().notNull().default("draft"),
    outputAssetId: text(),
    outputMime: text(),
    outputSeconds: real(),
    error: text(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
    renderedAt: timestamp(),
  },
  (t) => [index().on(t.orgId, t.updatedAt), index().on(t.status, t.updatedAt)],
);

/**
 * Warnings sent before the `cleanup-videos` schedule removes old videos (src/lib/video/storage.ts):
 * everything made (or, for editor projects, last changed) at or before `through` was announced at
 * `sentAt`, and is only removed once that is at least 7 days ago.
 */
export const videoCleanupNotices = pgTable(
  "video_cleanup_notices",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    through: timestamp().notNull(),
    count: integer().notNull(),
    sentAt: now(),
  },
  (t) => [index().on(t.orgId, t.sentAt)],
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
    /** One of the starter set every org gets (copies of the built-in scenes), so not a team scene in Generate. */
    starter: boolean().notNull().default(false),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId)],
);

/** The org's own product types inside a category (next to the built-in ones), named by an admin. */
export const productTypes = pgTable(
  "product_types",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    category: text().notNull(),
    name: text().notNull(),
    createdBy: text().notNull(),
    createdAt: now(),
  },
  (t) => [index().on(t.orgId, t.category)],
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
    /** Who wrote it, for review notices (null on rows saved before 2026-11-06). */
    createdById: text(),
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

// ── Chat (assistant) ─────────────────────────────────────────────────────────────────────────

/** A conversation with the assistant. Private to the user who started it, inside one org. */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    createdAt: now(),
    /** Last message time: the thread list is sorted by it. */
    updatedAt: now(),
  },
  (t) => [index().on(t.orgId, t.userId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    threadId: text()
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text().$type<"user" | "assistant">().notNull(),
    content: text().notNull(),
    /** Assistant replies: who wrote it. Null on the user's messages. */
    provider: text().$type<ProviderId>(),
    model: text(),
    /** `stopped`: the user stopped the reply part-way; the text is what was written. */
    status: text().$type<"ok" | "stopped">().notNull().default("ok"),
    createdAt: now(),
  },
  (t) => [index().on(t.threadId, t.createdAt)],
);

// ── Characters ───────────────────────────────────────────────────────────────────────────────

/**
 * A saved character the team reuses across AI Director scenes: a name, how they look, and 1–3
 * reference images (asset kind `character`). Photos of a real person need the uploader's
 * confirmation of rights and consent (`consentedAt`, audited); a portrait generated from the
 * description is an AI person and needs none.
 */
export const characters = pgTable(
  "characters",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    description: text().notNull().default(""),
    source: text().$type<CharacterSource>().notNull(),
    images: jsonb().$type<CharacterImage[]>().notNull(),
    consentedAt: timestamp(),
    consentedBy: text(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.orgId, t.updatedAt)],
);

// ── AI Director ──────────────────────────────────────────────────────────────────────────────

/**
 * One AI Director project: the idea and settings, the script (scenes), and where it is. Scene
 * images are video-frame assets, scene videos are Studio video jobs (also in History), and the
 * finished video is a video editor project (`editId`) the team can keep editing.
 */
export const directorProjects = pgTable(
  "director_projects",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    idea: text().notNull(),
    title: text().notNull().default(""),
    settings: jsonb().$type<DirectorSettings>().notNull(),
    scenes: jsonb().$type<DirectorScene[]>().notNull().default([]),
    status: text().$type<DirectorStatus>().notNull().default("planning"),
    /** The step a failed project stopped in (retry resumes there). */
    failedStep: text().$type<DirectorStep>(),
    error: text(),
    /** The voice-over's editor file, once made. */
    voiceAssetId: text(),
    editId: text(),
    /** While one worker advances the project, others wait (two finished scenes can arrive together). */
    lockedUntil: timestamp(),
    createdBy: text().notNull(),
    createdById: text().notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.orgId, t.updatedAt), index().on(t.status, t.updatedAt), index().on(t.editId)],
);

// ── Agents ───────────────────────────────────────────────────────────────────────────────────

/**
 * One agent run: the user's goal and what the agent did (its words and tool calls, in order).
 * Private to the user who started it, like chat threads; what the tools made (copy, images) is saved
 * to the team's Copy and History as usual.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text().primaryKey(),
    orgId: orgId(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goal: text().notNull(),
    status: text().$type<AgentRunStatus>().notNull().default("running"),
    steps: jsonb().$type<AgentStep[]>().notNull().default([]),
    /** Why the run failed (a job or provider code). */
    error: text(),
    provider: text().$type<ProviderId>(),
    model: text(),
    createdAt: now(),
    /** Last change: a running run not updated for a while is closed by the maintenance job. */
    updatedAt: now(),
    finishedAt: timestamp(),
  },
  (t) => [index().on(t.orgId, t.userId, t.createdAt), index().on(t.status, t.updatedAt)],
);
