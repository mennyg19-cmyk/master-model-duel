# Codebase inventory — arm-01 integrations

## Proof-of-read
- Rules files read: 22, plus `AGENTS.md`.
- Top-level areas sampled: `src/integrations`, `src/app/api`, `src/features/auth`, `src/features/email`, `src/features/fulfillment`, `src/features/payments`, `src/features/reconciliation`, `src/features/shipping`, `src/server`, `prisma`, and root configuration/docs.
- Inventory scope: implemented external-service adapters, their user/operations-facing flows, webhooks, and scheduled integration endpoints.
- Source was read-only. Its CodeGraph index was not initialized, so file inspection and literal import lookup were used without creating an index.

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| INT-001 | Clerk sign-in and sign-up | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`; `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`; `src/app/layout.tsx` | Clerk provides the hosted authentication UI and wraps the application. |
| INT-002 | Clerk request authentication and identity normalization | `src/middleware.ts`; `src/integrations/clerk.ts` | Middleware enables Clerk auth on application/API requests; the adapter exposes session identity and a normalized current-user shape. |
| INT-003 | Stripe hosted checkout | `src/app/api/checkout/route.ts` | Creates a Stripe Checkout Session for an authorized draft order, includes product/add-on/shipping snapshots and one-time discounts, and stores the Stripe intent/session IDs. |
| INT-004 | Stripe payment webhook processing | `src/app/api/webhooks/stripe/route.ts` | Verifies signatures, deduplicates events, records successful intents/payments, recalculates order payment state, and finalizes paid draft orders. |
| INT-005 | Stripe refund synchronization | `src/app/api/webhooks/stripe/route.ts` | Reconciles refund events, including refunds initiated in Stripe, and preserves idempotent local refund records. |
| INT-006 | Stripe automatic safety refunds | `src/app/api/webhooks/stripe/route.ts` | Automatically refunds stale-price charges or paid orders that cannot be finalized, records the refund, and queues a customer notice. |
| INT-007 | Stripe reconciliation reporting | `src/features/reconciliation/server/runReconciliation.ts`; `src/app/api/cron/reconcile-stripe/route.ts` | Pulls recent Stripe charges/refunds, compares them with local records, and persists a report-only discrepancy report. |
| INT-008 | Shippo carrier rate lookup and cheapest-rate selection | `src/integrations/shippo.ts`; `src/features/fulfillment/server/shipmentActions.ts`; `src/features/shipping/server/shipmentPlanning.ts` | Packs fulfillment items into parcels, requests carrier rates, and selects the lowest-priced returned rate. |
| INT-009 | Shippo shipping-label purchase | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | Buys a PDF label, prevents concurrent duplicate purchases, and stores carrier, cost, savings, tracking, label, transaction, and parcel details. |
| INT-010 | Shippo label voiding and failure compensation | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | Staff can void unshipped labels; a bought label is also auto-voided when its database save fails. |
| INT-011 | Shippo tracking refresh | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | Fetches carrier tracking and advances fulfillment status to shipped or delivered without moving status backward. |
| INT-012 | Shippo address validation | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | Staff can submit a fulfillment address for Shippo deliverability validation and receive carrier messages. |
| INT-013 | Resend transactional order email delivery | `src/integrations/resend.ts`; `src/features/email/server/orderEmails.ts` | Sends branded order confirmation, payment-link, and refund-notice emails through Resend. |
| INT-014 | Resend payment-reminder delivery | `src/app/api/cron/payment-reminders/route.ts`; `src/integrations/resend.ts` | The secured daily endpoint sends staged unpaid-order reminders through Resend and can auto-cancel overdue non-exempt orders. |
| INT-015 | Resend marketing campaign delivery | `src/features/email/server/marketingActions.ts`; `src/features/email/server/campaignSend.ts`; `src/integrations/resend.ts` | Staff can send personalized campaigns to all subscribers or a mailing list, filtered by opt-out and frequency/order preferences in batches of 10. |
| INT-016 | Idempotent email sending and test capture | `src/features/email/server/dispatchEmail.ts` | Claims a unique send slot before delivery, releases it on failure, records provider IDs, and captures messages to `EmailLog` instead of Resend in test mode. |
| INT-017 | Mapbox address geocoding with cache | `src/integrations/mapbox.ts`; `src/features/shipping/server/geocode.ts`; `src/features/shipping/server/geocodeRefresh.ts` | Geocodes saved addresses, caches successes for seven days and failures for six hours, and copies coordinates onto draft fulfillment groups. |
| INT-018 | Vercel Blob media library | `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts`; `next.config.ts` | Authorized staff can list/search, upload, resolve, and delete media; uploads accept JPEG/PNG/GIF/WebP up to 2 MB and store metadata locally. |
| INT-019 | Secured outbox integration sweep | `src/app/api/cron/outbox-sweep/route.ts`; `src/server/verifyCronSecret.ts` | Processes up to 50 due side-effect events per invocation through the handler registry, with outcome tracking and retry scheduling. |
| INT-020 | Secured pickup-expiry operation | `src/app/api/cron/pickup-expiry/route.ts`; `src/server/verifyCronSecret.ts` | Applies configured pickup reminder/expiry policy, including snooze and exemption handling, and records each run. |
| INT-021 | Secured integration-log retention | `src/app/api/cron/purge-email-log/route.ts`; `src/server/verifyCronSecret.ts` | Purges test email logs after 30 days and sent-email/webhook idempotency records after 90 days, then records run counts. |
| INT-022 | Typed integration environment validation and graceful optional providers | `.env.example`; `src/config/env.ts`; `src/integrations/shippo.ts`; `src/integrations/mapbox.ts` | Critical provider settings are validated at boot; optional Shippo and Mapbox integrations return explicit configuration failures instead of crashing. |

## Blocked or incomplete integration areas
- `src/app/api/addresses/validate/route.ts` is only local format validation; the stated USPS integration is a placeholder.
- `src/app/api/route-builder/refresh-coords/route.ts` only counts missing coordinates and does not call Mapbox, despite the separate saved-address geocoding flow being implemented.
- `.env.example` exposes UPS credentials, but no UPS client or direct-rate implementation was found in the inspected integration code.
- The secured cron endpoints are implemented, but no checked-in scheduler configuration was found in the sampled root/config files; external scheduling could not be proven from source.
