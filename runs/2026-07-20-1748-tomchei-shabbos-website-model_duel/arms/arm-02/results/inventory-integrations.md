# Codebase inventory — arm-02 (job: integrations)

## Proof-of-read
- Rules files read: 3 (arm `AGENTS.md`, `.cursor/rules/*.mdc` x2 sampled: workflow, vocabulary; plus prompt `1a-integrations-prompt.md`)
- Top-level dirs sampled: `src/integrations`, `src/app/api`, `src/features`, `src/server`, `src/config`, `src/components`, `prisma`, `scripts/nexternal`, plus `package.json`, `.env.example`, `vercel.json`

All evidence paths are relative to the read-only source root:
`D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\tomche-shabbos-website`

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| INT-001 | Clerk authentication (SDK isolated in one module) | `src/integrations/clerk.ts`; `src/middleware.ts` | `getClerkAuth()` / `getClerkUser()`; `clerkMiddleware()` guards all routes; only file allowed to import `@clerk/*` |
| INT-002 | Clerk hosted sign-in / sign-up pages | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`; `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Catch-all Clerk routes; URLs configurable via `NEXT_PUBLIC_CLERK_*` env (`.env.example` lines 23-26) |
| INT-003 | Shared Stripe server client | `src/integrations/stripe.ts` | Lazy singleton `getStripe()`; older money paths construct their own client (noted in file header) |
| INT-004 | Stripe Checkout Session creation | `src/app/api/checkout/route.ts` | POST creates hosted Checkout Session for a draft order; finalization deferred to webhook; discounts via Stripe coupons |
| INT-005 | Stripe webhook receiver | `src/app/api/webhooks/stripe/route.ts`; `src/features/payments/server/webhookIdempotency.ts` | Signature verification (`STRIPE_WEBHOOK_SECRET`), idempotency via `ProcessedWebhookEvent`, 500 on handler failure so Stripe retries |
| INT-006 | Stripe refunds | `src/features/refunds/server/createRefund.ts`; `src/features/refunds/server/createRefund.integration.test.ts` | Server action issuing refunds against Stripe payments |
| INT-007 | Monthly Stripe reconciliation | `src/app/api/cron/reconcile-stripe/route.ts`; `src/features/reconciliation/server/runReconciliation.ts`; `src/features/reconciliation/server/matcher.ts` | Cron (`vercel.json` `0 6 1 * *`) matches Stripe charges vs local orders; admin report page `src/app/(admin)/admin/reconciliation/page.tsx` |
| INT-008 | Offline/POS payments recorded alongside Stripe | `src/app/api/checkout/offline/route.ts`; `src/features/orders/server/adminPayments.ts` | Non-Stripe payment path that coexists with Stripe records in payment math (`src/features/payments/server/paymentMath.ts`) |
| INT-009 | Resend email sender (SDK isolated) | `src/integrations/resend.ts`; `src/features/email/server/dispatchEmail.ts` | `createResendSender()` is the only Resend importer; all sends via `dispatchEmail.ts`; from-address via `RESEND_FROM_EMAIL` |
| INT-010 | Transactional order emails (confirmation / payment link / refund notice) | `src/features/email/server/orderEmails.ts`; `src/server/outbox.ts` | Queued as durable outbox events; drained inline + by cron sweep |
| INT-011 | Marketing email campaigns | `src/features/email/server/marketingActions.ts`; `src/features/email/server/campaignSend.integration.test.ts`; `src/app/(admin)/admin/settings/email-tab.tsx` | Admin-driven campaign send through the Resend pipeline |
| INT-012 | Email subscribe / unsubscribe with HMAC tokens | `src/app/api/subscribe/route.ts`; `src/app/api/unsubscribe/route.ts`; `src/features/email/server/unsubscribeToken.ts` | `UNSUBSCRIBE_HMAC_SECRET` prevents forged unsubscribes; preferences: unsubscribe / if_not_ordered / once_yearly |
| INT-013 | Email log purge cron | `src/app/api/cron/purge-email-log/route.ts` | Daily cron (`vercel.json`) purging old email log rows |
| INT-014 | Shippo shipping SDK wrapper | `src/integrations/shippo.ts` | Sole Shippo importer: `rateShipment()`, `buyLabel()`, `voidLabel()`, `trackShipment()`, `validateAddress()`; degrades gracefully without `SHIPPO_API_KEY` |
| INT-015 | Shipment planning, label purchase and void (admin) | `src/features/fulfillment/server/shipmentActions.ts`; `src/features/shipping/server/shipmentPlanning.ts`; `src/app/(admin)/admin/orders/[id]/shipment-actions.tsx` | Admin order UI drives Shippo rating/label flows; ship-from address from `SHIP_FROM_*` env |
| INT-016 | Carrier rate resolution (flat vs calculated; usps_/ups_/fedex_/shippo_ prefixes) | `src/features/shipping/server/rateResolution.ts` | Pure resolver mapping customer-chosen rateId to method + cost; shared by checkout, POS, finalization |
| INT-017 | Mapbox server-side geocoding | `src/integrations/mapbox.ts`; `src/features/shipping/server/geocode.ts`; `src/features/shipping/server/geocodeRefresh.ts` | `mapboxGeocodeProvider` (Geocoding API v5) turns addresses into lat/lng; clean failure without token |
| INT-018 | Mapbox address autocomplete (storefront) | `src/components/ordering/address-autocomplete.tsx` | ARIA combobox backed by Mapbox; manual fields remain usable when `NEXT_PUBLIC_MAPBOX_TOKEN` is absent |
| INT-019 | Mapbox GL route-builder map (delivery routes) | `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx`; `src/app/api/route-builder/refresh-coords/route.ts` | `mapbox-gl` map for ordering delivery stops; coords refresh endpoint re-geocodes |
| INT-020 | USPS address validation (placeholder) | `src/app/api/addresses/validate/route.ts`; `.env.example` line 41 | Route explicitly a placeholder for USPS API; currently format-checks only. `USPS_USER_ID` declared but unused in code |
| INT-021 | UPS direct credentials (declared, not implemented) | `.env.example` lines 37-39; `src/config/env-schema.ts` | `UPS_CLIENT_ID/SECRET/ACCOUNT_NUMBER` in env schema; no UPS API calls found in `src/` — carrier handled via Shippo |
| INT-022 | Vercel Blob media library | `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts`; `scripts/link-old-product-images.ts` | `put()` upload (jpeg/png/gif/webp, max 2MB) + `MediaUpload` rows; `BLOB_READ_WRITE_TOKEN` |
| INT-023 | Neon PostgreSQL via Prisma | `prisma/schema.prisma` (datasource lines 16-17); `src/server/db.ts`; `.env.example` lines 3-4 | `DATABASE_URL` (sslmode=require); migrations under `prisma/migrations/` |
| INT-024 | Vercel Cron jobs (5) with secret auth | `vercel.json`; `src/server/verifyCronSecret.ts`; `src/app/api/cron/payment-reminders/route.ts`; `src/app/api/cron/outbox-sweep/route.ts`; `src/app/api/cron/pickup-expiry/route.ts` | payment-reminders, outbox-sweep, pickup-expiry, purge-email-log, reconcile-stripe; all gated by `CRON_SECRET` |
| INT-025 | Outbox pattern for external side effects | `src/server/outbox.ts`; `src/app/api/cron/outbox-sweep/route.ts` | Durable queue for emails + geocoding with retry/backoff/park-as-failed |
| INT-026 | Nexternal legacy-platform data import (Excel) | `scripts/nexternal/shared/excel.ts`; `scripts/nexternal/customers/importCustomers.ts`; `scripts/nexternal/historical/importHistorical.ts`; `scripts/nexternal/products/importProducts.ts`; `package.json` scripts lines 27-31 | One-time migration from Nexternal exports via `xlsx`; plan/commit staged flow; `fix:order-numbers` repair script |
| INT-027 | Health check (DB + env validation) | `src/app/api/health/route.ts` | 200/503 for deploy verification; checks Prisma connectivity and `safeParseEnv()` |
| INT-028 | Test/prod sister-environment switch | `.env.example` lines 59-63; `src/components/admin/env-switch-link.tsx`; `src/app/api/admin/reset-test-db/route.ts` | `NEXT_PUBLIC_SISTER_URL` + `IS_TEST_ENV` power an env-switch link and test-only DB reset/seed endpoints |
| INT-029 | Client-side Stripe packages present but no client mount found | `package.json` lines 37-38 | `@stripe/stripe-js` + `@stripe/react-stripe-js` in deps; no `loadStripe`/Elements usage found in `src/` — checkout is hosted-redirect. Flag for merge agent |

## Blocked / uncertain areas
- INT-021 and INT-029 are dependency/env declarations without call sites — listed with that caveat, not as invented features.
- Did not run the app or hit any external API; inventory is static-read only.
