# Imagine AI — Development Plan (BYOK multi-provider AI SaaS)

## Context
Greenfield repo `y-imagine` (empty). Imagine AI is a multi-tenant SaaS for retail/e-commerce teams
to produce product content with AI: product recolor, lookbooks,
A+ content, chat/agents, and copy generation. Each client **company brings its own AI keys**
(BYOK): OpenAI, Anthropic, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint. Usage is
billed to the client's provider account; we charge a SaaS subscription. The UI comes from 20 Figma
frames (file `n2sZrjuN0QtS3mYXaPXiSz`), in English LTR and Arabic RTL.

"Antigravity" is Google's agent IDE and has no app API key. Google is supported through the
**Gemini API key** (Google AI Studio).

## Decisions (locked)
| Area | Choice |
|---|---|
| Hosting | **Railway** (decided 2026-11-02, replacing Vercel). One project, services: `web` (`next start`), `worker` (BullMQ), `cron` (key re-validation), Postgres, Redis, Bucket. Node 22+ |
| Framework | Next.js App Router, TypeScript, Node runtime |
| UI | Tailwind + shadcn/ui; tokens taken from Figma; logical CSS props (`ms-/me-/ps-/pe-`) for RTL |
| i18n | `next-intl`, locales `en` (LTR) + `ar` (RTL), `/[locale]/...` routes, Arabic font Cairo |
| Auth / tenancy | Clerk for identity only (2026-11-03, user decision); tenants, memberships and roles in Postgres. Roles: `admin`, `editor`, `viewer` |
| DB | **Railway Postgres** + Drizzle ORM + migrations (run on deploy as a pre-deploy command) |
| AI | AI SDK (provider-agnostic library: `ai` + `@ai-sdk/*`); provider instance built **per request** from the org's decrypted key |
| Files | **Railway Bucket** (S3-compatible, private) via `@aws-sdk/client-s3` + presigned URLs. Portable to R2/S3 |
| Long jobs | **BullMQ on Railway Redis**; the `worker` service runs from the same repo (`npm run worker`) for batch recolor, lookbook render and bulk A+ |
| Rate limit / cache | Railway Redis (same instance) |
| SaaS billing | Stripe subscriptions (plan limits on seats/projects, not on tokens) |
| Design system | **Light + 72px icon rail** (Figma Sections 1/3/4/5, master 98:32). Rebrand to Imagine AI. Dark screens are only a reference for analytics, team settings and lookbook content, restyled to light |
| Credits | **Plan job quota**: each plan includes N jobs/month, the badge shows jobs remaining, and estimated provider cost is shown separately. We never bill tokens |

## Architecture
```
Browser ─► Route handler / Server Action
             │ auth() → userId, orgId, role
             ▼
       lib/ai/registry.ts
             │ load provider_credentials(orgId) → decrypt → createOpenAI/Anthropic/Google/OpenRouter
             │ resolve model via model_preferences(feature)
             ▼
       features/{chat,agent,image,recolor,lookbook,aplus,copy}
             │ streamText · generateText · generateImage · tools
             ▼
       usage_events + generations  ─►  Analytics dashboard
```

### Key security (critical)
- Envelope encryption: AES-256-GCM per-row data key, wrapped by `KEY_ENCRYPTION_KEY` (rotatable;
  move to KMS later). Store `encrypted_key`, `iv`, `key_last4`. The browser only ever sees `sk-…abcd`.
- Validate on save (list-models call); store available models and status. Re-validate daily (cron).
- Only `admin` can add, rotate or delete keys. Every key action goes to `audit_log`.
- Decrypt only server-side at call time. Scrub keys from logs and error messages.
- Provider errors (401 / quota / rate limit) map to clear UI messages ("Your OpenAI key has no credits").

### Capability matrix
`capabilities[provider] = { chat, tools, vision, imageGen, imageEdit }`. Anthropic has no image
generation, and OpenRouter capabilities depend on the model. The UI disables features the org's keys
can't serve and links to Settings → AI Providers.

### Data model (Drizzle)
`organizations`, `provider_credentials`, `model_preferences(feature→provider/model)`, `projects`,
`products(sku, name_en, name_ar, category)`, `assets(kind upload|generated, blob_url, product_id)`,
`generations(feature, input, output, provider, model, status, user_id)`, `lookbooks`,
`lookbook_items`, `aplus_documents(blocks jsonb, locale)`, `conversations`, `messages`,
`usage_events(tokens_in/out, images, est_cost_usd)`, `audit_log`, `subscriptions`.
Every table has `org_id`. All queries go through a `db.forOrg(orgId)` helper to stop data leaking
between tenants.

## Screens → routes (from Figma)
| Figma frame | Route | Notes |
|---|---|---|
| analytics-dashboard (30:6) / arabic-rtl (35:6) | `/[locale]/dashboard` | usage, generations, cost per provider/user |
| lookbook-builder (30:265) / arabic-rtl (35:224) | `/[locale]/lookbooks/[id]` | drag products, AI layout + copy, export |
| team-settings (30:430) / arabic-rtl (35:370) | `/[locale]/settings/team` | members, roles, invites; plus a new **AI Providers** tab |
| product-recolor-workspace (35:545) | `/[locale]/recolor` | upload product, pick colors → image-edit model |
| aplus-content-editor (35:706) | `/[locale]/aplus/[id]` | block editor, AI writes EN + AR copy |
| IMAGINE LTR (19:2) / RTL (7:2) | app shell + remaining screens | full-flow canvases; split into routes during Phase 1 |
| Section 1 / 4 (Home Appliances, Mobile & Accessories) / 5 | storefront-preview templates | how generated content looks on category pages |
| case-study-intro (7:10977), before-after-rtl-comparison (7:11111) | `/` marketing site (optional) | presentation pages, not app screens |
| resize-tool (35:895) | `/[locale]/resize` | batch resize, not AI |
| Section 1 (98:32), Section 3 (98:10776), Section 4 ×3, Section 5 (98:32265) | `/generate`, `/recolor`, `/aplus`, `/history`, `/looks` | light theme, about 49 frames each, same screens with category copy (furniture, electronics, appliances, mobile, fashion), so category presets become **per-tenant config**, not separate screens |
| 98:32266, 98:54062, 98:43193 | `/` public template explorer | logged-out landing page |
| 49:56 | n/a | case-study deck, reference only |

### Figma inventory findings, batch A (2026-11-02)
- 19:2 (EN, 24 frames) and 7:2 (AR, 23 frames) are an earlier, less complete dark version of the same
  flows. The RTL canvas is a 1:1 mirror.
- 30:6 analytics: KPI cards with sparklines, 30-day chart, top categories donut, activity feed, credit
  utilization, top creators.
- 30:430 team settings: the settings sub-menu is General / Team Members / Roles & Permissions /
  **API Keys** / Billing / **Integrations**. Roles are Admin / Editor / Viewer, plus departments and
  per-member credits used.
- 30:265 lookbook builder: masonry board, "AI Suggest Layout", property inspector.
- 7:10977 and 7:11111 are designer case-study pages. 7:11111 defines 6 RTL rules: use it as the RTL spec.
- **Don't copy these defects:** 19:473 has its LTR form aligned right, and 35:224's RTL sidebar is crushed to 80px.
- The case study and Sections 1/5 call the product "Magnific", a real Freepik product. Ship it only as **Imagine AI**.

Arabic frames are mirrors of the English ones. Build each screen once and drive the layout with
`dir` + logical properties, not separate components.

