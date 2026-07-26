# Codebase inventory — arm-04 (slice: integrations)

Source (read-only): `.scratch/sources/tomche-shabbos-website`. Paths below are relative to that root.

## Proof-of-read

- Rules files read: 5 (`.cursor/rules/ponytail.mdc`, `clean-code.mdc`, `workflow.mdc`, `vocabulary.mdc`, `codegraph.mdc`) + `AGENTS.md` + `ARM.md`
- `codegraph status` = "Not initialized" in this repo, and the source tree is read-only for this test, so structural lookups used Read + scripted `Select-String` (codegraph.mdc fallback clause).
- Top-level dirs sampled: `src/integrations`, `src/app/api` (all 29 route files listed), `src/features` (auth, checkout, email, payments, refunds, reconciliation, shipping, fulfillment), `src/config`, `src/server`, `src/lib`, `src/components`, `prisma`, `scripts`, `.github/workflows`, plus `package.json`, `.env.example`, `vercel.json`, `next.config.ts`
- Slice boundary used: anything that crosses a process boundary to a third party (Clerk, Stripe, Resend, Shippo, Mapbox, Vercel Blob, Vercel Cron, Neon/Postgres), plus the config, guard, idempotency, and degradation machinery those calls depend on. Pure domain logic (pricing, inventory, order state) is left to other slices.

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| **Auth — Clerk** | | | |
| F-001 | Single Clerk SDK boundary module | `src/integrations/clerk.ts` | `getClerkAuth()` / `getClerkUser()`; file comment forbids importing `@clerk/*` elsewhere. Server components/pages still import `@clerk/nextjs` UI directly (see F-004). |
| F-002 | Clerk middleware on every non-static request | `src/middleware.ts` | `clerkMiddleware()`; matcher skips `_next` and static assets. Protects nothing by itself — pages own their guards. |
| F-003 | Hosted sign-in / sign-up routes | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignIn/>` / `<SignUp/>`; route URLs come from `NEXT_PUBLIC_CLERK_*_URL` env with defaults. |
| F-004 | Clerk account widget in all three shells | `src/components/storefront/user-menu.tsx`, `src/app/(admin)/admin/admin-shell.tsx`, `src/app/(messenger)/messenger/layout.tsx`, `src/app/layout.tsx` | `<UserButton/>` + root `<ClerkProvider>`. |
| F-005 | Clerk user auto-linked to a Customer row | `src/features/auth/server/ensureCustomer.ts`, `src/features/auth/server/customer.ts` | Matches by `clerkUserId` or normalized email, back-fills `clerkUserId` on a pre-existing (imported) customer, else creates one. |
| F-006 | Signed-in profile edit gated by Clerk identity | `src/app/api/account/profile/route.ts` | 401 without `userId`; 403 unless `customer.clerkUserId` matches. |
| F-007 | Staff impersonation overriding the Clerk identity | `src/app/api/impersonate/route.ts`, `src/features/auth/server/impersonation.ts` | Developer-only cookie layer on top of Clerk; POST starts, DELETE stops, audit-logged. |
| **Payments — Stripe** | | | |
| F-008 | Shared lazy Stripe client | `src/integrations/stripe.ts` | `getStripe()`. Its own comment admits the money paths each build their own client (see F-021). |
| F-009 | Hosted Stripe Checkout session for card payment | `src/app/api/checkout/route.ts` | Builds line items from frozen price snapshots, adds a "Shipping" line, sets success/cancel URLs and `metadata.orderId`. Order is NOT finalized here. |
| F-010 | Stripe coupon used for order discounts | `src/app/api/checkout/route.ts` (`stripe.coupons.create`) | One-off `amount_off` coupon per session; skipped when discount is 0. |
| F-011 | Local mirror of the Stripe payment intent | `src/app/api/checkout/route.ts`, `prisma/schema.prisma` (`model PaymentIntent`) | Stores intent id, checkout session id, and the exact server-computed amount for later comparison. |
| F-012 | Stripe webhook receiver with signature verification | `src/app/api/webhooks/stripe/route.ts` | Rejects missing/invalid `stripe-signature` with 400; raw body read before parsing. |
| F-013 | Webhook idempotency via ProcessedWebhookEvent | `src/app/api/webhooks/stripe/route.ts`, `prisma/schema.prisma` (`model ProcessedWebhookEvent`) | Insert-first, P2002 = duplicate → 200. Record is deleted if the handler throws so Stripe's retry re-runs it. |
| F-014 | `checkout.session.completed` handling | `src/app/api/webhooks/stripe/route.ts` | Marks the intent succeeded and recalculates the order's payment status. |
| F-015 | `payment_intent.succeeded` → payment row + order finalization | `src/app/api/webhooks/stripe/route.ts` | Upserts the Payment, then finalizes a still-draft order as `system:stripe-webhook`. This is where a paid order actually becomes confirmed. |
| F-016 | Stale-session auto-refund (charged amount ≠ order total) | `src/app/api/webhooks/stripe/route.ts` (`autoRefund`, `expectedChargeCents`) | Refunds instead of finalizing when snapshots changed after the session was created. |
| F-017 | Inventory-failure auto-refund safety net | `src/app/api/webhooks/stripe/route.ts` (`autoRefund` in the finalize `catch`) | Customer paid but allocation failed → refund with `idempotencyKey: auto-refund-<pi>`, write Refund row + `refund_notification` outbox event in one transaction, drain it immediately. |
| F-018 | `charge.refunded` reconciliation, including dashboard refunds | `src/app/api/webhooks/stripe/route.ts` (`reconcileStripeRefund`) | Re-lists refunds from Stripe rather than trusting the event payload; creates a local Refund row for refunds issued in the Stripe dashboard; never downgrades an already-posted row. |
| F-019 | Staff card refund through Stripe | `src/features/orders/server/adminPayments.ts` (`refundToCard`) | Refund row written first, its id used as the Stripe idempotency key and carried in `metadata.refundRowId`; distinguishes definitive rejections (row → failed) from ambiguous network errors (row stays pending). |
| F-020 | Monthly Stripe reconciliation report | `src/app/api/cron/reconcile-stripe/route.ts`, `src/features/reconciliation/server/runReconciliation.ts`, `src/features/reconciliation/server/matcher.ts` | Report-only: pulls 40 days of charges/refunds (auto-paging, 1000 cap, `truncated` flag) and stores discrepancies in `ReconciliationReport`. Reused by the admin "Run now" action. |
| F-021 | Drift: four separate Stripe client constructions | `src/integrations/stripe.ts`, `src/app/api/checkout/route.ts:26`, `src/app/api/webhooks/stripe/route.ts:20`, `src/features/orders/server/adminPayments.ts:39` | Only `runReconciliation` uses the shared `getStripe()`. No pinned `apiVersion` anywhere. |
| F-022 | Drift: Stripe browser SDKs installed but unused | `package.json` (`@stripe/react-stripe-js`, `@stripe/stripe-js`) | No `loadStripe` / `@stripe/*` import exists in `src/`. Checkout is a hosted redirect, so these deps are dead weight. |
| **Email — Resend** | | | |
| F-023 | Single Resend sender factory | `src/integrations/resend.ts` | `createResendSender(from)`; the only file importing `resend`. Throws with the provider's message on `response.error`. |
| F-024 | One dispatcher for every email, claim-first idempotent | `src/features/email/server/dispatchEmail.ts`, `prisma/schema.prisma` (`model SentEmail`) | `SentEmail` row created before sending (unique `templateKey`+`dedupeKey`); claim released if the send throws. |
| F-025 | Test-mode email capture instead of real sends | `src/features/email/server/dispatchEmail.ts`, `prisma/schema.prisma` (`model EmailLog`) | When `IS_TEST_ENV=true` the HTML is written to `EmailLog` and Resend is never called. |
| F-026 | Transactional order emails (confirmation, payment link, refund notice) | `src/features/email/server/orderEmails.ts`, `src/server/outbox.ts` | Registered as outbox handlers `confirmation_email`, `payment_link`, `refund_notification`. |
| F-027 | Editable triggered-email templates with branding wrapper | `src/features/email/server/templateRender.ts`, `triggeredEmailDefaults.ts`, `templateActions.ts`, `orderSummaryHtml.ts` | Token substitution + branded HTML shell; defaults live in code, overrides in the DB. |
| F-028 | Daily unpaid-payment reminder emails | `src/app/api/cron/payment-reminders/route.ts` | Escalates reminder level 0→1→2 then auto-cancels; dedupe key `<orderId>_level<n>`; skips snoozed and exempt orders; writes a `JobRun`. |
| F-029 | Marketing campaign send with preference filtering | `src/features/email/server/campaignSend.ts`, `marketingActions.ts` | Honors `all` / `if_not_ordered` / `once_yearly`, batches 10 at a time with `allSettled`, and claims the campaign atomically so it can't send twice. |
| F-030 | Public subscribe endpoint | `src/app/api/subscribe/route.ts`, `src/features/email/server/upsertSubscriber.ts` | Distinguishes new / already-subscribed / resubscribed; 5 requests per minute per IP. |
| F-031 | HMAC-signed unsubscribe links | `src/features/email/server/unsubscribeToken.ts`, `src/app/api/unsubscribe/route.ts` | SHA-256 HMAC over `email:purpose`, `timingSafeEqual` compare, 403 on a forged or mismatched token; supports downgrade preferences, not just full unsubscribe. |
| F-032 | Admin "send test email" button | `src/features/settings/server/actions.ts` (`sendTestEmail`) | Dynamically imports the Resend sender and passes the provider error through so a bad key is visible. |
| F-033 | Drift: test email reads undeclared env vars | `src/features/settings/server/actions.ts:246-250` vs `src/config/env-schema.ts` | Uses `EMAIL_FROM_NAME` / `EMAIL_FROM_ADDRESS`, which are in neither `envSchema` nor `.env.example` (the rest of the app uses `RESEND_FROM_EMAIL`). The button always fails on a schema-conformant deployment. |
| F-034 | Email/webhook log retention purge | `src/app/api/cron/purge-email-log/route.ts` | Daily: `EmailLog` > 30d, `SentEmail` > 90d, `ProcessedWebhookEvent` > 90d, deleted in one transaction. |
| **Shipping — Shippo** | | | |
| F-035 | Single Shippo wrapper with configured-check | `src/integrations/shippo.ts` | `isShippoConfigured`, `rateShipment`, `buyLabel`, `voidLabel`, `trackShipment`, `validateAddress`; every call returns `{ok:false}` instead of throwing when `SHIPPO_API_KEY` is absent; converts dollar strings to integer cents. |
| F-036 | Buy the cheapest carrier label for a fulfillment group | `src/features/fulfillment/server/shipmentActions.ts` (`buyLabelForGroup`), `src/features/shipping/server/shipmentPlanning.ts`, `binPacking.ts` | Packs boxes (add-on weight included), rates, buys cheapest, records `savingsCents` vs what the customer was charged. |
| F-037 | Compare-and-set lock against double label purchase | `src/features/fulfillment/server/shipmentActions.ts` (claim on `labelPrintedAt`, `releaseClaim`) | Two concurrent clicks can't both buy; the claim is released if rating or buying fails. |
| F-038 | Auto-void compensation when the label can't be saved | `src/features/fulfillment/server/shipmentActions.ts` (catch around the transaction) | Dual-write failure → void the purchased label; if the void also fails, the error hands staff the Shippo transaction id instead of silently buying a second label. |
| F-039 | Void a purchased label | `src/features/fulfillment/server/shipmentActions.ts` (`voidLabelForGroup`) | Blocked once the group is shipped/delivered; resets the group to pending. |
| F-040 | Carrier tracking refresh drives fulfillment status | `src/features/fulfillment/server/shipmentActions.ts` (`refreshGroupTracking`) | `DELIVERED` → delivered, `TRANSIT` → shipped; never moves a group backwards. |
| F-041 | Carrier address validation for a shipment | `src/features/fulfillment/server/shipmentActions.ts` (`validateGroupAddress`), `src/integrations/shippo.ts` (`validateAddress`) | Creates a Shippo address with `validate:true` purely to read the verdict. |
| F-042 | Ship-from address from env, validated before any carrier call | `src/features/shipping/server/shipmentPlanning.ts` (`validateShipFrom`), `.env.example` `SHIP_FROM_*` | Names the missing fields; env defaults ship blank on purpose. |
| F-043 | Shipping-off degradation surfaced in the admin UI | `src/app/(admin)/admin/orders/[id]/page.tsx:42` (`isShippoConfigured`) | Label controls adapt when Shippo isn't configured. |
| F-044 | Carrier rate-id classification (shippo/usps/ups/fedex prefixes) | `src/features/shipping/server/rateResolution.ts` | Maps a chosen rate id to method + cost; unknown ids return null rather than being accepted. |
| F-045 | Stub: `/api/addresses/validate` is a USPS placeholder | `src/app/api/addresses/validate/route.ts` | Only checks non-empty fields and a 5(+4) digit ZIP, then echoes the address back. No USPS call, and no rate limit / `withPublicGuard` on this public route. |
| F-046 | Drift: UPS and USPS credentials declared but never read | `src/config/env-schema.ts` (`UPS_CLIENT_ID/SECRET/ACCOUNT_NUMBER`, `USPS_USER_ID`), `.env.example` | No code reads these four vars anywhere in `src/` or `scripts/`. |
| **Maps / geocoding — Mapbox** | | | |
| F-047 | Server-side Mapbox geocoding provider | `src/integrations/mapbox.ts` | Geocoding v5 `mapbox.places`, US-only, limit 1; missing token returns a clean failure instead of throwing. |
| F-048 | Geocode cache with success/failure TTLs | `src/features/shipping/server/geocode.ts`, `prisma/schema.prisma` (`model GeocodeCache`) | 7-day success TTL, 6-hour failure TTL with `retryAfter`; route builder reads cache only and never blocks on a live call. |
| F-049 | Async geocode refresh through the outbox | `src/features/shipping/server/geocodeRefresh.ts`, `src/server/outbox.ts` (`geocode_refresh` handler), `src/features/customers/server/savedAddresses.ts` | Saving an address clears coords and queues the refresh; coords are copied onto draft orders' fulfillment groups. |
| F-050 | Address autocomplete backed by Mapbox Search | `src/components/ordering/address-autocomplete.tsx`, `src/components/ordering/address-fields.tsx` | Client-side call to Mapbox geocode v6 forward, debounced with a minimum query length, ARIA combobox; renders nothing (manual typing still works) when the public token is absent. |
| F-051 | Route-builder map with clickable stop pins | `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx`, `.../build-route/page.tsx` | `mapbox-gl` loaded via dynamic `import()`; token passed from the server. Explicitly a bonus — a callout tells staff the map needs a token and routing still works without it. |
| F-052 | Stub: route-builder coord refresh does no geocoding | `src/app/api/route-builder/refresh-coords/route.ts` | Finds up to 500 local-delivery groups missing lat/lng and returns `{refreshed: 0}`; the geocoding call is a TODO comment, even though F-047 exists and could be called. |
| **Media storage — Vercel Blob** | | | |
| F-053 | Image upload to Vercel Blob with type/size validation | `src/app/api/media/route.ts` | `put()` under `media/<ts>-<safe name>`; JPEG/PNG/GIF/WebP only, 2MB cap, filename sanitized; requires `products.edit`. |
| F-054 | Media library listing and search | `src/app/api/media/route.ts` (GET), `prisma/schema.prisma` (`model MediaUpload`) | Newest-first, 100 max, optional case-insensitive filename query; feeds the product/add-on media picker. |
| F-055 | Media delete removes the blob and the row | `src/app/api/media/[id]/route.ts` | `del()` from `@vercel/blob`. |
| F-056 | Blob host allow-listed for `next/image` | `next.config.ts` | `*.public.blob.vercel-storage.com`. |
| F-057 | One-off migration: relink images from the previous Blob store | `scripts/link-old-product-images.ts` | Lists the old store with `OLD_BLOB_TOKEN` (an env var not in `env-schema.ts`), matches blobs to products by slug, dry-run unless `--apply`. |
| **Scheduling / delivery reliability** | | | |
| F-058 | Five Vercel cron jobs | `vercel.json` | `payment-reminders` daily 14:00, `outbox-sweep` / `pickup-expiry` / `purge-email-log` daily 00:00, `reconcile-stripe` monthly on the 1st at 06:00. |
| F-059 | Bearer `CRON_SECRET` on every cron route | `src/server/verifyCronSecret.ts`, all five `src/app/api/cron/*/route.ts` | Missing secret means deny (fails closed). Plain string compare, not constant-time. |
| F-060 | Transactional outbox with retry, backoff and give-up | `src/server/outbox.ts`, `prisma/schema.prisma` (`model OutboxEvent`) | Enqueue inside the caller's transaction, linear backoff (attempts × 60s), parked as `failed` after 10 attempts. |
| F-061 | Dual drain: inline for responsiveness, cron sweep as the net | `src/server/outbox.ts` (`drainOutboxForEntity`), `src/app/api/cron/outbox-sweep/route.ts` | Sweep takes 50 events per run; handlers are idempotent so an inline/cron race is safe. |
| F-062 | Job run history for cron observability | `prisma/schema.prisma` (`model JobRun`), cron routes | Name, status, count, error, finish time. |
| F-063 | Pickup-expiry reminders and auto-cancel | `src/app/api/cron/pickup-expiry/route.ts` | Policy-driven from settings; respects snooze and `autoCancelExempt`. |
| **Platform, config and hardening** | | | |
| F-064 | Fail-loud env validation at boot | `src/config/env.ts`, `src/config/env-schema.ts` | Zod schema throws at import if a critical var is missing; `safeParseEnv()` is the non-throwing variant for the health check. |
| F-065 | Critical vs optional integration split | `src/config/env-schema.ts` (`CRITICAL_KEYS`, `OPTIONAL_KEYS`) | Clerk/Stripe/Resend/DB/cron/HMAC are required; Shippo, UPS, USPS, Mapbox, Blob are optional with graceful degradation. |
| F-066 | `.env.example` generated from the schema and kept in sync by a test | `src/config/env-schema.ts` (`ENV_SECTIONS`, `renderEnvExample`), `scripts/gen-env-example.ts`, `src/config/env.test.ts`, `.env.example` | Parity test asserts neither side drifts — which is what makes F-033, F-046 and F-057 visible as drift. |
| F-067 | Admin integration status panel | `src/app/(admin)/admin/settings/page.tsx:65-100` | Shows Configured / Missing / Not configured for Database, Clerk, Stripe, Resend, Shippo, Mapbox. Presence check only, no live ping. |
| F-068 | Health endpoint for deploy verification | `src/app/api/health/route.ts` | 503 with `env_validation_failed` or `database_unreachable`, 200 otherwise; deliberately does not name the missing vars. |
| F-069 | Shared guard for public API routes | `src/server/withPublicGuard.ts` | Same-origin check, atomic DB-backed per-IP rate limit (`RateLimitBucket`, single upsert), Zod parse, 500-masking. Used by checkout, offline checkout, subscribe, unsubscribe, client-error — not by `addresses/validate`, `setup`, or `impersonate`. |
| F-070 | Client-side error reporting endpoint | `src/app/api/client-error/route.ts` | Logs message/digest/pathname (query string stripped), 10/min/IP. No external error tracker is wired up. |
| F-071 | Structured logging with PII/secret redaction | `src/lib/logging/index.ts` | JSON lines to console; redacts by exact key and substring (`secret`, `token`, `email`, `name`, `zip`, …). Console-only — no Sentry/Datadog integration exists. |
| F-072 | Neon Postgres through a Prisma singleton | `src/server/db.ts`, `prisma/schema.prisma`, `.env.example` (`DATABASE_URL`) | Global reuse across hot reloads; query logging only in development. |
| F-073 | Test-environment data endpoints | `src/app/api/admin/reset-test-db/route.ts`, `seed-test-season/route.ts`, `wipe-test-data/route.ts`, `src/features/testdata/server/*` | Double-gated on `IS_TEST_ENV` plus the developer `impersonate` permission. |
| F-074 | Sister-environment switch link | `.env.example` (`NEXT_PUBLIC_SISTER_URL`, `NEXT_PUBLIC_APP_ENV`), `src/config/env-schema.ts` | Test ↔ production cross-link plus environment badge input. |
| F-075 | Unauthenticated first-run setup route | `src/app/api/setup/route.ts` | Creates the first developer `StaffUser`; becomes a 409 no-op once any staff row exists. No rate limit or guard. |
| F-076 | Nexternal legacy migration importers | `scripts/nexternal/**` (`customers/`, `historical/`, `products/`, `shared/excel.ts`) | Reads the old platform's xlsx exports (`xlsx` dep), plan/commit split with matching and unmatched reporting; `npm run import:*`. Offline file import, not a live API. |
| F-077 | CI runs typecheck, lint, tests and a production build on placeholder integration keys | `.github/workflows/ci.yml`, `.github/workflows/agent-guardrails.yml`, `scripts/check-schema-has-migration.mjs` | Every critical env var is supplied as a fake value so the boot guard (F-064) doesn't fail the build. `lighthouserc.json` exists but no workflow or npm script invokes it. |

**Count: 77 features.**

## Cross-cutting observations (integrations slice)

- Every third-party client sits behind exactly one module in `src/integrations/` — except Stripe, which is instantiated four times (F-021).
- Optional integrations degrade instead of throwing: Shippo and Mapbox return `{ok:false}`, the map and autocomplete hide themselves, and only Blob's absence would surface as a raw upload error.
- Three idempotency mechanisms guard money and mail: Stripe idempotency keys, unique DB constraints (`ProcessedWebhookEvent`, `SentEmail`, `Refund.stripeRefundId`), and compare-and-set claims (label purchase, campaign send).
- Two documented stubs (F-045 USPS validation, F-052 coord refresh) return success-shaped responses while doing no external work — a rebuild that trusts the route names alone would inherit silent no-ops.

## Blocked / not covered

- Nothing blocked. The source tree was fully readable.
- `codegraph` was unavailable (no index, and initializing one would have written into the read-only source), so this inventory came from directory listings, targeted reads, and scripted text search rather than AST queries.
- Out of slice on purpose (other specialists): pricing and inventory math, order state machine, admin UI screens, reports and exports, messenger/route-building UX, test suites.
- Not verified at runtime: no external credentials were exercised, so provider behavior is inferred from code and comments only.
