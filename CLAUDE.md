# Imagine AI (y-imagine)

Multi-tenant BYOK AI SaaS: client companies connect their own OpenAI / Anthropic / Gemini /
OpenRouter keys and use AI product-content features (recolor, lookbooks, A+ content, chat, agents, copy).

**Full development plan: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md). Read it before starting work, and update its phase status as phases complete.**

## Rules
- Stack: Next.js App Router (TS, Node runtime), Tailwind + shadcn/ui, next-intl (en LTR / ar RTL),
  Clerk (identity only), Postgres + Drizzle, AI SDK, S3-compatible bucket, BullMQ + Redis.
- Hosting: **Railway** (not Vercel). Services: web (`/api/health`), worker (`npm run worker`; also runs the schedules,
  so no separate cron service), Postgres, Redis, Bucket. Do not add Vercel-only APIs.
- Tests: `npm test` (Vitest, `tests/unit` + `tests/integration`, own `imagine_test` DB, outside services stubbed) and
  `npm run test:e2e` (Playwright on the production build, run `next build` first). Add tests with every change.
- Errors: handled-but-unexpected failures go through `reportError(message, error, ids)` (`src/lib/observability/report.ts`),
  not `console.error` with details. Sentry events are scrubbed (`sentry-options.ts`); never add PII or secrets to context.
- Rate limits: `hit(name, id, LIMITS.x)` from `src/lib/rate-limit.ts` (Redis, per-process fallback). AI jobs are limited
  centrally in the registry; new scheduled work goes in `src/lib/jobs/` + `SCHEDULES`. Bulk work is one idempotent job
  per item (claim `pending` first), dispatched to a BullMQ queue run by `src/worker.ts`, or in-process without Redis.
- Never hardcode an AI provider. Resolve them through `getImageProvider(actor, feature)` / `getTextProvider(actor, feature)` /
  `getVideoProvider(actor, credits)` in `src/lib/ai/registry.ts` (per-tool `model_preferences`, else Automatic). All charge
  through `runJob`: a tool's cost from Admin → Credits (`src/lib/credits.ts`), video by length × resolution. Video options come
  from the model capability registry (`src/lib/ai/video-models.ts`), never hardcoded in the UI.
- Provider keys: encrypted at rest (AES-256-GCM envelope), decrypted only server-side, never sent to
  the client or logged. Only org `admin` can manage keys. Every key action is audit-logged.
- E-commerce catalogs: never hardcode a platform. Add a connector in `src/lib/catalog/connectors/` (definition + factory), register it in `src/lib/catalog/registry.ts`, add labels under `Integrations` in messages. Store/API fetches go through `src/lib/safe-fetch.ts`.
- Org secrets (AI keys, store credentials) use `src/lib/crypto/secrets.ts`; never return them to the client.
- Every table has `org_id`. Query through `db.forOrg(orgId)`. Only exception: platform (super-admin) reads in
  `src/features/admin/actions.ts`, which re-check `platformRole` in every action and never expose secrets.
- Auth: get the user/org from `getWorkspace()` (org-scoped) or `requireSuperAdmin()` (console), never from client input.
  Clerk owns identity only (when its keys are set; else the local login). Orgs, memberships, roles and the platform
  role live in Postgres; account operations go through `src/lib/auth/users.ts` / `session.ts`, never Clerk directly.
- Read-only org view (super admin): a Server Action that only reads calls `getWorkspace({ read: true })`; anything else is refused
  during a view. Reads must not write, lazy seeding included.
- RTL: one component per screen, using logical Tailwind classes (`ms-`, `pe-`, `start-`, `end-`), never left/right.
- UI follows the **icon-rail** design (Figma Sections 1/3/4/5, master `98:32`), moving toward a dark, creation-first look
  (user references: Higgsfield, Dreamina; patterns only) in Part C of the plan. **Keep the rail and its popup menus as they are**,
  and never change features in UI steps. Brand is "Imagine AI", never "Magnific".
  Tool pages use the **prompt dock** (`src/components/app/config-panel.tsx`): results on top, a compact prompt card pinned
  at the bottom (Single/Bulk row, the main input inline, one chip per `Section` with a `summary`/`icon` opening its
  panel). No side config panels. Image tools save every result to History and show a results feed (`ResultFeed` +
  `useToolFeed`: this visit's results, or a product's results when opened from History); generated images open in
  `ImageViewer` (zoom, download, share).
- "Credits" = plan job quota (jobs/month), not money. Provider cost is shown as an estimate only.
- Billing: Stripe is the source of truth for paying orgs. Only `syncSubscription` (`src/lib/billing/billing.ts`, fed by
  `/api/stripe/webhook`) writes plan/billing fields; prices (AED, monthly + yearly) live in Stripe, mapped by env price ids.
- Figma source: file `n2sZrjuN0QtS3mYXaPXiSz` ("Imagine AI"). Load the `figma-design-to-code` skill before `get_design_context`.

@AGENTS.md