### Figma inventory findings, batch B (2026-11-02)
**Two design systems are in the file. Pick one before Phase 0.**
- **A, dark "Imagin AI"** (`35:*` frames): 280px text sidebar, violet accent (about #7C5CFF), header 80px.
  Screens: recolor 35:545, A+ editor 35:706, resize 35:895, RTL dashboard 35:6, RTL team settings 35:370.
- **B, light** (`98:*` sections): black 80px top bar, 72px icon rail, 404px numbered config panel,
  canvas #EEF1F7, indigo #4F46E5. It has a full set of states (empty, loading, result, compare, failed, save).
  The header is copied from **Magnific**, so its brand and logo must be replaced. Sections 3, 4 (Furniture),
  4 (Home Appliances) and 4 (Mobile) are the same about 48 screens with category presets. 98:10776 is the master.
- **49:56** is a 15-slide case-study deck. It is reference only, but it defines the IA: 7 modules, the same
  URLs for LTR and RTL (direction is a user preference), the Arabic font **Cairo**, and tokens layered
  Primitive → Semantic → Component.

**Features the designs add:**
| Feature | Route | AI? |
|---|---|---|
| Lifestyle image generation (SKU + product PNG + scene + style + ratio + "Improve with AI" prompt rewrite) | `/generate` | image gen + LLM |
| Recolor via swatch/texture image + Preservation Report | `/recolor` | image edit + vision |
| A+ images with rendered title and feature text | `/aplus` | image gen |
| History: filters, detail drawer, multi-select, **Upload to Website** | `/history` | no (store publish integration) |
| Shop the Look: builder (up to 20 products), mood boards, product swap, room backgrounds admin | `/looks` | image gen |
| Batch image resize: presets for Amazon / Shopify / Instagram, ZIP export | `/resize` | no (sharp pipeline + queue) |
| QR Gen, Bitly in the rail | later | no |

**Gaps to design:** no screen for adding AI provider keys exists (only the "API Keys" item in the
settings nav). The same goes for billing, roles and permissions, and the per-job "Select AI model" step.

**Credits vs BYOK:** the designs charge "credits" per job. With BYOK the client pays the provider
directly, so credits should mean the plan's job quota (or be shown as estimated provider cost),
not money we bill for tokens.

## E-commerce catalog integration (per organization)
Each org connects its own store/PIM once in **Settings → Integrations** (admin only). Users then fetch product
images + name/category by SKU in Generate, Recolor and A+; the same connection powers Shop the Look product search
and History → "Upload to Website".

- **Pluggable, platform-agnostic (SaaS requirement, 2026-11-02):** any org can connect any platform. Each connector in
  `src/lib/catalog/connectors/*` exports a *definition* (type, settings fields incl. which are secret) plus an implementation
  of `CatalogConnector { test, findBySku }` returning one normalised `CatalogProduct`. The Integrations UI renders forms from
  the definition, so adding a platform = adding one connector file + its labels.
  Shipped: `shopify` (shop domain + Admin API token, GraphQL; OAuth app once deployed), `magento` (base URL + integration
  token, optional Arabic store view), `woocommerce` (consumer key/secret), `custom-rest` (URL template with `{sku}`,
  auth none/bearer/API-key header/basic, JSON field mapping), `demo`. Next: CSV/XML feed, Salesforce Commerce, BigCommerce.
- **Storage**: `catalog_connections(org_id, type, name, config jsonb, encrypted_secret, is_default, created_by, last_tested_at)`.
  Secrets use the same envelope encryption as AI keys (`src/lib/crypto/secrets.ts`, `KEY_ENCRYPTION_KEY`).
  Locally: `.data/dev-store.json` (gitignored) until Postgres.
- **Fetching** goes through `src/lib/safe-fetch.ts` (https only, private IPs blocked, no redirects, size/time caps).
  Imported images are normalised to PNG on the server, so they feed every tool.
- **Multi-store**: several connections per org (e.g. UAE + KSA), one default. Store categories map to catalog presets.
- **Later**: `products` cache table + scheduled sync (BullMQ) to respect store rate limits; write scope only for publishing.

## Platform administration (super admin)
Imagine AI staff need to run the SaaS itself: onboard companies, manage accounts, watch health, and
pull switches during incidents. This is a **platform** role, separate from the org roles
(`admin` / `editor` / `viewer`): a super admin manages tenants, while an org admin manages one tenant.

**Scope (console at `/[locale]/admin`, entry from the rail "More" menu and the account menu):**
| Page | What it does |
|---|---|
| Overview | Orgs (active / suspended), users, active sessions, 30-day jobs and failure rate across every org, jobs by tool, most active orgs, recent failures, recent admin actions, banner when a control is on |
| Organizations | List with plan, credits used / quota, members, invites, last job, status. Create an org with its first admin (existing user joins; new email gets a temp-password account or an invitation), edit plan + custom monthly credits, suspend (with reason) / reactivate |
| Organization detail | Quota, members (add, change role, remove; last-admin guard), 30-day chart, AI key **status and ••••last4 only**, store connections, org audit log |
| Users | Every account and its orgs. Create a user (temp password, optional org + role, optional super admin), reset password, sign out everywhere, enable / disable, grant / revoke super admin (can't demote yourself or the last super admin) |
| Monitoring | Job stream across orgs (org, tool, user, provider/model, duration, error) with org / status / tool filters, plus the platform-wide audit log |
| Controls | Maintenance mode + message (blocks everyone but super admins), open sign-ups on/off, default plan for new sign-ups, per-tool kill switches (jobs refused before the provider and not charged) |

**Enforcement points (never only in the UI):**
- `getWorkspace()` (`src/lib/workspace.ts`): no session → `/sign-in`; maintenance or suspended org →
  `/blocked?reason=…`; super admins pass through so they can fix things.
- `requireSuperAdmin()` gates the console layout; **every** action in `src/features/admin/actions.ts`
  re-checks the platform role itself.
- AI registry `assertCanRun()` (`src/lib/ai/registry.ts`): kill switches and the org's monthly quota,
  before any provider call. Blocked jobs are not usage events.
- `signUp`: honours "sign-ups off" (invited people can still join) and the default plan.
- Every console action writes `audit_log` (org rows, or `org_id = 'platform'` for users/settings).

**Security rules for the console:**
- Platform reads are the one deliberate exception to `db.forOrg()`: they live only in
  `src/features/admin/actions.ts` and use explicit `listAll*` repository functions.
- Super admins never see or decrypt AI keys or store credentials: status + last4 only.
- Bootstrap only through config (`SUPER_ADMIN_EMAILS`), never self-service. With Clerk: require MFA for
  super admins, short session lifetime for the console, optional IP allowlist on `/admin`.

**Local-first build (done 2026-11-03):** demo auth stands in for Clerk: scrypt passwords
(`src/lib/auth/password.ts`), opaque session cookie with only its SHA-256 stored so sessions can be
revoked (`src/lib/auth/session.ts`), users / organizations / platform settings in the dev store,
memberships reuse `members` (invitations become memberships on sign-up).

**Production path (with Phase 0 step 2 / Phase 4):**
1. **Clerk** replaces `lib/auth/*`: users and orgs come from Clerk, `platformRole` lives in
   `publicMetadata`, set only by a server script or the console (Clerk Backend API). Disable, reset
   password and sign out everywhere map to Clerk's ban, password and session-revoke APIs. Org creation
   from the console calls `clerk.organizations.createOrganization` + invitation.
2. **Postgres tables:** `organizations(id, clerk_org_id, name, plan, credits_override, status,
   suspended_reason)`, `platform_settings` (one row, cached in Redis about 30s, busted on save),
   `audit_log.org_id` nullable for platform rows. Clerk webhooks (`organization.*`, `user.*`,
   `organizationMembership.*`) keep `organizations` / `members` in sync.
3. **Billing:** plan changes in the console become Stripe subscription updates. `credits_override` stays
   a manual enterprise lever. Quota checks read a Redis counter per org per month, not a table scan.
4. **Monitoring:** keep the in-app stream for product-level questions. Add Sentry (errors), Railway
   metrics + `/api/health` (web, worker, cron), and BullMQ queue depth / failed jobs on Overview once
   the worker exists. Alerts: failure rate > 10% per provider over 15 min, worker queue age, key
   re-validation failures.
5. **Impersonation (later):** "view as org admin" through Clerk actor tokens, read-only by default,
   time-boxed, with a banner and audit rows on start and end. Not built yet, by design.
6. **Tests:** role gates on every admin action (an org admin gets `forbidden`), last-admin /
   last-super-admin guards, suspended org blocked across the app and API routes, kill switch refuses
   jobs without a usage event, sign-ups-off still lets invitees in.

## Project structure
```
app/[locale]/(marketing)/  app/[locale]/(app)/{dashboard,recolor,lookbooks,aplus,chat,settings}/
app/api/{chat,generate,webhooks/clerk,webhooks/stripe}/
components/ui (shadcn)  components/app (shell, sidebar, cards, charts)
lib/ai/{registry,capabilities,errors,usage}.ts  lib/crypto/keys.ts  lib/db/{schema,client}.ts
features/<feature>/{actions.ts,service.ts,components/}
lib/storage/s3.ts  lib/queue/{connection,queues}.ts  worker/index.ts  scripts/revalidate-keys.ts
messages/{en,ar}.json  drizzle/
```

## Phases
**Phase 0: Foundation (week 1)**
`create-next-app`, Tailwind, shadcn, next-intl en/ar with RTL, Clerk orgs, Railway Postgres + Drizzle schema,
Figma tokens → Tailwind theme, app shell (sidebar/topbar) in both directions. Save plan to `docs/` +
`CLAUDE.md` + memory.

**Phase 1: BYOK core (week 2)**
Settings → AI Providers: add, validate, rotate and delete keys; encryption; provider registry;
capability matrix; per-feature model preferences; audit log. Finish mapping the remaining Figma frames.

**Phase 2: Features (weeks 3–5)**, in this order:
1. Chat/assistant (streaming, history)
2. Copy generation (product descriptions EN/AR)
3. Product recolor (image edit: OpenAI gpt-image / Gemini)
4. A+ content editor
5. Lookbook builder
6. Agents with tools (catalog search, generate image, write copy)

Each feature writes `generations` + `usage_events`.

**Phase 3: Team & analytics (week 6)**
Team settings (invite, roles via Clerk), analytics dashboard from `usage_events`, role gates.

**Phase 3b: Platform administration** (see "Platform administration" above). Local version done;
moves to Clerk + Postgres with Phase 0 step 2.

**Phase 4: SaaS & hardening (week 7)**
Stripe plans + webhooks, rate limiting, BullMQ batch jobs, error states for provider failures,
key re-validation cron service, marketing pages, production deploy on Railway (custom domain, health check).

## Implementation notes
- Implement each Figma screen with `get_design_context` (load the `figma-design-to-code` skill first),
  reusing shared components rather than copying generated code.
- Never hardcode a provider. Everything goes through `registry.getModel(orgId, feature)`.

## Verification
- Unit: encrypt/decrypt round trip, registry picks the right provider, capability gating, `forOrg` isolation.
- Integration: add a real key per provider in dev → validate → run chat, copy, and recolor; check
  `usage_events` rows.
- Security: no key in client bundles, network responses or logs (grep logs); viewer/editor can't touch keys.
- UI: each screen checked against its Figma screenshot in `en` and `ar` (RTL mirror), at desktop and mobile widths.
- E2E (Playwright): sign up → create org → add key → generate → see it on the dashboard.

## Remaining roadmap (one step at a time, from 2026-11-06)
Build in this order, one step per session. A step is done when it matches its "Done when" line, has tests, passes
tsc + eslint + Vitest + the Playwright specs it touches, works in en + ar, and has a Progress entry below. Estimates
are working days with Claude. **Part A gets the product live; Part B ships as updates after launch.**

### Part A: launch (about 3 weeks)
| # | Step | Scope | Done when | Est. |
|---|------|-------|-----------|------|
| A1 ✅ | Video model picker | Add `video` to the model choices in Settings → API Keys (Gemini Omni / Seedance); Studio shows which model is used | An org with both keys can choose Seedance, and the Studio uses it | 0.5 |
| A2 ✅ | Tool error messages | Proper messages for `quota_exceeded`, `feature_disabled`, `not_in_plan` and content rejected on every tool screen | Each code shows its own message instead of the generic failed state | 0.5 |
| A3 ✅ | Emails | Transactional email service (provider through an env setting): invites, password reset (local login), reviewer notices for copy approvals | Invite and approval emails arrive, with en/ar templates | 1–2 |
| A4 ✅ | Clerk profile sync | `user.updated` webhook → name/email synced to the users table | Changing a name in Clerk shows in Team | 0.5 |
| A5 ✅ | Chat / assistant | Streaming chat through `getTextProvider`, saved threads per user, org-scoped, credits per message | Users chat, reload, and see their history; viewers read only | 2–3 |
| A6 ✅ | Video safety + storage | Content-rejected code, likeness consent checkbox, storage quota per plan, cleanup job in `SCHEDULES` | Over quota is refused with a message; old clips removed on schedule | 2 |
| A7 ✅ | Marketing pages | Home, features, pricing (Stripe prices), legal pages, en/ar | Signed-out visitors see the site and can sign up | 2–3 |
| A8 | Live-key testing | Real OpenAI, Gemini (image + Omni video), BytePlus Seedance, Anthropic, OpenRouter, Clerk, Stripe test mode, Sentry; fix what turns up | Every tool runs once with a real key; the open checks in the Progress entries are closed | 3–5 |
| A9 | Production deploy | Railway: web, worker, Postgres, Redis, Bucket, custom domain, health check, env secrets, backups | The production URL works end to end with a paying test org | 1–2 |

### Part B: after launch (about 6–9 weeks)
| # | Step | Scope | Done when | Est. |
|---|------|-------|-----------|------|
| B1 ✅ | More video providers | Kling adapter, same pattern as `byteplus-video.ts` (OpenAI dropped: its Videos API shut down 2026-09-24) | Each one selectable and tested with the API stubbed | 1–2 |
| B2 ✅ | Cinema controls | Camera / lens / lighting presets → native parameters where a model has them, else labelled prompt text | Presets in the Studio, driven by the model's capabilities | 1 |
| B3 | Agents with tools | Agent runs with catalog search, generate image, write copy; steps shown live; credits per tool call | An agent finds a product, writes copy and makes an image in one run | 3–4 |
| B4 ✅ | Image approvals + publish gate | Review status for History images; "Upload to Website" only for approved items when the org turns it on | Same review flow as copy, for images | 1–2 |
| B5 | Prompt helpers | "Improve with AI" for merchant text; per-team suggestions from saved results | Both available in Generate and Recolor | 1–2 |
| B6 | Team scenes and catalog per tenant | Save uploaded scenes as team scenes; product types and scenes per org in the DB; category filters in History/board; delete look backgrounds with their look | Two orgs see different product types and scenes | 3–4 |
| B7 ✅ | Bulk improvements | Choose which catalog image to use; Arabic titles from `nameAr` for bulk A+ | Both available in the bulk tools | 1 |
| B8 | Store publishing | Real Shopify and Magento image upload through the catalog connectors | An approved image appears on a test store | 3–5 |
| B9 | Impersonation (done 2026-11-09, see Progress) | Super-admin "view as org admin", read-only, audited, time-limited | Console can open an org view and every visit is in the audit log | 1–2 |
| B10 | Video editor (FFmpeg in the worker) | Trim, merge clips, subtitles, music / voice-over, export sizes (9:16, 1:1, 16:9) | A user cuts two clips together with subtitles and downloads the MP4 | 4–6 |
| B11 | AI Director | Idea → script → scenes → storyboard images → a video per scene → assembled MP4 (uses B10) | One prompt gives a finished multi-scene video | 3–5 |
| B12 | Audio | Voice-over (TTS) and music generation, plan-gated and priced in Admin → Credits | Audio can be generated and added to an editor project | 2–3 |
| B13 | Characters + motion | Saved characters reused across scenes, motion control where providers support it, consent kept | The same character appears across AI Director scenes | 3–5 |
| B14 | Polish (mostly done 2026-11-09, see Progress) | Copy fixes (A+ title overlap, Arabic units), performance and accessibility pass | Known small issues closed | 1–2 |

## Progress
- **2026-11-02, Phase 0 (part 1) done:** Next.js 16.4 + Tailwind 4 + shadcn (base-nova, RTL), next-intl en/ar
  via `src/proxy.ts`, Figma tokens in `src/app/globals.css` (Geist / Geist Mono / Inter / Cairo), app shell
  (`src/components/app/top-bar.tsx`, `icon-rail.tsx`), and the Generate empty-state screen (Figma 98:33) in
  `src/features/generate/`. User and credits come from the stub `src/lib/workspace.ts`.
- **2026-11-02:** hosting switched from Vercel to **Railway** (see Decisions).
- **2026-11-02, local-first (user decision):** build and review all UI and functionality **locally first**.
  No Clerk, Railway or cloud DB until the user signs off on the UI. Use demo auth (`getWorkspace()` stub),
  local data, and a **`demo` AI provider** behind the same registry interface so every flow works without keys.
  Screen order: Generate (all states) → Recolor → A+ → History → Shop the Look → Resize → Settings
  (API keys, team) → Analytics.
- **Deferred until UI sign-off:** Clerk, Railway deploy (Postgres + Drizzle and Node 22 done 2026-11-03, see below).
- **2026-11-02, Generate screen complete (local):** all Figma states (empty 98:33, filled 98:699, generating 98:940,
  result 98:1192, compare 98:1429, failed 98:1668, export 98:1901) work end-to-end in en + ar via the server action
  `src/features/generate/actions.ts` → `src/lib/ai/registry.ts` → demo provider (`src/lib/ai/providers/demo.ts`,
  SKU containing `FAIL` simulates a failure). Export encodes PNG/JPEG/WebP client-side; Save to Library writes to
  `src/features/history/library-store.ts` (localStorage until Postgres). Arabic uses Western digits (`src/lib/format.ts`).
  Not yet: Improve with AI, undo/redo, credit deduction.
- **2026-11-02, Recolor screen complete (local):** Figma 98:2144/2350/2557/2789. Swatch upload → `analyzeSwatch`
  (demo measures dominant colour + finish with sharp) → `recolorProduct` (demo tints the uploaded product with sharp,
  returns a WebP data URL + preservation report). Original / Split Slider / Recolored views, Cancel Generation
  (client discards the late result), Download, Use Image → library. Shared panel/canvas/upload components now live in
  `src/components/app/{config-panel,workspace-canvas,upload-inputs}.tsx`; shared strings in the `Workspace` namespace.
  Sample fixtures: `public/demo/sofa-grey-base.png` + `public/demo/swatch-beige-linen.png`.
- **2026-11-02, A+ Images screen complete (local):** Figma 98:3026–98:4417. Product via upload or **From URL**
  (server fetch through `src/lib/fetch-image.ts`: https only, private/loopback IPs blocked, no redirects, 10 MB / 10 s caps),
  reference layout from library (bento / gallery) or upload, scene & style, title/subtitle + 2–4 feature blocks, output settings.
  Live HTML layout preview before generating; the demo provider composes a real WebP with sharp
  (`src/lib/image/compose-aplus.ts`, moved 2026-11-03: flood-fill background removal, text overlays, Arabic right-aligned and RTL column order).
  Result toolbar: Before/After, Regenerate, Edit Details, Export (shared `src/components/app/export-dialog.tsx`), Download.
  Category presets moved to `src/lib/catalog-presets.ts` (`Presets` message namespace). Figma frame index: `docs/FIGMA_FRAMES.md`.
- **2026-11-02, Catalog integrations complete (local):** Settings → Integrations (`/settings/integrations`, reached from the
  user menu, which also has the EN/AR switch). Pluggable connectors: Shopify, Magento, WooCommerce, Custom REST, Demo
  (`IMAGINE_DEMO=1`). Forms render from connector definitions (fields, secrets, `when`, `pattern`). Test before save,
  multi-connection with default, retest, remove. Secrets envelope-encrypted (`KEY_ENCRYPTION_KEY` in `.env.local`) in
  `.data/dev-store.json`; the UI only sees masked hints. "Fetch from catalog" under the SKU field in Generate, Recolor and A+
  (A+ also fills the title, Arabic name in AR). Verified against a live public API (dummyjson) through the Custom REST connector.
  Default time zone Asia/Dubai (next-intl). Not yet: products cache/sync, Shop the Look search, publishing (History).
- **2026-11-02, History complete (local):** `/history` per Figma 98:4682–98:8092. Library moved server-side: images in
  org-scoped asset storage (`src/lib/storage/assets.ts`, `.data/assets/`, served by `/api/assets/[id]` with an org check;
  becomes the S3 bucket), records in `src/lib/generations.ts` (becomes the `generations` table). Tools save through the
  `saveGeneration` action. Filters (SKU, date range in org TZ, mode, website status) with chips, sort, grid/list, pagination,
  multi-select (ZIP via fflate, mark uploaded, upload, delete), details drawer ("Open in tool" pre-fills `?sku=`),
  empty/no-results states. **Upload to Website** publishes through the default catalog connection (`publishImage`:
  demo simulated, Magento media API, Shopify staged upload + productCreateMedia; WooCommerce/Custom REST `canPublish: false`
  until assets are publicly hosted). Per-item status uploaded/failed with error. Real Shopify/Magento publishing still needs
  a live-store test.
- **2026-11-02, Shop the Look, pass 1 (local):** `/looks` tabs Builder / Mood Boards / History / Room Backgrounds
  (Figma 98:8279–98:10554). Catalog connectors gained `search()` (demo, Shopify, Magento, WooCommerce, Custom REST
  via optional search URL; others fall back to SKU lookup). Builder: search + URL import (server imports, cuts out the
  background, stores an org asset), up to 20 products, drag/resize canvas (fractions of canvas, physical LTR), layers
  (select/hide/lock), floating toolbar (bring front/lock/delete), undo/redo, grid, zoom, rearrange, look settings
  (title, prompt, 7 styles, 4 ratios, room background), `generateLook` (demo composites the arrangement onto the room
  with sharp), result view (Create Mood Board, Edit Look, Regenerate, Export, Save Look). Room Backgrounds admin
  (3 seeded per org, upload/edit/activate/delete, filters). Asset storage now has an org index (`getAsset`).
- **2026-11-02, Shop the Look, pass 2 (local):** `/looks/boards/[id]` mood board detail (Figma 98:9575): Edit Look
  (`/looks?look=<id>` loads the look into the Builder and saves back into it), Swap Product, Regenerate, Duplicate,
  Export. Swap Product panel (98:9733) suggests same-category catalog products; `swapLookProduct` replaces only the
  product fields, so the item keeps its id, x/y/w/h, lock/hidden and array index (layer order), then re-renders. History
  is now the Figma table (98:9865: search, mode/date filters, Export JSON, row menu) with the Look Details drawer
  (98:10207, Open Builder + Regenerate). Board cards and history rows have a menu: open, open in Builder, add/remove
  from Mood Boards, delete (`deleteLook` also deletes the render; product cut-outs are kept because duplicates share
  them). Looks gained `mode` (generated/regenerated). Re-renders replace and delete the previous render asset.
  Cache Components: `IconRail`, `TopBar` and `LooksTabs` read `usePathname` under Suspense so dynamic `[id]` routes
  prerender. No rotation exists on canvas items yet, so the swap note omits it.
- **2026-11-02, Resize complete (local):** `/resize` from the dark resize-tool frame (35:895) restyled to the light
  design (Section 1 has no Resize frame). Platform presets in `src/features/resize/presets.ts`: Amazon (Main 1000², Zoom
  2000²), Shopify (Product 2048², Collection 1024²), Instagram (Square, Portrait 1080×1350, Story 1080×1920), Custom W×H
  (16–8000 px). Queue of up to 50 PNG/JPEG/WebP (25 MB each, drag-drop or picker) with a per-row size, status
  (Queued / Processing / Done / Failed), per-row download and remove. Output settings: quality, format (WebP, JPEG, PNG,
  same as original), preserve aspect ratio with Crop to fill (center cover) or Fit on white; off stretches. Live crop
  preview with a rule-of-thirds frame. A row's status derives from a job key of its settings, so any change marks done
  rows Queued again. `POST /api/resize` (route handler, binary in/out, sharp, EXIF rotate, metadata stripped) runs two at
  a time from the browser; Download as ZIP uses fflate. Not an AI job, so no credits. On Railway, large batches should
  move to the BullMQ worker with results in the bucket.
- **2026-11-02, Team settings + AI provider keys (local):** Settings → Team Members (`/settings/team`, Figma 30:430 +
  Invite modal 30:621, restyled to light): member table (initials avatar, role badge, department, credits used this
  month = jobs from generations + looks, last active, pending invitations), search, role filter, Invite (email, role
  with a description of what it allows, department with suggestions), row menu (change role, change department,
  resend/revoke invitation, remove). Guards: admin only, you can't change or remove yourself, the last active admin
  can't be demoted or removed. Members live in `src/lib/team/members.ts` (becomes Clerk memberships + invitations;
  **no email is sent yet**, the UI says so). Settings → API Keys (`/settings/api-keys`, no Figma frame): one card
  per provider (OpenAI, Anthropic, Gemini, OpenRouter) with the capability matrix (`src/lib/ai/providers-info.ts`),
  add / rotate / re-validate / remove. Keys are validated before they're stored (`src/lib/ai/validate-key.ts`: list
  models, or OpenRouter's key endpoint, through `safe-fetch`, key only in headers; 401/403 → rejected, 402 → no
  credits, 429 → rate limited), envelope-encrypted in `src/lib/ai/provider-keys.ts` (`provider_credentials`), only
  the `••••last4` hint reaches the browser. Feature coverage table, recent key activity. Every key and member action
  goes to `src/lib/audit.ts` (`audit_log`). `IMAGINE_DEMO=1` accepts `demo-…` keys offline. `next.config.ts` sets
  `logging.serverFunctions: false` because dev logs printed Server Function arguments (keys, store credentials).
  The workspace stub gained `user.id` and `user.email`. **Not yet:** the registry still returns the demo provider
  (real AI SDK calls need Node 22+), per-feature model preferences, the daily re-validation cron, Roles &
  Permissions / General / Billing pages.
- **2026-11-03, Analytics complete (local):** `/dashboard` (Figma 30:6 restyled to light), reached from a new
  **Analytics** rail item after History. Every provider job is now recorded as a usage event by the registry
  (`src/lib/ai/registry.ts` wraps the provider; `src/lib/usage.ts` = `usage_events`: feature, user, provider, model,
  ok/error, duration), so call sites don't change; Recolor's swatch analysis is a helper step and isn't counted.
  Dashboard (`src/features/analytics/`): 7/30/90-day range; KPI tiles with change vs the previous period and
  sparklines (total jobs, success rate, average generation time, active creators); daily activity line chart (hand
  SVG, crosshair tooltip by pointer and arrow keys, "Show as table"); jobs by tool as bars (the Figma donut was
  replaced, bars compare better); recent saved work; monthly credit meter (one credit per successful job; failed
  jobs are free; plan size `creditsMonthly` on the workspace stub); top creators. Days are bucketed in the org time
  zone (`src/lib/time.ts`, shared with next-intl). Team's "credits used" now reads the same usage events. History
  starts empty: jobs before 2026-11-03 weren't logged. **Not yet:** the top-bar credit badge is still the stub
  (moves to live usage with Postgres/Clerk), quota enforcement, cost estimates per provider.
- **2026-11-03, QR Gen + Short Links (local):** `/qr` (rail "QR Gen"): single code or batch (one "name, link" per
  line, up to 200, ZIP of PNGs), code/background colour with a scan check (low contrast, light-on-dark), quiet zone,
  error correction (forced to High with a centre logo), PNG 512/1024/2048 or SVG. Rendered in the browser from the
  `qrcode` matrix (`src/features/qr/qr.ts`), no credits; `?url=` prefills it. `/links` (rail "Bitly"): the org admin
  connects the company's own Bitly token (validated with `GET /v4/user`, envelope-encrypted, audit-logged
  `bitly.connected/removed`); editors shorten URLs (http/https only) and see clicks (refresh pulls lifetime totals for the
  newest 50); viewers read only; "Make a QR code" opens `/qr` with the short link. `IMAGINE_DEMO=1` accepts `demo-…`
  tokens offline (demo links report 0 clicks). Not yet tested against a live Bitly account.
- **2026-11-03, Template picker + category presets (local):** the rail "+" opens `/templates` (Figma 19:3, "Explore
  Available Templates": search + 12 category cards, images from the frame in `public/templates/`). A card opens New
  Campaign (`/generate?category=`) with that category's preset. Presets from the Figma New Campaign variants:
  furniture (98:33), home appliances (98:54187), kitchen appliances (98:10777, "Electronics"), mobile (98:43318, which
  reuses the furniture scene photos) and fashion (98:32391); each sets the SKU example, scenes, styles and the style
  heading (`Presets.styleLabels`). A+ gets the same categories. The other 7 cards (outdoor, kids toys, cosmetics,
  lighting, outdoor kids toys, bathroom, decor) show "Coming soon" until they have presets. The demo provider returns
  the chosen preset scene for non-furniture scenes. Recolor is category-aware too: a category picker, and each preset's
  `recolorKind` picks the copy from the Figma recolor variants (`Recolor.kinds.*`: Recolor Fabric 98:273, Finish
  98:54427, Product 98:10777's 98:11017, Device 98:43558, Garment 98:32631); the category goes to the provider in
  `RecolorRequest.category`. `?category=` stays in step with the picker on both screens (`src/lib/use-category-param.ts`).
- **All screens in the local-first order are built.** **Next:** user UI review/sign-off, then Clerk + Postgres/Drizzle +
  Railway; or real provider routing first (needs Node 22+).
- **2026-11-03, Auth + dark mode + super-admin console (local):** No Figma frame exists for auth or admin
  (checked: 35:1714–36:246 are case-study deck slides; 19:2 / 7:2 are the older dark versions of screens
  already built). `/sign-in`, `/sign-up`, `/blocked` (`src/features/auth/`): brand panel from the case-study
  cover 35:1714, the form follows the theme. Sign-up creates the company org with the user as admin,
  or joins pending invitations. Sign-in is throttled to 5 attempts per 15 min per email. `src/proxy.ts`
  sends visitors without a session cookie to sign-in with `?next=`. `getWorkspace()` is real now (session
  → membership → org, org switcher when the user has several), and the credit badge shows live quota
  (plan − successful jobs this month). **Dark mode** for the whole app: `.dark` tokens in `globals.css`
  (design A palette), Light / Dark / System in the account menu, applied before paint by
  `THEME_SCRIPT`; status tints remapped; error text now uses `text-danger`. Rail gained a **More** menu
  (settings + admin console for super admins). Super-admin console: see "Platform administration".
  Seed: with `IMAGINE_DEMO=1` the first run creates org `demo-org` "Demo Store" (was "Danube Home (Demo)" before 2026-11-04) and super admin
  `demo@imagine.local` / `IMAGINE_DEMO_PASSWORD` (default `imagine-demo`), so existing data is kept.
  Verified in Chrome (Playwright): sign-in errors, sign-in, sign-up into a new org (dark), More menu,
  console pages in en + ar/RTL in light and dark, create org with owner, suspend → owner lands on
  `/blocked?reason=suspended`, a non-admin's `/admin` → `/generate`. **Not yet:** emails (invites,
  password reset), impersonation, provider-error copy for `quota_exceeded` / `feature_disabled` on
  the tool screens (they show the generic failed state).

- **2026-11-03, Production foundation step 1a: Postgres + Drizzle, blob storage, Node 22 (local):** user decision to
  start production hardening (order: Postgres → S3 → real AI providers → Clerk). Node pinned to 22 (`.nvmrc`,
  `engines`). Postgres 17 locally (`brew services`, DB `imagine`), `DATABASE_URL` in `.env.local`.
  Schema `src/lib/db/schema.ts` (15 tables, snake_case, timestamps exposed as ISO strings, tenant tables
  `org_id → organizations ON DELETE CASCADE`), migrations in `drizzle/` (`npm run db:generate`, `npm run db:migrate`
  = Railway pre-deploy command). `src/lib/db/index.ts` exports `db` with **`db.forOrg(orgId, tx?)`**
  (select/first/insert/update/delete that always add `org_id`); platform tables use `db` directly. Every repository
  moved off the JSON store with unchanged exports; `src/lib/store/dev-store.ts` is deleted and
  `npm run db:import-dev-store` (idempotent) copies an old `.data/dev-store.json` in. Assets: `assets` table +
  `src/lib/storage/blob-store.ts` (S3-compatible bucket when `S3_BUCKET` is set, else `.data/assets`; same keys).
  **Registry fixes:** `getImageProvider(actor, feature)` takes the job's org + user explicitly (a `Workspace` fits),
  so it no longer reads the request and can run in the worker; usage events store `userId` (attribution in Team,
  Analytics, Admin by id, name fallback for old rows); the quota is reserved atomically (`startJob`: per-org
  advisory lock, a `running` row holds the credit for 15 min, then `finishJob`), verified with 6 parallel jobs on
  2 remaining credits → exactly 2 ran. Verified: tsc + eslint clean, all pages 200 on Postgres, 41 repository
  checks (reads of imported data, write cycles, cross-org isolation, key rotation, default connection, seeding).
  **Known, pre-existing:** next-intl `useNow()` in client components (`provider-keys-settings`, `links-workspace`,
  `admin-users`, …) logs Cache Components "`new Date()` while prerendering" errors in dev. **Next (step 1b/1c):**
  real AI providers through the AI SDK + `model_preferences`, then Clerk (orgs, invites/reset emails, webhooks).
- **2026-11-03, Production foundation step 1b: real AI providers (local):** AI SDK 7 (`ai`, `@ai-sdk/openai`,
  `@ai-sdk/google`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`, `zod`). `src/lib/ai/providers/ai-sdk.ts` builds an
  `ImageProvider` per job from the org's decrypted key: every tool is an **image edit** with the merchant's product photo
  as input (Generate: product + optional reference + library scene; Recolor: product + swatch; A+: the model renders only
  the hero, and `src/lib/image/compose-aplus.ts` (moved from the demo) draws title/features as vector text so EN/AR copy
  stays exact; Looks: the merchant's arrangement is composited with sharp (`src/lib/image/compose-look.ts`), then the
  model only relights/blends it). Outputs are cropped to the requested ratio and capped at HD 1200 / 2K 2048 (never
  upscaled), WebP. gpt-image renders 1024² / 1536×1024 / 1024×1536; Gemini takes the aspect ratio (+ `imageSize` on
  gemini-3 image models). Swatch analysis stays a local pixel measurement (`src/lib/image/swatch.ts`, no credit); the
  Recolor preservation report now comes from a cheap vision model and is hidden when the check can't run.
  **Routing** (`src/lib/ai/registry.ts`, `src/lib/ai/models.ts`): the tool's `model_preferences` row (new table) when its
  key is valid, else Automatic = first valid key in [OpenAI, Gemini] with its best image model **from the models the key
  reported at validation**. `demo-…` keys and (with `IMAGINE_DEMO=1`) orgs without keys use the demo provider; otherwise
  jobs fail with `no_provider` before reserving a credit. Errors map to `invalid_key` (key also flips to invalid),
  `no_credits`, `rate_limited`, `unsupported`, `generation_failed`; retry wrappers are unwrapped. Tool screens show the
  new blocked reasons (`src/components/app/job-errors.ts`, en + ar) without "Try again". Settings → API Keys: a **Model**
  column per image tool (Automatic or a model of a connected key, admin only, audit `provider_model.changed`). Generate
  now sends the product (and reference) bytes to the provider. Anthropic/OpenRouter are not offered for image tools yet
  (Anthropic has no image output; OpenRouter image models are per-model and unlisted by its key endpoint).
  Verified: tsc + eslint clean; 23 checks with stubbed OpenAI/Gemini HTTP (request mapping, model choice, crop/cap, A+,
  Looks, error mapping incl. retries, key invalidation, preference fallback, usage rows); demo-mode quota test; pages 200.
  **Not yet verified against live provider accounts** (no keys here). **Next:** live test with a real OpenAI/Gemini key,
  then Clerk.
- **2026-11-03, Production foundation step 1c: Clerk sign-in (local):** user decisions: **Clerk for identity only**
  (sign-in/up, email verification, password-reset emails, MFA, sessions, bans); orgs, memberships, roles and the
  platform role stay in Postgres (no Clerk Organizations, no dashboard roles, no webhooks). **Switch on keys:** with
  `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set (`clerkEnabled()` in `src/lib/auth/constants.ts`) Clerk
  runs; without them the local password login keeps working (dev, demo, tests). `@clerk/nextjs` 7, `@clerk/backend`,
  `@clerk/localizations` (ar). Migration `0002_clerk_users`: `users.password_hash` nullable, `clerk_user_id` (unique),
  `last_session_id`. `src/lib/auth/clerk.ts` wraps the Backend API (create/delete user, password, ban, sessions,
  invitations; Clerk refusals → `email_taken` / `weak_password`). `getSession()` reads Clerk's session, links the
  Clerk account to a user row on first sign-in (existing row by **verified** email, else a new row; a row disabled
  earlier is banned in Clerk), and on each new Clerk session updates last sign-in, applies `SUPER_ADMIN_EMAILS` and
  accepts pending invitations (the local `signIn` now accepts them too). Current org = `imagine_org` cookie, checked
  against memberships. Proxy wraps `clerkMiddleware` (also on `/api/*`). Sign-in/up pages render Clerk's `<SignIn>`/
  `<SignUp>` (hash routing, themed with the app's CSS variables in the `clerk` CSS layer); a new Clerk user with no
  org and no invitation names the company on **`/onboarding`** (`createCompany`, honours sign-ups off + default plan).
  Signed in to Clerk but disabled/unverified here → `/blocked?reason=account` (no sign-in loop). Sign-out goes
  through `useSignOut()` (Clerk client or local action). Console: create user / owner, reset password, disable
  (ban), sign out everywhere and session counts use Clerk; Team + console invitations email a Clerk sign-up link to
  people without an account (`src/lib/team/invitations.ts`, `APP_URL`). Local seed is skipped with Clerk.
  Verified: tsc + eslint clean; 19 checks against a stubbed Clerk Backend API (user creation, error mapping, Clerk
  rollback on DB failure, linking by verified email, unverified/disabled cases, ban/unban, password reset incl.
  unlinked users, session revoke/count, invitation payload); local mode: all pages 200 en/ar, redirects, API auth.
  **Not yet verified with real Clerk keys** (sign-in UI, theming, onboarding, invitation email). Known limits: Clerk
  profile changes (name/email) aren't synced back (needs `user.updated` webhook); console session counts make one
  Clerk call per user. **Next:** add Clerk keys and test the flows, then step 2 (BullMQ, Stripe, Sentry, rate limits, tests).
- **2026-11-03, Production foundation step 2a: Redis, rate limits, worker + schedules (local):** step 2 split into 2a
  (Redis/BullMQ/rate limits), then Stripe, Sentry, test suite. Railway runs a long-lived server, so single tool jobs
  stay synchronous server actions; the queue is for scheduled work now and bulk/catalog mode later. `ioredis` 6,
  `bullmq` 6; `REDIS_URL` (local `brew services` Redis). `src/lib/redis.ts` (shared client, short timeouts).
  **Rate limits** `src/lib/rate-limit.ts`: fixed windows in Redis (Lua INCR+PEXPIRE), per-process fallback without
  Redis, fail open if Redis is down. Applied to: local sign-in (5 failures/15 min per email, replaces the in-memory
  map) and sign-in/up attempts per IP (30/15 min, `X-Real-IP`); AI jobs in the registry's `reserveJob` (12/min per
  user, 60/min per org → `rate_limited`, before a credit is reserved); key save/re-check (10/min per org).
  **Worker** `src/worker.ts` (`npm run worker`, tsx with the react-server condition; `tsx` moved to dependencies):
  registers BullMQ job schedulers (idempotent, so no separate cron service) on the `maintenance` queue:
  `revalidate-keys` daily 03:00 UTC (every stored key re-checked, 4 at a time; a rejected key turns invalid, only
  changes are audited, actor "Imagine AI") and `close-stale-jobs` every 5 min (`running` usage rows older than 15 min
  → `error`/`timed_out`). Graceful SIGTERM. **`/api/health`**: database + Redis up/down, 503 when down (Railway
  health check). Verified: tsc + eslint clean; 12 checks (re-validation flip/no-op/audit, stale-job close, Redis
  limits: window, block, clear, TTL); worker started for real: schedules in Redis, first `close-stale-jobs` ran,
  clean SIGTERM exit; health 200; pages 200. **Next:** Stripe billing (needs Stripe test keys + plan prices), then
  Sentry, then the test suite (Vitest + Playwright E2E).
- **2026-11-03, Production foundation step 2b: Stripe billing (local):** user decisions: AED, monthly + yearly, free
  trial (default 14 days, `STRIPE_TRIAL_DAYS`), Stripe test keys to follow (not in `.env.local` yet). `stripe` 23
  (API `2026-10-28.endive`; period end is on subscription items). Amounts aren't in code: prices live in Stripe and
  are mapped by `STRIPE_PRICE_{STARTER,PRO}_{MONTHLY,YEARLY}`; `npm run stripe:setup -- --starter-monthly … --pro-yearly …
  [--webhook-url …]` creates/reuses AED products + prices by lookup key and prints the env lines. Free = no payment;
  Enterprise = contact (no checkout). Migration `0003_stripe_billing`: org `stripe_customer_id`, `stripe_subscription_id`,
  `billing_status`, `billing_interval`, `billing_period_end`, `cancel_at_period_end`; `stripe_events` (applied webhook
  ids). `src/lib/billing/`: customer per org (idempotency key), Checkout (trial only on the first subscription, org id in
  metadata), plan switch on a live subscription (prorated, immediate), cancel at period end / resume, Customer Portal,
  and `syncSubscription` = the only writer of plan/billing fields: live (active/trialing/past_due) → plan from the price,
  ended (canceled/unpaid/incomplete_expired) → Free; late events for an older subscription are ignored; subscription
  metadata can't attach an org that already pays with another customer. Webhook `/api/stripe/webhook`: signature on the
  raw body, re-reads the subscription from Stripe (out-of-order safe), skips repeated event ids, 500 → Stripe retries.
  **Settings → Billing** (`/settings/billing`, no Figma frame; light settings style, en/ar): current plan, status,
  renewal/trial/end date, credits and seats meters, Manage billing (portal), monthly/yearly toggle, four plan cards
  with AED prices from Stripe, Checkout / switch / downgrade (confirm dialogs), past-due and pending-cancel banners with
  actions, post-Checkout polling until the webhook lands; admins only (others read-only); without Stripe keys the page
  shows the plan and "online billing isn't available yet". **Seats enforced** on Team invites (members + pending
  invitations ≥ plan seats → `seat_limit`). Console: changing the plan of an org with a live subscription is refused
  (`billing_managed`); credits override still works. Also fixed: `getSession()` now calls `connection()` (Cache
  Components prerendered the session lookup with cookies but flagged `new Date()`; was hidden by the useNow noise).
  Verified: tsc + eslint clean; 20 checks against a local Stripe stub (`STRIPE_API_URL`): price mapping, AED prices,
  customer idempotency, Checkout params incl. trial, webhook bad signature/sync/duplicate, audit, prorated switch,
  cancel/resume, past_due, cancel → Free, no second trial, stale-subscription event ignored, cross-customer guard;
  Billing page rendered in Chrome (en light, ar RTL) without Stripe keys. **Not yet verified:** real Stripe test mode,
  the page with prices/buttons (needs keys), Customer Portal config. **Next:** Sentry, then the test suite.
- **2026-11-03, Production foundation step 2c: Sentry (local):** `@sentry/nextjs` + `@sentry/node` 11 (in v11
  `withSentryConfig` comes from `@sentry/nextjs/config`). Off without a DSN (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`).
  `src/instrumentation.ts` (server init + `onRequestError` for render/route/action/proxy errors),
  `src/instrumentation-client.ts` (browser; no session replay: screens show customers' products), worker init
  (`service: worker` tag, failed jobs captured, flush on SIGTERM). Shared `src/lib/observability/sentry-options.ts`:
  no default PII, request bodies/cookies/query and auth/key/signature headers dropped, user reduced to id, and
  anything shaped like a provider key, Stripe secret, webhook secret, bearer token or JWT masked in events,
  breadcrumbs and spans (`beforeSendSpan`; v11 streams spans). Workspace sets user id + org tag. `reportError()`
  replaces `console.error` at handled failure points (tool actions, resize, billing, Stripe webhook, invitations,
  key re-validation, finishJob). `next.config.ts` wrapped with `withSentryConfig` (source maps upload only with
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`). Stripe setup script now defaults to PLACEHOLDER AED prices
  (Starter 99/990, Pro 299/2990; user will set real ones later by re-running with amounts).
  Verified: tsc + eslint clean; 8 checks through a local Sentry ingest stub (keys/secrets/bearer masked, request data
  and cookies dropped, user id only, delivery incl. `reportError` from the worker); dev server pages 200, no browser
  console errors, worker runs. **Not yet verified** with a real Sentry project. **Next:** the test suite (Vitest unit +
  Playwright E2E), then fix `next build` blockers before the first Railway deploy.
- **2026-11-03, Production foundation step 2d: test suite + production build (local):** user decision: stay local
  for now (no Railway deploy yet). **Vitest 5** (`npm test`, `vitest.config.mts`): Vite's tsconfig paths,
  `server-only` aliased to an empty module, own database `imagine_test` (`TEST_DATABASE_URL`; the global setup refuses
  names without "test", creates, migrates and truncates it once per run), files run one at a time, `ASSET_DIR`
  (new override in `blob-store.ts`) keeps test files out of `.data/assets`, and every outside service is off unless
  a test stubs it. 63 tests in 10 files (~18 s): unit (envelope encryption incl. tampering, Sentry scrubbing, plan ↔
  Stripe price mapping and trial days, rate limits in memory + Redis db 15 + fail-open); integration (tenant isolation
  via `db.forOrg`, members/invitations, audit prefixes incl. LIKE wildcards, key rotation/encryption/status, catalog
  default handling, generations/assets, room-background seeding race, platform settings; AI jobs with stubbed
  OpenAI/Gemini HTTP: routing, request mapping, crop/cap, A+, Looks, recolor + vision check, error mapping, key
  invalidation, preference fallback, parallel quota, kill switch, per-user burst limit; Clerk accounts against a
  stubbed Backend API; Stripe lifecycle against a local stub incl. webhook signature/duplicates; maintenance jobs;
  server actions with a mocked session: seat limit, admin-only, last admin/self, console `forbidden` +
  `billing_managed`). **Playwright 1.63** (`npm run test:e2e`, `playwright.config.ts`): runs `next start` on :3100 against
  `imagine_e2e_test` in demo mode; 5 specs: sign up → add demo key → generate → credits 50→49 on the dashboard; wrong
  password; signed-out redirect keeps `next`; org admin can't open `/admin`; Arabic RTL Billing without Stripe.
  **`next build` passes** with no warnings (96 pages; the earlier `getSession()` `connection()` fix was the real
  blocker, the `useNow()` notices don't fail the build). Scratch checks from steps 1a–2c now live in the suite.
  **Next (local):** user's choice between live-key testing (AI, Clerk, Stripe, Sentry) and step 3 features
  (copy generation, bulk/catalog mode on the queue, brand kit, approvals). Railway deploy deferred by the user.
- **2026-11-03, Step 3a: Product copy generation EN/AR (local):** new tool **`/copy`** (rail item "Copy" after the image
  tools; no Figma frame, built in the light config-panel + canvas pattern). Panel: SKU (+ catalog fetch → photo, name in
  the UI language, category), product name, category, optional photo, details (one fact per line), search keywords,
  tone (professional/friendly/luxury/playful), length, channel (website/Amazon/noon/social), languages (EN, AR).
  Canvas: one editable column per language (`lang` + own `dir`): title, bullets (one per line), description, SEO
  meta title/description with 60/155 counters, tags; copy per field / copy all, Export CSV (UTF-8 BOM, one row per
  language), Save edits, Regenerate; recent copy list (opens copy + its settings). **Text routing**:
  `getTextProvider(actor, "copy")` in the registry (shared `runJob`: kill switch, rate limits, atomic credit, usage
  row with feature `copy`, 1 credit per generation regardless of languages); Automatic = first valid key in
  [OpenAI, Anthropic, Gemini, OpenRouter] with its best text model from the key's model list (`TEXT_MODELS` in
  `models.ts`; OpenRouter has no list, its preferred ids are used unverified); `model_preferences` now covers
  `copy` (any of the four providers), shown in Settings → API Keys (`MODEL_FEATURES`, `providersFor`, `modelsFor`).
  `providers/ai-sdk-text.ts`: one `generateText` + `Output.object` call for all requested languages (photo attached
  as a file part), shared `mapError` (now also maps Anthropic "credit balance"). `copy-prompt.ts`: channel rules,
  length targets, Gulf MSA Arabic written natively (Latin brand/model names, Western digits, Arabic punctuation),
  no invented facts, plain text; `tidyCopy` strips Markdown/quotes and caps lengths/counts. `providers/demo-text.ts`
  writes offline copy from the merchant's facts (FAIL in SKU fails). Saved in **`copy_generations`** (migration
  `0004`; settings + copy JSON, provider/model), actions `generateProductCopy`, `listRecentCopies`, `saveCopyEdits`
  (validated shape/lengths), `deleteCopy` (admin or author). Analytics/admin tool lists include `copy`
  (`JOB_FEATURES`; per-feature counters built from the list). Verified: tsc + eslint clean; 74 Vitest tests (+11: prompt
  rules/schema/tidy; Gemini + OpenAI Responses stubs incl. model choice, photo part, usage row, preference, rejected
  key; demo writer; actions incl. validation, edits, cross-org isolation, delete permissions); 6 Playwright specs (+1:
  write EN+AR, edit, save, reload, reopen from recent, credits 50→49); `next build` clean; screenshots en + ar (fixed:
  "Saved" state was lost by remounting the editor; RTL metadata lines now isolated with `<bdi>`). **Not yet verified
  with live keys.** **Next in step 3:** bulk/catalog mode on the queue, brand kit (brand voice → copy prompt), approvals.
- **2026-11-04, Step 3b: Bulk Copy on the queue (local):** **`/copy/bulk`** (Single product / Bulk switch at the top of
  the Copy panel). Input: upload a CSV or paste rows (`sku,name,category,details,keywords`, header aliases, or a
  headerless `sku[,name,details,keywords]` list; quoted fields; max 200 rows, duplicates/missing SKUs skipped with line
  numbers; downloadable template), a default category, and the shared style fields (`copy-fields.tsx`, also used by
  single mode). Rows with only a SKU are filled from the org's default catalog when they run. Tables
  **`copy_batches`** + **`copy_batch_items`** (migration `0005`). `startCopyBatch` refuses viewers, runs bigger than the
  credits left, a switched-off tool and orgs with no usable provider (`textProviderProblem` in the registry) before
  queuing. Each item is one job: `runBatchItem` (claim `pending` → `running`, so duplicate deliveries do nothing) calls
  the shared `writeCopy` (same registry path as single copy: one credit, rate limits, usage row attributed to whoever
  started the run) and saves to `copy_generations`. A rate-limited item goes back to `pending` and is retried without
  being charged (worker: `moveToDelayed` + `DelayedError`, 20s). **Dispatch:** BullMQ queue `copy-batch` when
  `REDIS_URL` is set (worker concurrency `COPY_BATCH_CONCURRENCY`, default 3); without Redis (E2E, local without
  Redis) the web process runs the items after the response (`after()`, 2 at a time). Stop run (pending → skipped,
  free), Retry failed, Download CSV (all written products, `copiesAsCsv`), delete run (copy is kept), "Open" →
  `/copy?copy=<id>` in the editor. The close-stale-jobs schedule also fails items stuck `running` > 15 min and
  settles their batch. The canvas polls every 2.5s while a run is in progress and warns when nothing has started
  after 30s (worker not running). The page needs a `<Suspense>` boundary like `/copy`: without one, the Cache
  Components dev check reloads it in a loop. Verified: tsc + eslint clean; 86 Vitest tests (+12: CSV parsing; batch
  lifecycle incl. catalog fill, SKU not found, charging, duplicate delivery, credits/viewer/provider refusals,
  failure + retry, stop, rate-limit requeue, cross-org isolation + manage permissions, stale items); 7 Playwright
  specs (+1: paste rows, run, CSV download, open a product, credits 50→48); `next build` clean; dev run through
  Redis + `npm run worker` with en + ar screenshots (fixed: bidi in the Arabic column hint). **Not yet verified with
  live keys.** **Next in step 3:** brand kit (brand voice → copy prompt), approvals; bulk for the image tools later.
- **2026-11-04, Scene picker + all 12 templates live (local):** Generate's scenes are recommended per category (first one
  pre-selected) with **Browse all** (dialog over the whole library, filter by category; `sceneLibrary` / `findScene` in
  `src/lib/catalog-presets.ts`, one entry per scene with the categories using it) and **Describe your own** (free text,
  `CUSTOM_SCENE_MAX` 500, sent as `LifestyleRequest.customScene`; survives a category switch). Shared component
  `src/components/app/scene-picker.tsx`. The 7 "Coming soon" templates got presets (outdoor, kids toys, cosmetics,
  lighting, outdoor kids toys, bathroom, decor) with 18 new scene photos generated in Figma (`public/scenes/`, 1344×768;
  the generated frames are in the Figma file), so `/templates` has no "Coming soon" cards. A+ now reads `?category=` and
  keeps the category on reset, like Generate and Recolor.
- **2026-11-04, Image prompt accuracy + image eval (local):** prompt fixes in `src/lib/ai/providers/ai-sdk.ts`: every
  prompt names its input images by position (`imageRoles`, missing ones skipped); Generate has an optional **Product Size**
  field (`productSize`, 80 chars) for true-to-life scale; Recolor has **What to recolor** (`scope`: main material only,
  the default, keeps legs/frame/hardware, or whole product) and asks for the daylight colour; A+ asks the model to keep
  clear the corner the title box really uses (`aplusTitleSide`: top-right for Arabic titles, the prompt said top-left
  before). **`npm run eval:images`** (`scripts/eval-images.mts`, guide `evals/images/README.md`): runs a fixed test set
  (`evals/images/cases.json`, example with the demo photos) through a real model with the app's prompts and your own
  `OPENAI_API_KEY` / `GEMINI_API_KEY` (no credits, no DB; asks for `--yes` first), records the exact prompt and a prompt
  version hash, measures Recolor colour accuracy (CIEDE2000 vs the swatch) and shape kept (outline IoU)
  (`src/lib/eval/image-metrics.ts`), optional `--judge` vision scores, and writes a review page with 1–5 score boxes and
  CSV export. Verified: tsc + eslint clean; 95 Vitest tests (+9: prompt roles, scale, scope, A+ side, action
  validation, metrics); eval run end to end against a stubbed OpenAI; en + ar UI. **Not yet run against a live model.**
  **Next:** build `cases.json` from ~20 real SKUs and run the baseline on both providers.
- **2026-11-04, Prompt suggestions + tips (local):** under "Describe your own" (Generate), Custom Instructions (Generate)
  and Additional Notes (Recolor): **suggestion chips**, phrases per category (scenes), shared detail phrases (light,
  camera) and per recolor kind (e.g. "keep the wooden legs as they are"), in `PromptHints` (en + ar). A click appends
  the phrase (Arabic comma for Arabic), used chips disappear, chips that would pass the length limit are hidden. **Tips**
  (`src/lib/prompt-hints.ts`, no model, no credit) flag asking the model to draw text/logos, to resize or reshape the
  product, scene descriptions of 3 words or fewer and instructions over 60 words; Arabic keywords match whole words.
  Component `src/components/app/prompt-assist.tsx`. The phrases are a starting set from known image-model behaviour;
  replace them with what scores best in `npm run eval:images`. Verified: tsc + eslint clean, Vitest (+6), en + ar in
  Chrome. **Next:** "Improve with AI" (rewrite the merchant's text through `getTextProvider`), then per-team
  suggestions from saved results (kept within each org).
- **2026-11-04, Upload your own background (local):** the scene library dialog (Generate → Browse all) starts with an
  **Upload your own** card (PNG/JPEG/WebP, 10 MB; wrong files show an error in the dialog). The photo becomes a selected
  "Your background" card in the scene row (`SceneChoice` `{ kind: "upload", file }`), survives a category switch, and is
  sent as `sceneImage`; `generateLifestyleImage` allows one scene source only (library, description or upload) and
  passes it as `LifestyleRequest.sceneUpload`. Real providers get it as an input image with "keep that room, its layout,
  furniture, colours and light exactly as they are" (a library scene is only a style reference); the demo pastes the
  product cut-out onto it. Used for that job only, not stored. Eval cases take `sceneImage`. Verified: tsc + eslint clean,
  Vitest, en + ar in Chrome. **Next:** save uploads as the team's own scenes (org-scoped, reusable, could share the
  Room Backgrounds library).
- **2026-11-04, First live run with a real OpenAI key:** key saved for `demo-org` through the normal encrypted
  path (`checkProviderKey` → `saveProviderKey` → audit; 134 models, image model picked: `gpt-image-2`, copy: `gpt-5`).
  Copy (EN+AR), Generate, Recolor and A+ each ran once through the registry: all `ok`, one `usage_events` row each
  (~25–30 s per job). Generate and Recolor kept the product exactly (Recolor: shape, legs, stitching, light kept).
  **Fixed:** (1) Copy put the SKU in titles/descriptions as if it were the name: the prompt now gives the SKU as an
  internal stock code that must not appear in the copy. (2) A+ redesigned the product and lost its legs: the hero is
  a ~3:1 strip but OpenAI renders 1.5:1, so the centre crop kept only ~49% of the height. The A+ prompt now uses the
  same fidelity wording as Generate and, when less than 85% survives (`keptHeight`), says which middle band is kept.
  Re-run: SKU gone from the copy; A+ shows the original sofa with legs. Verified: tsc + eslint clean, 102 Vitest tests.
  **Still open:** A+ product can touch the title box; Arabic copy writes units as "cm" (by the prompt's rule; switch
  to "سم" if merchants prefer); Shop the Look, Bulk Copy via the worker, and Gemini/Anthropic/OpenRouter not yet run live.
- **2026-11-04, Live run 2 (OpenAI): Bulk Copy via the BullMQ worker + Shop the Look.** **Fixed:** Bulk Copy failed 2
  of 3 items (`generation_failed`): `gpt-5` spent the whole 4k `maxOutputTokens` on hidden reasoning (3,968 reasoning
  tokens, 0 text, finish `length`). Single copy had the same risk. Now 16k cap + `reasoningEffort: "low"` for OpenAI
  `gpt-5*` (`ai-sdk-text.ts`, asserted in `copy.test.ts`). Re-run: 3/3 done in 21 s (was 48 s with 2 failures).
  Shop the Look: placement and lighting right, but `gpt-image-2` reshaped the chair (curved shell → boxier).
  `inputFidelity: "high"` was tried and reverted: `gpt-image-2` rejects `input_fidelity` (400); only
  `gpt-image-1.5` accepts it. **Open:** Looks product fidelity on `gpt-image-2` (try `gpt-image-1.5` + high fidelity
  as the Looks model, or Gemini, via `npm run eval:images`). Note: tiny or busy product photos make tiny cut-outs in
  the Looks draft; the builder could warn when a product's cut-out is small.
- **2026-11-05, "Improve with AI" (local, live-verified on OpenAI):** the button under Custom Instructions (Generate)
  and Additional Notes (Recolor) was a disabled placeholder; now it rewrites the text through the org's text model
  (`getTextProvider(actor, "copy")`, so the Copy tool's provider/model). New `TextProvider.improvePrompt`
  (`ai-sdk-text.ts`, prompt + `tidyPrompt` in `src/lib/ai/prompt-improve.ts`; rules mirror the prompt tips: no drawn
  text/logos, no reshaping the product, concrete light/camera/material words, ≤ 50 words, same language as the
  merchant's text, or the UI language when the box is empty). It is a helper step like swatch analysis: **no credit,
  no usage row**, limited to 10/min per user (`LIMITS.promptRewritesPerUser`, in the registry). `gpt-5` runs it with
  `reasoningEffort: "minimal"` (~3–5 s live). Demo provider appends the tool's standard phrases offline (FAIL fails).
  Action `improvePrompt` in `src/features/prompts/actions.ts` (validates tool, category, scene, lengths, language).
  UI (`ImproveWithAiButton` in `config-panel.tsx`): spinner + "Improving…", Undo while the box still holds the
  rewrite, short inline error per code (en + ar). Verified: tsc + eslint clean; 107 Vitest tests (+5: OpenAI request
  shape + tidy + no usage, recolor/Arabic brief, demo offline, validation/no provider, rate limit); live OpenAI in
  en + ar; Chrome screenshots en + ar (RTL). **Next:** per-team suggestions from saved results.
- **2026-11-05, Step 3c: Brand kit (local):** **Settings → Brand Kit** (`/settings/brand`, nav item after API Keys; no
  Figma frame, API Keys settings layout, en/ar): brand name, who you write for, about the brand, brand voice, words to
  use, words to avoid (comma lists, Arabic commas too, max 30), house style rules, with counters and "last updated by".
  Table **`brand_kits`** (one row per org, migration `0006`), repository `src/lib/brand/brand-kit.ts` (`cleanBrandKit`
  trims, de-duplicates and caps; an empty kit removes the row). Actions in `src/features/brand/actions.ts`: everyone in
  the org can read it, **only admins save/remove**, audit `brand_kit.updated` / `brand_kit.removed` (shown under
  "Recent changes"). Copy and Bulk Copy show a **Use brand kit** checkbox (on by default, link to edit) when a kit
  exists, else an "Add a brand kit" hint; the choice is saved as `settings.brandVoice` on copy and batches (older
  rows without it count as on). `writeCopy` loads the kit and passes `CopyRequest.brand`; `brandSection` in
  `copy-prompt.ts` adds only the filled-in fields after the tone ("style guidance only: it never adds product facts";
  avoided words banned in every language). The demo writer puts the brand in the meta title and strips avoided words.
  Verified: tsc + eslint clean; 114 Vitest tests (+7: prompt section; admin-only save, cleaning/caps, audit, removal,
  cross-org isolation; prompt on/off through a stubbed Gemini; demo; bulk carries the choice); 8 Playwright specs (+1:
  hint → set up kit → write copy in the brand voice → Arabic RTL); `next build` clean; screenshots en + ar. **Not yet
  verified with live keys.** **Next in step 3:** approvals.
- **2026-11-05, Step 3d: Copy approvals (local):** every saved copy has a review status (`src/lib/copy/review-status.ts`):
  **Draft → In review → Approved / Changes requested** (admin's note, 500 chars). Editors and admins submit; only
  admins approve (also straight from draft) or request changes; viewers only read. Editing approved copy sends it
  back to Draft (the approval was for the old text); editing copy in review keeps it in review. Columns
  `review_status` (default `draft`, indexed), `review_note`, `reviewed_by`, `reviewed_at` on `copy_generations`
  (migration `0007`); `reviewCopies` only moves rows from the statuses an action may start from, so repeats are
  no-ops. Actions `reviewCopy`, `getCopyReviewRights`, `listRecentCopies(status)`; bulk `reviewCopyBatch`
  ("Submit all for review" / "Approve all") and `exportCopyBatch(id, { approvedOnly })`. Audit `copy.submitted`,
  `copy.approved`, `copy.changes_requested` (bulk entries carry the run name and count); admin console labels added
  for these and for `brand_kit.*` / `provider_model.changed` (that label was missing). UI: an Approval bar under the
  editor header (status badge, who/when, the note, actions; disabled with "Save your edits first" while edits are
  unsaved), status badges on recent copy and on bulk rows, an **All / In review** filter on recent copy (the admin's
  queue), bulk approval counts and **Download approved (n)**. CSVs gain an `approval_status` column at the end, so
  existing columns don't move. Verified: tsc + eslint clean; 119 Vitest tests (+5: full lifecycle + audit, edit
  resets, permissions/cross-org, bulk submit/approve/approved-only export, CSV column); 9 Playwright specs (+1:
  submit → request changes → edit → resubmit → approve via the In review queue → Arabic); `next build` clean;
  screenshots en + ar (fixed: reviewer name and date isolated with `<bdi>` in RTL). **Not yet:** notifying reviewers
  (needs email), approvals for images in History, gating "Upload to Website". **Next:** user's choice between
  live-key testing (AI incl. brand kit, Clerk, Stripe, Sentry) and bulk mode for the image tools.
- **2026-11-05, Bulk mode for the image tools, part 1: Bulk Generate (local):** **`/generate/bulk`** (Single product /
  Bulk switch at the top of the Generate panel, `GenerateModeTabs`). Input: paste SKUs or upload a CSV, one per line,
  optional `,product size` (`parseImageRows` in `src/lib/image-batch/rows.ts`: header, blanks, invalid SKUs and
  case-insensitive duplicates skipped with line numbers, max **50** per run, template download). Shared settings as in
  single Generate: category, library scene or "Describe your own" (no upload in bulk: `ScenePicker allowUpload={false}`),
  style, format, instructions with chips/tips. Every product photo is the SKU's **first catalog image** (normalised to
  PNG by `importProductPng`), so a run needs a connected catalog (`no_connection` → "Connect a catalog" link). Tables
  **`image_batches`** (with a `tool` column, only `generate` for now) + **`image_batch_items`** (migration `0008`),
  repository `src/lib/image-batch/batches.ts` (same claim → run → settle / cancel / retry / stale rules as bulk Copy).
  `runImageItem` (`runner.ts`) calls `getImageProvider(actor, "generate")` (one credit, rate limits, usage row for the
  user who started the run), saves the result as an asset + `generations` row (mode `lifestyle`, settings incl.
  `batchId`), so every image is in **History** (publish, ZIP, delete there). Rate-limited items go back to `pending`
  uncharged. Dispatch: BullMQ queue `image-batch` (worker concurrency `IMAGE_BATCH_CONCURRENCY`, default 2) or
  in-process `after()` without Redis; the close-stale-jobs schedule also fails image items stuck > 15 min.
  `startImageBatch` refuses viewers, invalid settings, empty lists, runs bigger than the credits left, a switched-off
  tool, no catalog and no usable image provider (`imageProviderProblem` in the registry) before queuing. Canvas: run
  header (Stop, Retry failed, View in History, delete), progress, a grid of image cards with per-item status/errors,
  recent runs; polls every 3 s. Also: `decodeImage` moved to `src/lib/storage/decode-image.ts` (shared by History and
  the runner). Verified: tsc + eslint clean; 128 Vitest tests (+6: list parsing; full run to History with usage rows;
  refusals; rate-limit requeue, duplicate delivery, retry; stop/permissions/cross-org; stale items); 10 Playwright
  specs (+1: no catalog → connect the demo catalog → 3 SKUs → 2 images + 1 not found → History → credits 50→48 →
  Arabic RTL); `next build` clean; screenshots en + ar. **Not yet:** bulk Recolor and bulk A+ (the `tool` column and
  runner are ready for them), picking which catalog image to use, live provider run. **Note:** single Generate shows
  "2 credits" (`GENERATE_COST`) but the registry charges one credit per job; bulk shows 1 per product (what is charged).
- **2026-11-05, Live run 3 (OpenAI): Bulk Generate.** 2 SKUs from the demo catalog (`demo-org`, Living Room, 1:1 HD)
  through `runImageItem` two at a time, as the worker does: both `done` in ~38 s total on `gpt-image-2` (1024×1024
  WebP), one `generate` usage row each (`ok`, ~37 s), both saved to History. Product fidelity good: the grey sofa
  (arms, cushions, black legs) and the beige armchair (shell, black legs) kept as in the catalog photo; scene and
  light consistent across the run.
- **2026-11-05, Credit display fixed:** the image tools showed more credits than they charge (Generate, Recolor, A+ "2",
  Shop the Look "4"); the registry charges one credit per job (`startJob` adds one usage row). `GENERATE_COST`,
  `RECOLOR_COST`, `APLUS_COST` and `LOOK_COST` are now 1 (display only), matching bulk runs and the analytics note.
- **2026-11-05, Bulk mode for the image tools, part 2: Bulk Recolor + Bulk A+ (local):** **`/recolor/bulk`** and
  **`/aplus/bulk`** (Single product / Bulk switch on both panels, shared `BulkModeTabs`). **Recolor:** a SKU list, one
  swatch for the whole run (analysed in the browser like single Recolor; must be ready before starting), category +
  product type, scope, format, notes. `startRecolorBatch` (FormData) stores the swatch as an asset (kind `swatch`,
  removed when the run is deleted). **A+:** a CSV with a header row: `sku, title, subtitle, feature_1, feature_1_text …
  feature_4` (`feature_N_title` / `_description` also accepted; `parseAplusRows` in `rows.ts` reuses Copy's `parseCsv`:
  quoted commas, 2–4 features with text, A+ text limits, duplicates; problems reported by row); an empty title uses the
  catalog name; shared library layout (Bento, Gallery or "Let the AI design it"; no upload in bulk), scene, style,
  format. Per-row text is stored in the new `image_batch_items.data` (jsonb, migration `0009`); `image_batches.settings`
  is now a per-tool union (`ImageBatchSettings`). Runner: `makeImage` dispatches on `batch.tool` (`runGenerate`,
  `runRecolor`, `runAplus`), every result saved to History with its tool's mode and settings (+ `batchId`).
  Refactor: start checks shared in `src/lib/image-batch/start.ts` (`imageBatchProblem`, `beginImageBatch`); run actions
  for every tool in `src/features/image-batch/actions.ts` (`listImageBatchRuns(tool)`, open/stop/retry/delete); shared
  UI in `src/features/image-batch/components/` (`BulkImageCanvas`, `ProductListField`, `CategoryFields`, `StyleChips`,
  `useImageRuns`, `StartErrorBox`); shared wording in the `ImageBulk` messages (`GenerateBulk` / `RecolorBulk` /
  `AplusBulk` keep panel text). Fixed: a run that finished before the first poll stayed "In progress" in Recent runs;
  long CSV headers in the placeholder/hint widened the panel (RTL clipping). Product types (subcategories, from the
  parallel session) flow through all three bulk tools. Verified: tsc + eslint clean; 133 Vitest tests (+5: Recolor run
  with stored swatch + cleanup, refusals; A+ CSV parsing, run with catalog-name titles, refusals); 12 Playwright specs
  (+2: bulk Recolor with a swatch upload, bulk A+ from a CSV with a skipped row + Arabic RTL); `next build` clean;
  screenshots en + ar. **Not yet:** live provider run of bulk Recolor / A+; choosing which catalog image to use;
  Arabic titles from `nameAr` for bulk A+ (rows can give their own title).
- **Template product types (subcategories)** (2026-11-05). Every category preset lists 5–8 product types
  (`CategoryPreset.subcategories`, labels in `Presets.subcategories` en + ar, 73 in all). Template picker: a category card
  opens `/templates?category=…` ("All <category>" + one card per type, back link); a type card opens
  `/generate?category=…&sub=…`; search also matches types across categories ("sofa" → Furniture › Sofas). Type photos
  generated with Figma AI (file `n2sZrjuN0QtS3mYXaPXiSz`, `gpt-image-2.5-flare`), 384px JPEGs in
  `public/templates/subcategories/<key>.jpg` (`subcategoryImage(key)`). Tools: optional "Product Type" select
  (`SubcategoryField`) in Generate, Recolor, A+ and the bulk tools; `useSubcategorySync` keeps `?sub=` in step and drops
  it when the category changes; actions accept a type only from its own category (`findSubcategory`); the provider
  prompt names it (`productKind()`: "furniture (sofas)"), and it is saved in History settings. Verified: tsc + eslint
  clean; 133 Vitest tests (+3: type data/labels/photos, `findSubcategory`, Generate refuses another category's type);
  Playwright `templates.spec.ts` (category → type → Generate, category switch clears the type, search); `next build`
  clean; screenshots en + ar. **Not yet:** product types per tenant (DB-backed presets, Phase 2); type-specific scenes.
- **2026-11-05, Shop the Look: categories + own backgrounds (local):** the Builder's Look Settings gained the shared
  `CategoryFields` (category + optional product type, `?category=` / `?sub=` like Generate). Style chips follow the
  category (`lookStyles`: furniture keeps the 7 room styles, others use their preset styles; labels added to
  `Looks.styles`). Backgrounds follow it too (`categoryBackgrounds`): the org's active room backgrounds for the
  category, else the category's preset scenes (`scene:<key>`, read from `public/`). Merchants can upload their own
  background in the Builder (`uploadLookBackground`, any non-viewer, asset kind `look-background`, id `upload:<assetId>`,
  kept across category switches). `resolveLookBackground` (render + save + regenerate) handles all three; another org's
  upload id falls back. Looks store `category` / `subcategory`, room backgrounds store `category` (migration `0010`,
  existing rows default to furniture); the Room Backgrounds admin has a category filter and field. The look prompt now
  names the products (`productKind`) instead of assuming an interior. **Not yet:** uploaded backgrounds are not deleted
  with a look (duplicates may share them); history/board filters by category.
- **2026-11-06, Creative Studio step 1: manual credit settings (local).** Start of the Creative Studio work (image +
  video studio, plan in `~/.claude/plans/pasted-content-id-2ce8-personal-iridescent-kitten.md`). Credits are now set by
  super admins, not hardcoded: new console page **Admin → Credits** (`/admin/credits`) edits monthly credits per plan,
  credits per job for each tool (0 = free), video pricing ((base + per second × seconds) × resolution multiplier,
  rounded up; used from step 3) and which tools each plan includes. Rules live in `platform_settings.credit_rules`
  (`src/lib/credits.ts`: parse/validate, defaults, `jobCost`, `videoCost`, `planAllows`); tools added after a save
  default to on. **Video is paid plans only** (`planHasVideo`, fixed, shown locked in the grid). `reserveJob` refuses
  a tool outside the plan (`not_in_plan` → blocked reason `plan`) and reserves the tool's cost atomically
  (`usage_events.credits`); credit badges, billing, analytics, team and admin now sum credits instead of counting jobs.
  Per-org **add/remove credits** for the current month with a reason (`credit_adjustments`, org detail page), counted in
  the allowance (`monthlyAllowance`). Bulk runs check rows × cost and plan access before queuing. Tools show the
  configured cost before Generate (`useJobCost`). Every change is audited (`platform.credits_updated`,
  `org.credits_adjusted`). Migration `0011`. Verified: tsc + eslint clean; 159 Vitest tests (+15: rule parsing, defaults
  merge, video pricing, plan access, weighted reservation, quota with cost, adjustments). **Next:** step 2 prompt home
  `/home` with the Image | Video switch; step 3 video generation (Veo first) via `getVideoProvider` + `video` queue;
  later an Audio feature (Gemini TTS / Lyria songs, e.g. kids' cartoon music) once model availability is confirmed.
- **2026-11-06, Creative Studio step 2: Studio home with the Image | Video switch (local).** After sign-in everyone
  lands on **`/home`** (Studio, first in the rail; `/`, sign-in/up, onboarding, blocked page and the console's "back to
  app" all point there; `/generate` stays as the product-photo tool). The page: one prompt box (Cmd/Ctrl+Enter submits)
  with reference/start-frame upload and the cost, the **Image | Video switch right below it** (`MediaModeSwitch`, state
  in `?mode=video`, so refresh/back/links keep it), the chosen mode's options, and recent results.
  **Image** = new text-to-image tool `create` (Feature + `JOB_FEATURES` + `IMAGE_FEATURES`, `ImageProvider.createImage`,
  OpenAI/Gemini through the AI SDK: plain generation, or an edit when 1–2 references are attached; demo provider too):
  1–4 images, ratios 1:1 / 4:5 / 9:16 / 16:9 / 3:2, HD / 2K, one job and one charge (Admin → Credits cost) per image,
  credit badge refreshed (`refresh()`). Results are saved to History as mode `create` with no SKU, so they are never
  counted as pending or uploaded to a store. **Video** shows its options (duration 4/6/8 s, 9:16 / 16:9 / 1:1 / 4:5,
  480p–1080p, motion, camera move, start frame) and the video credit estimate; Free sees a locked switch and an upgrade
  prompt, paid plans see that generation opens with step 3. Labels in the `Studio` namespace (en + ar).
  Verified: tsc + eslint clean; 163 Vitest tests (+4 `studio.test.ts`); 15 Playwright specs (+`studio.spec.ts`: lands
  on /home, generates an image, video locked on Free and kept in the URL, Arabic RTL; other specs updated for the new
  landing page); `next build` clean; screenshots en, ar (video) and 390 px. **Next:** step 3 video generation
  (`getVideoProvider`, Veo first, `video` BullMQ queue with provider job polling, `<video>` results, `assets` kind video).
- **2026-11-06, Creative Studio step 3: video generation (local).** **Provider change:** Google shut the Veo 3.1 preview
  models down in the Gemini API on 2026-10-22 and points to **Gemini Omni Flash** (`gemini-omni-1.2-flash`, GA, via the
  Interactions API), so that is the first video model (org's own Gemini key, `videoGen` capability). New
  `getVideoProvider(actor, credits)` in the registry (Automatic over `VIDEO_PROVIDERS`, demo key/mode → offline demo
  clip), adapter `providers/ai-sdk-video.ts` (AI SDK `google.interactions` + `responseFormat` video, inline delivery),
  and the **model capability registry** `src/lib/ai/video-models.ts` (Omni Flash: 16:9 / 9:16, 4–15 s, 360p / 720p /
  1080p, start frame, audio); the Studio's video options are built from it and the server rejects anything outside it.
  Camera move and motion are prompt direction (`video-prompt.ts`), labelled as such in the UI. Jobs: `video_jobs` table
  (migration `0012`), one BullMQ job per video on the `video` queue (worker concurrency 4, 12 min lock; in-process
  without Redis), claimed `pending` → `running` → `ok` / `failed`, rate limits re-queue, stale `running` jobs failed by
  `close-stale-jobs`, max 3 open videos per org. Credits: `videoCost` (base + per second × seconds) × resolution,
  reserved when the provider call starts, refunded on failure; `video` is a job feature (analytics, kill switch) but not
  a flat-priced one (`PRICED_FEATURES`), and plan access is the fixed paid-only rule. Clips are stored as assets
  (`video/mp4` / `video/webm`, kinds `video` and `video-frame`), served with HTTP byte ranges (`src/lib/storage/range.ts`)
  so they play and seek. The page polls open videos every 4 s, plays finished ones inline, refreshes the credit badge.
  Verified: tsc + eslint clean; 171 Vitest tests (+8: video lifecycle with the demo provider, image-to-video, failure
  refund, paid-only, capability checks, credits/viewer/limit/no-key, byte ranges); 16 Playwright specs (+1: paid org
  queues a video and plays it); `next build` clean; screenshots. **Not yet / risks:** the Omni adapter is not yet run
  against a live key (inline delivery may need `uri` delivery for large clips); video model picker in Settings → API
  Keys; video in History; other providers (BytePlus Seedance, Kling, OpenAI). **Next (PRD):** Cinema controls,
  FFmpeg editor/export, AI Director, Audio (Gemini TTS / music).
- **2026-11-06, Creative Studio: Seedance 2.5 video on BytePlus ModelArk (local).** New BYOK provider **`byteplus`**
  (video only: `PROVIDER_INFO` capability `videoGen`; key card in Settings → API Keys, encrypted, admin-only, audited like
  the others). Key check = one page of ModelArk video tasks (`GET /contents/generations/tasks`), no model list, so the
  preferred id `dreamina-seedance-2-5-260628` is used. `VIDEO_PROVIDERS = ["gemini", "byteplus"]` (Automatic: Gemini
  first); `TEXT_PROVIDERS` is now its own list so BytePlus never shows up for copy. Adapter
  `src/lib/ai/providers/byteplus-video.ts`: create task (`content` = prompt text + optional `image_url` data URL with role
  `first_frame`; `ratio` (`adaptive` with a start frame), `duration`, `resolution`, `generate_audio: true`,
  `watermark: false`), poll every 5 s (15 min limit, then the task is cancelled with DELETE), download `content.video_url`
  (signed, 24 h) through `safeFetch` into our storage. ModelArk errors → our codes (`modelArkError`: ModelNotOpen →
  unsupported, overdue → no_credits, rate/overload → rate_limited and retried, auth → invalid_key and the key turns
  invalid, sensitive content → generation_failed). Capabilities (`video-models.ts`): 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9,
  4–30 s (chips 4, 5, 8, 10, 12, 15, 20, 30), 480p / 720p / 1080p, start frame, audio; the Studio offers exactly these.
  `480p` added to credit pricing (default ×0.75, editable in Admin → Credits). Labels en + ar. Verified: tsc + eslint
  clean; 182 Vitest tests (+9: `byteplus-video.test.ts` with the API stubbed, Seedance Studio/worker case in
  `video.test.ts`, 480p pricing); `next build` clean; Playwright studio + main-flow pass. **Not yet verified with a real
  ModelArk key** (user adds it later): the API contract comes from third-party guides because BytePlus's reference pages
  didn't load. Check on the first live run: the start-frame field shape, `adaptive` vs the chosen ratio with a start
  frame, the key-check endpoint, error code names, and the download content type.
- **2026-11-06, Studio videos in History (local).** A finished video job is also saved as a History item
  (`saveVideoToHistory`, `src/lib/video/history.ts`): mode `video`, no SKU, pixel size from resolution × aspect ratio
  (`videoSize`, all provider ratios incl. 1:1 / 4:3 / 21:9 and 480p), settings (prompt, seconds, resolution, camera,
  motion). History plays it (`HistoryMedia`: muted thumbnail with a frame, controls in the drawer), filters by "Studio
  video", downloads `.mp4` / `.webm` ("Download video", ZIP included), and deleting it removes the clip and its Studio
  card (`forgetVideoJobs`). SKU-less items (Studio images and videos) no longer show a store-upload status or an empty
  identifier. Analytics counts saved videos under the Video tool. Also: a zero-quota 429 (e.g. a Gemini Free Tier key on
  Omni Flash: "limit: 0 … upgrade your tier") maps to `no_credits` and fails at once instead of retrying forever
  (`mapError`, `tests/unit/provider-errors.test.ts`); live check on 2026-11-06 confirmed the Omni call path but the
  org's key is Free Tier, so no real clip yet. Verified: tsc + eslint clean; 185 Vitest tests (+3
  `video-history.test.ts`, +2 provider errors); 16 Playwright specs; `next build` clean; screenshots of History grid
  and drawer.
- **2026-11-06, Studio home layout + rail "AI Image" menu (local).** Studio home: hero panel ("Create *anything* you
  imagine"), Image | Video pill tabs above the prompt, a prompt card with references / start frame as a tilted stack at the
  start and the mode's options as chips (popovers, `src/components/ui/popover.tsx`) next to the cost and a round send
  button, and shortcut tiles to the other tools. Rail: Generate, Recolor, A+, Inspirational and Resize collapse into one
  **AI Image** item (`railItems` / `AI_IMAGE_KEYS` in `nav-items.ts`), which is not a link: hover (or click/tap) opens a
  two-column menu (`ai-image-menu.tsx`): **Tools** (Create image, Lifestyle, Bulk lifestyle, Recolor, A+, Looks,
  Resizer) and **Models**, the image models the org's keys can call for the Studio with the one in use marked
  (`getImageModelMenu`, names/blurbs in `src/lib/ai/image-model-info.ts`); admins get a link to choose models per tool.
  Verified: tsc + eslint clean; 188 Vitest tests (+3 `image-model-menu.test.ts`); new `ai-image-menu.spec.ts` passes
  against the dev server; screenshots en + ar. **Not yet:** picking a model per prompt from the menu or the Studio.
- **2026-11-06, Roadmap A1: video model picker (local).** `video` joined `MODEL_FEATURES`, so Settings → API Keys has
  a model select on the "Studio (video)" row (Automatic, Gemini Omni Flash, Seedance 2.5 from BytePlus; only video
  providers, only models a connected key can call; audited as `provider_model.changed`). `resolveVideoProvider` follows
  the choice through `providerOrder` like the image/copy tools, else Automatic (Gemini first). The Studio's video options
  gained a **Model** chip (`videoModelName`: "Seedance 2.5", "Gemini Omni 1.2 Flash") explaining where it is chosen,
  with a "Change model" link for admins; the options (ratios, lengths, resolutions) follow the chosen model. Labels en +
  ar. Verified: tsc + eslint clean; 190 Vitest tests (+ choice/Automatic/refusals in `video.test.ts`, model names and
  `providersFor("video")` in `byteplus-video.test.ts`); `next build` clean; 17 Playwright specs pass.
- **2026-11-06, Roadmap A2: tool error messages (local).** `quota_exceeded`, `feature_disabled`, `not_in_plan`, key
  and model problems already had their own blocked states on every tool (`blockedReason`, `Workspace.blocked`). New
  code **`content_rejected`**: provider safety-filter refusals (OpenAI `moderation_blocked` / safety system, Gemini
  `PROHIBITED_CONTENT` / `SAFETY` via `SAFETY_REFUSAL` in `mapError`; Gemini video finish reason `content-filter`;
  ModelArk `*Sensitive*` codes) → blocked reason `content` ("Change the wording or the image and try again"), shown on
  the single tools, the Studio (image and video cards), Looks, and the bulk item lists (`ImageBulk` / `CopyBulk`
  `itemErrors`), en + ar. A refused job costs nothing (credits are only kept on success). Verified: tsc + eslint
  clean; 192 Vitest tests (+2 `content-rejected.test.ts`).
- **2026-11-06, Roadmap A3: emails (local).** `src/lib/email/`: `sendEmail` with the transport from env only
  (`RESEND_API_KEY` → Resend HTTP API, `SMTP_URL` → nodemailer 10.3, else the outbox `EMAIL_OUTBOX_DIR` (default
  `.data/outbox`) outside production or when set explicitly; production without one sends nothing). Never throws;
  failures go through `reportError` without addresses. `renderEmail`: one escaped HTML + text layout, en / ar (RTL), texts
  in the `Emails` namespace. Emails: **invitations** (Team invite/resend, console add-member/create-org): Clerk's
  sign-up email for new people when Clerk is on, ours otherwise (sign-up link with the email filled in, or sign-in link
  for existing accounts); actions return `emailed` and the Team page says when nothing could be sent. **Password
  reset for the local login**: `/forgot-password` (same answer for unknown emails, 3 emails per address per hour + the
  per-IP auth limit) and `/reset-password?token=` (`password_resets`, SHA-256 of the token only, one use, 1 hour, a new
  link replaces older ones; success signs the user out everywhere, audited `auth.password_reset`); "Forgot password?"
  on sign-in. With Clerk both pages go to sign-in (Clerk resets its own passwords). **Copy review notices**: submit
  (single or bulk) → the org's active admins except the sender; approve / request changes → the author (with the
  note), bulk approve → one email per author with their count. `copy_generations.created_by_id` added for this
  (older rows have none, so they get no author notice). Migration `0013`. `password_resets` has no `org_id`: like
  `sessions` it belongs to the person. Env documented in `.env.example`. Verified: tsc + eslint clean; 200 Vitest tests
  (+8: `email.test.ts` invitations / reset / review notices via the outbox, `email-templates.test.ts` escaping, RTL,
  both languages, transport choice); `next build` clean; 19 Playwright specs (+2 `password-reset.spec.ts`: full reset
  through the outbox, invalid link in Arabic RTL). **Not yet:** a real Resend/SMTP send (A8); a per-user language for
  emails (the sender's current language is used).
- **2026-11-06, Roadmap A4: Clerk profile sync (local).** `POST /api/clerk/webhook` (event `user.updated`, signature
  checked by `verifyWebhook` with `CLERK_WEBHOOK_SIGNING_SECRET`; 404 when Clerk or the secret isn't set, 400 on a bad
  signature, 500 so Clerk retries if the sync fails). `syncClerkProfile` re-reads the profile from Clerk (not the event
  body), then updates the user's name and, once verified and not used by another account, email; every membership row
  follows (`updateMemberIdentity`; an org that already has an invitation for the new email keeps the old one), audited
  `member.profile_updated`. Users who never signed in here are ignored (linked on first sign-in). Verified: tsc + eslint
  clean; 4 Vitest tests (`clerk-profile-sync.test.ts`: name + email sync, unverified / taken email, svix-signed webhook,
  bad signature, not configured). **Setup (A8):** add the endpoint in the Clerk dashboard and copy its signing secret.
- **2026-11-07, UI: prompt dock for the tool pages (local).** The 404px left config panel is replaced by a prompt
  dock under the canvas, styled like the Studio prompt card: Generate, Recolor, A+, Copy and QR (single and bulk). The
  same `ConfigPanel` / `PanelBody` / `Section` / `PanelFooter` API (`src/components/app/config-panel.tsx`), so the
  workspaces kept their state and logic: what isn't a `Section` renders inline in the bar (the prompt / notes, a bulk
  tool's product list via `Section inline`), each `Section` becomes a chip (optional `icon` + `summary` of the current
  choice) whose fields render in a panel above the bar (always mounted; one open at a time; closes on Escape, outside
  click, or submit; `revealField(el)` opens the panel holding a field, used by "Edit details"). Single/Bulk sits in the
  bar (`DockToolbar`); cost + round submit like Studio; product / swatch tiles (`DockTile`) at the start of the prompt.
  Bulk product lists show one input at a time: paste or CSV (`SourceSwitch`), with the hint while empty and a one-line
  status ("3 products ready · 1 line skipped") once filled; bulk instructions / notes are an optional chip. Prompt boxes
  have a visible field style (border, hover, focus ring). Then the dock moved into the **Studio hero** so every tool
  page looks like the Studio home: gradient card, heading per tool (`Workspace.heroes`, en/ar), Single/Bulk as the
  Image|Video-style pill, the prompt card, the shared tool row (`src/components/app/tool-shortcuts.tsx`, current tool
  marked). Results sit above the hero, panels open upward (downward when there is no room), and submit scrolls back to the
  results. The "will appear here" placeholder shows on a fresh page / New Job and collapses once editing starts.
  **Results feed (Gemini / Higgsfield style):** Generate, Recolor and A+ save every result to History as it arrives
  (`saveShot` / `saveResult`; Export now only downloads, Recolor's "Use Image" shows as saved), and each tool lists the
  signed-in user's own results for that tool above the current job (`listToolFeed` → `listUserGenerations`, 40 newest,
  oldest first; `src/components/app/result-feed.tsx`): one turn per job (`src/lib/feed-turns.ts`), the prompt as a
  bubble with "Use this prompt", then its images with download / History. With a feed the hero shrinks to the pinned
  prompt card (heading kept for screen readers, tool row hidden) and the page follows new results like a chat until
  the reader scrolls up. Pages follow the user's Light / Dark / System theme. The Single/Bulk switch is the prompt
  card's top row on every tool; bulk tools put Paste / CSV on the same row instead of a "Products" title.
  **Then, from review:** the tall hero (heading, gradient card, tool row) took too much of a laptop screen, so tool
  pages now pin only the compact prompt card at the bottom (heading kept for screen readers; tools stay in the rail),
  like the mockup. The feed starts empty when a tool is opened from the Tools menu and collects this visit's results;
  History's "Open in tool" (`?sku=&from=<id>`) brings that product's results and puts its prompt back to regenerate.
  The canvas zoom bar is gone: a generated image (`img[data-result]`) opens in a full-window `ImageViewer` (zoom,
  fit, download, share via the system share sheet, else copy link) and has Open / Download / Share in the corner;
  feed images do the same. Bulk pages open fresh too (only runs started this visit; earlier runs' images are in History).
  Generate and Bulk Generate start with no category or scene: the merchant picks both (the Scene chip shows the
  required dot and Generate stays disabled until then); a category from Templates (`?category=`) still carries over.
  Recolor and A+ (single and bulk) also start with no category. Generate's start screen shows "Try it" example cards
  (`ExampleCards`: a scene, style and prompt each, then the product panel opens). **Image upscale:** a new priced job
  (`upscale` in `Feature` / `IMAGE_FEATURES` / `JOB_FEATURES`; on by default for every plan, cost in Admin → Credits):
  `ImageProvider.upscale` (AI SDK: one image edit re-rendered at 2K / 4K, then resized to the exact long edge; demo:
  a resize), `upscaleImage` (`src/features/upscale/actions.ts`: reads a data URL or this org's stored asset, never a
  remote URL; saves the result to History under the source tool), and an Upscale menu (2K / 4K with cost) next to
  Download / Share on results, feed images and in the viewer. **Resize** and **Looks** moved onto the prompt dock too:
  Resize = add images inline + Platform / Output chips, ↑ resizes, Download ZIP beside it, queue + preview as results;
  Looks = scene prompt inline + Category & style / Room background / Format / Title chips, product search, arranging
  canvas and layers as the work area (the result view is unchanged). Verified: tsc + eslint clean; Vitest (+ upscale,
  ai-jobs upscale, feed cases); `next build`; Playwright (+ Resize dock, Try it, upscale in the main flow).
  **Looks, friendlier:** the catalog opens as a grid of product cards (search narrows it; Added marks what is on the
  room; no catalog → a Connect your store card; import from a web page below), the empty canvas shows the chosen
  room with a 3-step guide, the canvas fits the screen above the dock with its tools on top, and a one-line hint
  explains drag / resize / lock. Playwright +1 (Looks: no-catalog card, cards, Added, layers, Generate enabled). The app layout stacks canvas over dock
  when a page has one (`has-[[data-dock]]`). Removed the decorative undo/redo/Fit header and the "Isolated Source Layer
  Connected" pill. Mockup: Artifact "Imagine AI – Studio Redesign". Verified: tsc + eslint clean; Vitest 203 passed
  (+3 `dock-label.test.ts`; the 4 `email.test.ts` failures are `._*` files the exFAT drive writes into the test
  outbox, not this change); `next build` clean; 20 Playwright specs pass (+1 `prompt-dock.spec.ts`: chips, panel
  swap, Escape / outside click, product tile, paste/CSV switch, Arabic RTL; others updated to open the chip first).
  **Not yet:** Looks and Resize keep their own layouts; the Figma file still shows the old side panel.
- **2026-11-08, Roadmap A5: chat / assistant (local).** Rail **Chat** (`/chat`, after Copy; top bar "AI Assistant").
  `chat` joined `TEXT_FEATURES` (model picker row "Chat assistant" in Settings → API Keys) and `JOB_FEATURES` (Admin →
  Credits cost and plan access, Analytics, Monitoring, kill switch). `TextProvider.streamChat` streams a reply: AI SDK
  `streamText` (`fullStream`, timeouts total 180 s / first chunk 60 s / gaps 30 s, low reasoning effort on gpt-5) and an
  offline demo reply in the user's language ("FAIL" fails it). The registry's `runStreamJob` reserves the reply's
  credit before the provider is called and finishes the job when the stream ends: failed or stopped before any text =
  free, stopped after text = charged. Tables `chat_threads` (per user, inside the org) and `chat_messages` (migration
  `0014`), `src/lib/chat/`: `threads.ts` (every read takes the user id), `limits.ts` (4000-char messages, history =
  last 40 messages / 32k chars starting with a user turn, title from the first line), `prompt.ts` (org name, date,
  answer in the user's language, the org's brand kit when set), `turn.ts` (`runChatTurn`: save message → stream →
  save reply; a failed reply removes the message, and the thread it started, so the text goes back in the box; a
  stopped reply is saved as `stopped`). `POST /api/chat` streams NDJSON events (`thread`, `delta`, `done`, `error`);
  viewers get 403 and see their chats read-only. Actions `getChatState`, `openChatThread`, `renameChatThread`,
  `deleteChatThread`. Screen: thread list (rename, delete; a drawer on phones), bubbles with `dir="auto"`, Enter to
  send / Shift+Enter for a new line, Stop, suggestions, cost line, blocked and error messages; `?thread=` keeps the
  open chat across reloads. en + ar. Verified: tsc + eslint clean; 231 Vitest tests (+9 `chat.test.ts`: Gemini stream
  with system prompt, brand kit and history, rejected key, failed first reply, stop with and without text, quota and
  kill switch, privacy between users and orgs, the route's NDJSON, viewers and bad input; +4 `chat-limits.test.ts`;
  `credits.test.ts` updated: chat is plan-gated now, and rules saved before chat give it to every plan); `next build`
  clean; 24 Playwright specs (+2 `chat.spec.ts`: chat, reload, failed reply, credits; Arabic RTL); screenshots en + ar,
  desktop + phone. The email test now skips macOS `._` files in the outbox (exFAT). **Not yet:** a live provider run
  (A8); Markdown rendering of replies (plain text with line breaks for now); attaching images or catalog products.
  **Found, not fixed:** `CopyBulk.sourcePaste` is missing in en + ar (the label is under `Copy`), logged during `next build`.
- **2026-11-08, Roadmap A6: video safety + storage (local).** The content-rejected code was already done in A2. **Likeness
  consent:** a Studio start frame shows a rights-and-consent checkbox, asked again for each new frame; Generate waits for
  it and `startVideo` refuses without it (`consent_required`). Saved as `video_jobs.consented_at` (migration `0015`) and
  audited `video.consent_given`. **Storage quota per plan** (`videoStorageBytes` in `src/lib/plans.ts`: Starter 5 GB, Pro
  25 GB, Enterprise 100 GB): clips and start frames are counted from the `assets` index (`src/lib/video/storage.ts`); a
  full org gets `storage_full` with a message and a link to History, and the Studio shows usage and retention. The check
  runs before a job starts, so the clip that crosses the limit still finishes. **Cleanup:** new schedule `cleanup-videos`
  (daily 04:00 UTC, `SCHEDULES`) removes finished or failed videos past the plan's `videoRetentionDays` (Free and Starter
  30, Pro 90, Enterprise 365) with their clip, start frame and History item, at most 200 jobs per org per run; open jobs
  are never touched; audited `video.cleaned_up`. **Bug fixed:** deleting a video in History left its start frame behind.
  Verified: tsc + eslint clean; 238 Vitest tests (`video-safety.test.ts`); `next build` clean; Playwright `studio.spec.ts`
  passes (consent checkbox and storage line); screenshots en, ar, ar 390 px. **Not yet:** quota and retention numbers are
  proposed defaults awaiting a product decision, and they are not on the Billing page; nobody is warned before clips are
  removed (a downgrade shortens retention, so older clips go on the next run); no per-org override; start frames already
  orphaned by earlier History deletes are not swept; the schedule has not run in a real worker (A9).
- **2026-11-08, Roadmap A7: marketing pages (local).** New `(marketing)` route group with Home, `/features`, `/pricing`,
  `/terms` and `/privacy`, en + ar (`src/features/marketing/`, `Marketing` messages; no Figma access this session, so the
  look follows the Studio hero and the auth brand panel). The proxy treats them as public; `/en` or `/ar` with a session
  goes straight to `/home`, without one it shows the site. Pages are prerendered and need no database. **Pricing:** amounts
  come from Stripe and credits from Admin → Credits, read per request inside Suspense (`publicPricing`); if billing is off
  or Stripe fails, plans still list and paid prices say "Shown at checkout". The trial line appears only when billing is
  on. Plan video limits now also show on Settings → Billing. **Legal:** text is in `legal-content.ts` (not messages, so
  it isn't sent to the browser with app pages), written from what the product does today. `legal-details.ts` holds the
  bracketed placeholders, `contactEmail` and `reviewed`. Until `reviewed` is true the pages show a draft notice, are
  noindex and stay out of the sitemap. Sign-up links to both pages. Also `sitemap.xml`, `robots.txt`, per-page metadata
  with language alternates. Claims kept to what ships: catalog import yes, store publishing no (B8); no customer logos,
  testimonials or numbers. Verified: tsc + eslint clean; 247 Vitest tests (+9 `tests/unit/marketing.test.ts`); `next build` clean;
  Playwright full suite (+3 `marketing.spec.ts`: visitor to sign-up, Arabic RTL, phone width with no sideways scroll,
  sitemap); `copy-review.spec.ts` failed once in a full run (its Write Copy button stayed disabled, 3 of 3 passes alone, possibly typing before hydration: not investigated further); screenshots en, ar, ar 390 px. **Before launch (A9):** fill in the legal details and have a lawyer review the
  terms and privacy text (en + ar), then set `reviewed: true`; set `contactEmail` (until then Enterprise's button leads
  to sign-up and the footer has no Contact link); set `APP_URL` at build time for the sitemap and canonical links. **Not
  yet:** real Stripe amounts on the page (A8); with Clerk, the paid plan buttons land on onboarding rather than Billing;
  terms acceptance isn't recorded per user; an Arabic legal review.
- **2026-11-08, Roadmap B1: Kling video (local, API stubbed).** Taken out of order: A8 is waiting on provider keys and A9
  on A8. New video provider `kling` (`providers/kling-video.ts`), model `kling-3.0`, built from Kling's official API docs:
  Bearer key, `POST /text-to-video/{model}` or `/image-to-video/{model}`, then `GET /tasks`. 16:9, 9:16, 1:1; 3–15 s;
  720p and 1080p (4K exists, not offered, since `VideoResolution` and pricing stop at 1080p); sound on; one shot per clip.
  Automatic tries it after Gemini and BytePlus; pick it in Settings → API Keys. **OpenAI dropped from this step:** OpenAI
  removed the Videos API and `sora-2` on 2026-09-24 and names no replacement. Details: empty balance codes (1101, 1102)
  come as HTTP 429 but map to `no_credits`, so they aren't retried; passing failures while polling don't fail the job, since
  a retry would pay for a second clip; WebP start frames become PNG. The download moved to `providers/video-download.ts`,
  shared with BytePlus. Verified: tsc + eslint clean; 264 Vitest tests (`tests/unit/kling-video.test.ts`, an integration test with a demo
  key); `next build` clean; full Playwright suite (27); Kling's card on Settings → API Keys, en and ar 390 px. **Check on the first live run (A8):** the key check uses `GET /tasks?task_ids=0`, as Kling has no key endpoint,
  and treats a 400 as a good key (assumed, not documented); bare base64 for frames (docs say only "URL or Base64"); that
  the "hotlink protected" result URL downloads from the worker; the failure message wording behind `content_rejected`.
  **Not yet:** frame limits (at least 300 px, ratio 1:2.5 to 2.5:1) aren't checked up front, so a bad frame fails as
  `generation_failed`; tasks can't be cancelled at the time limit (no documented endpoint); Kling's older AccessKey +
  SecretKey standard isn't supported, only API keys.
- **2026-11-08, Settings on phones (local).** Below `md` the Settings sidebar was a fixed 240 px beside the page, leaving
  about 70 px for content at 390 px. It is now a wrapping row of links above the page (the "Soon" items are hidden there,
  the title stays for screen readers). Page padding drops to 16 px on phones. The coverage table on API Keys scrolls
  inside its card; Team's title row and search fit; an Integrations connection's buttons wrap under its details. **Bug
  fixed:** Team's page could scroll sideways: the table's screen-reader-only header sat outside its scroll container's
  clipping (container now `relative`). Desktop layout unchanged. Verified: tsc + eslint clean; 264 Vitest tests; `next build` clean; full Playwright suite (30, with 3 new in
  `tests/e2e/settings-phone.spec.ts`); all five pages measured en and ar at 390 px, en at 320 px and 1280 px, with screenshots
  of most at 390 px and API Keys at 1280 px.
- **2026-11-08, Roadmap B2: cinema controls (local).** Studio video gets a **Look** chip: lens (Auto, Wide, Standard, Portrait,
  Macro, Telephoto) and lighting (Auto, Natural, Studio, Golden hour, Dramatic, Neon), next to the existing camera and motion.
  Saved on the job and in History; Auto adds nothing; jobs queued earlier run as Auto. **Native where a model has it:**
  `nativeCamera` in `video-models.ts`. Only Seedance has one (static camera, sent as `--camerafixed true` at the end of the
  prompt, replacing the prompt line), and the Studio says so when it applies. Kling 3.0's API has no camera field, and
  Google's Omni docs put camera and lighting in the prompt, so everything else is prompt text, labelled in the Studio. No
  provider documents a lens or lighting parameter. Presets cost nothing extra. Verified: tsc + eslint clean; 275 Vitest tests (`tests/unit/video-prompt.test.ts`, BytePlus, Kling and integration additions); `next build` clean; full Playwright suite (30, `studio.spec.ts` now sets a Look); screenshots en and ar 390 px. **Check on the first live run
  (A8):** that Seedance 2.5 honours `--camerafixed` alongside the JSON fields we send (BytePlus's examples show it inline; the
  API reference page couldn't be read); how much each model visibly follows the lens and lighting text. **Not yet:** Omni
  and Seedance might gain presets from their own prompt guides; no preview of a preset's effect.
  **Found, not fixed:** on the Studio at 390 px in Arabic, the top bar runs out of room and the user name is cut off.
- **2026-11-08, Roadmap B4: image approvals + publish gate (local).** History images get the same review as copy: Draft → In
  review → Approved / Changes requested (with a note); editors submit, only admins decide, viewers read. In the details drawer,
  as bulk actions on a selection, with badges and an Approval filter. Videos have no review, and Studio images can be reviewed
  but have no SKU to upload. **The gate:** Settings → Integrations → "Only upload approved images" (admin only, off by default,
  audited `org.image_approval_changed`). Enforced on the server in `publishGenerations` and also in `markGenerationsUploaded`,
  which would otherwise be a way round it. Asking for an unapproved image by id returns `not_approved` and doesn't mark it
  failed; "upload all" leaves those out. Withdrawing an approval blocks it again; images already uploaded stay uploaded. Audit
  `image.submitted`, `image.approved`, `image.changes_requested` (bulk entries carry the count). Emails: admins on submission,
  makers on a decision (one email per person; not to themselves), en + ar. Migration `0016` (`generations`: review columns +
  `created_by_id`; `organizations.require_image_approval`), applied to the local dev database only. Verified: tsc + eslint clean; 295 Vitest tests (`image-review.test.ts`, `image-review-email.test.ts`); `next build` clean; full Playwright suite (31, `image-approvals.spec.ts`); drawer screenshots en and ar 390 px.
  **Not yet:** images saved before this have no `created_by_id`, so their makers get no email; no review of videos; no per-SKU
  or per-tool rules; store publishing itself is still demo-tested until B8.
  **Test setup:** the suite now signs up more than 30 times, the sign-in/up limit per address, so `templates.spec.ts` failed in full runs with "Too many attempts". `AUTH_LIMIT_PER_IP` (optional, set to 1000 in `playwright.config.ts`) raises it for the browser tests only; the default stays 30, and 0 or junk can't switch it off. **Found, not fixed:** at 390 px, History's date range is cut off and the upload banner is cramped.
- **2026-11-08, Roadmap B7: bulk improvements (local).** **Catalog image:** bulk Generate, Recolor and A+ get a chip to pick Image
  1 to 5 for the whole run (default 1). A product with fewer images uses its last one rather than failing, since the rest of the
  run still has value; History records the image actually used (`catalogImage`). Runs started earlier use the first image.
  **Arabic titles:** bulk A+ picks the main or Arabic catalog name (`nameAr`) for rows with no title, defaulting to the page's
  language; a product with no Arabic name uses its main name; a title in the row always wins. Settings live in the run's JSON, so no
  migration. Verified: tsc + eslint clean; 306 Vitest tests (`image-batch-choices.test.ts`); `next build` clean; full Playwright suite (31, `bulk-recolor-aplus.spec.ts` sets both); screenshot en and ar 390 px. **Not yet:** a different image per product, or
  a preview of each product's images; how well a live model renders Arabic text on an A+ image (A8).
- **2026-11-08, UI: non-tool pages in line with the tool pages (local).** History, Analytics and Templates share one
  heading (`src/components/app/page-header.tsx` on the first two, the same type on Templates) and History and Analytics
  one 1200px column; Templates cards, the History pending banner, selection bar and delete button use theme colours
  instead of fixed ones, so they follow Light / Dark. Settings: Team's title matches the other settings pages. The rail
  is tighter so every item and More fit at laptop height. Fixed: an upscale from a tool's result lost its SKU and tool
  and was filed under Studio; canvases now pass `source` (SKU + mode) to `CanvasShell`. Verified: tsc + eslint clean; 306
  Vitest tests; `next build`; 31 Playwright specs (+ rail fits at 1280×720; main flow checks the upscale is filed with
  its product). **Not yet:** the Looks sub-pages keep their own heading sizes; Templates and Settings have no top-bar
  page pill; the Figma file still shows the old layout.
- **2026-11-08, Roadmap A8, live run 4 (OpenAI only, in progress).** Key saved for `demo-org` through Settings → API Keys (valid, 96
  models). Confirmed in `usage_events` as provider `openai` (none `demo`): Chat (`gpt-5`, first live run), Studio image, Copy (`gpt-5`),
  Generate, Upscale to 2K (90 s, the slowest), bulk A+ with Arabic titles, bulk Recolor with Image 2 (all `gpt-image-2`). **Arabic A+:** the text is
  drawn by the app (`compose-aplus.ts`), not the model, so it is exact and right to left. **Found:** (1) With 2 features at 1:1, the A+
  image leaves the lower half mostly blank; not fixed (add to B14). (2) `npm run worker` has no file watching, so a worker started before a
  code change runs the old code: bulk A+ ignored `catalogTitle` until run on current code. Restart it after pulling, and deploys must
  restart it. Blue edges on the Generate result come from the demo photo `public/demo/sofa-source.png`, not the model. **Not run this round:** Gemini, BytePlus, Kling, Anthropic,
  OpenRouter, Clerk, Stripe, Sentry, real email. The bulk runs called the runner directly with current code, not through the queue,
  as the running worker was out of date. The OpenAI key used was pasted in a chat, so it must be replaced.
  **Also live, through the provider layer (screens not driven):** single Recolor (swatch read as #B8A898, chair shape and legs kept), single A+, Looks, Improve with AI. A+ with 3 features also leaves the lower half blank. **Bug found, not fixed:** Looks with a product photo that isn't on a plain background. `cutOutProduct` flood-fills from the corners, so `public/demo/source-chair.png` (a chair in a room) became a few small fragments on the draft, the model dropped them, and the result showed no chair: a credit spent with no warning. Should detect a poor cut-out when the product is added, before any charge.
- **2026-11-08, A8 fixes: Looks photos and the A+ layout (local).** **Looks:** the live run lost a chair: `public/demo/source-chair.png` is a pale chair against a pale wall, so the background removal ran into the product (not a busy-background problem as first thought; its edge is 99% plain). `cutOutProduct` now returns `reliable`: false when over half the photo's edge stayed (a room) or when the remains have no main piece and reach the edge (a melted product). A set of items on a plain background and a product cropped by the frame stay allowed. `addLookProduct` refuses with `unusable_photo` before storing anything, with advice in en + ar. Thresholds set from the 4 demo photos and drawn test shapes only, so they may need tuning on real catalogs. It doesn't make such photos work: that needs real background removal (a product decision). **A+:** the feature row was always 42% of the card; it now fits its text up to that share, and the photo takes the rest (1:1 hero from 58% to about 82–85%). Heroes are less cropped, and the model is asked for the same size. Verified: tsc + eslint clean on the changed code; 320 Vitest tests (`cutout-reliable`, `compose-aplus-layout`, `look-product-photo`); `next build` clean; full Playwright suite; layout mock-ups en and ar. Not re-run against a real model, and the refusal message has no browser test. `clerk-accounts.test.ts` failed once in a full run (5 tests), then passed in 3 full runs and alone: not investigated.
- **2026-11-09, Roadmap B14 (polish): phones, accessibility, image weight (local).** Measured first: every page at 390px in en + ar, and an axe scan (WCAG A/AA) in light + dark. **Phones:** on every tool page the top bar overflowed by up to 131px and pushed the account menu, and so sign-out, off the screen, in both languages; clipped, so the page itself didn't scroll. On phones the bar now drops the tool badge and the name. History filters are a two-column grid with the dates on screen; banner, sort row and pagination wrap. Looks tabs are one scrolling row. Team's actions column stays pinned. The admin console's menu moves above the page, as in Settings, and its tables no longer widen the page (`relative` on the scroll container). **Accessibility:** `--subtle` was 2.53:1 as text, now `#5b6472` (`#8f8f99` dark); `#ef4444` text became `text-danger`; history badges darkened; dark `--primary` is `#818cf8` with dark button text, because the old indigo failed as text on dark surfaces (a visible change: buttons in dark mode are lighter); amber notices remapped in dark; checkboxes have a visible border; the account and language controls name their visible text; the Settings scroll area takes keyboard focus. **Images:** previews downloaded full PNGs. Stored assets take `?w=96|256|640` (`src/lib/image/thumbnail.ts`, WebP, org check unchanged, falls back to the original); public files go through the Next optimizer (`thumbnailUrl`). Image bytes on the demo org: History 3.4 MB to 133 kB, Looks 11.8 MB to 2.9 MB (the rest is the editing canvas, kept full size). **Also:** `CopyBulk.sourcePaste` was under `Copy`; moved. New `tests/unit/messages-used.test.ts` checks every literal `t("key")` exists and en/ar match. New E2E: `phone-layout.spec.ts`, `accessibility.spec.ts` (adds dev dependency `@axe-core/playwright`). **Not done:** the scan only covers what a scanner sees, no keyboard or screen reader run; `/looks` product cards still fail axe `label-content-name-mismatch` (their label leaves out the visible SKU), so `/looks` is outside the scan test; thumbnails are re-made per request, cached by the browser only; the Prompt dock takes about a third of a phone screen (design call); JS is about 1.5 MB uncompressed per app page, not investigated; **A+ product can still touch the title box** (needs a live check); Arabic copy now asks for units in Arabic ("220 سم"), a prompt change not yet run against a live model; phones and scan not run on dynamic routes (`/looks/boards/[id]`, admin org detail).
- **2026-11-09, Roadmap B9: view an org as its admin (local).** Console: org page, "View as admin" (with a confirmation). State is a signed 30-minute cookie (`src/lib/auth/view-as.ts`), not Clerk actor tokens as first planned, so it works the same with Clerk and the local login; it only counts for the super admin it was issued to, whose role is re-checked on every request. **Read-only fails closed:** in a view `getWorkspace()` refuses every Server Action unless it passes `{ read: true }`, so a new action can't write by accident (a forgotten mark shows a refusal, never a change); the proxy stops every other POST (chat, resize, forms without JavaScript) with 403. **Audit:** `org.view_started` and `org.view_ended` on the customer's org, shown in Admin → Activity and on the org page. A banner is always on screen with the org, the end time, and Exit; refusals say nothing was saved. **Found by the test:** visiting Looks seeded the org's room backgrounds; now skipped in a view. Privacy draft (en + ar) now discloses staff access, for the lawyer's review. Verified: tsc + eslint clean; 355 Vitest tests; `next build`; 38 Playwright specs. `view-as.spec.ts` opens a customer's org, visits 25 pages, tries a brand kit save, an invite, an API call and a plain form, then compares a hash of every row stored for that org (and its `organizations` row) before and after: unchanged. **Limits:** the hash check ran on a new org with little data, so a read that writes only in some state wouldn't show; a static trace of the read actions found no others, but it can't see everything. A view that simply expires has no `org.view_ended` entry (the start entry records 30 minutes). Customers can't see these entries in their own workspace. The Clerk path wasn't run live. A dialog stays open behind a refusal until closed. Admins viewing see buttons they can't use, as the UI isn't aware of the view beyond the banner.
