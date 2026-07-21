# Codebase inventory — arm-03 (integrations)

## Proof-of-read
- Rules files read: 5 (`ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`)
- Top-level dirs sampled: `src/`, `src/integrations/`, `src/app/api/`, `src/features/`, `src/server/`, `src/config/`, plus `vercel.json`, `.env.example`

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Stripe shared client | `src/integrations/stripe.ts` | Lazy `getStripe()` over `STRIPE_SECRET_KEY` |
| F-002 | Stripe Checkout Session create | `src/app/api/checkout/route.ts` | POST creates Checkout Session; finalize deferred to webhook |
| F-003 | Stripe webhook receiver | `src/app/api/webhooks/stripe/route.ts` | Signature verify via `STRIPE_WEBHOOK_SECRET`; `ProcessedWebhookEvent` idempotency |
| F-004 | Stripe webhook payment / finalize routing | `src/app/api/webhooks/stripe/route.ts` | Handles `checkout.session.completed`, `payment_intent.succeeded`, refunds; may auto-refund / finalize order |
| F-005 | Admin Stripe card refund | `src/features/orders/server/adminPayments.ts` | `issueRefund` → `stripe.refunds.create` when method is `stripe` |
| F-006 | Stripe reconciliation (report-only) | `src/features/reconciliation/server/runReconciliation.ts`, `src/integrations/stripe.ts` | Pulls Stripe charges/refunds; compares to local Payment/Refund rows; no money mutation |
| F-007 | Resend email sender | `src/integrations/resend.ts` | Sole Resend SDK import; `createResendSender` |
| F-008 | Idempotent email dispatch | `src/features/email/server/dispatchEmail.ts` | Claim `SentEmail` before send; test mode captures without Resend |
| F-009 | Order triggered emails (outbox) | `src/features/email/server/orderEmails.ts`, `src/server/outbox.ts` | Confirmation, payment-link, refund-notice via Resend sender |
| F-010 | Campaign / mailing-list send | `src/features/email/server/campaignSend.ts` | Batched campaign dispatch honoring subscriber preferences |
| F-011 | Public email subscribe API | `src/app/api/subscribe/route.ts`, `src/features/email/server/upsertSubscriber.ts` | Rate-limited POST subscribe / resubscribe |
| F-012 | HMAC unsubscribe / preference API | `src/app/api/unsubscribe/route.ts`, `src/features/email/server/unsubscribeToken.ts` | Token via `UNSUBSCRIBE_HMAC_SECRET` |
| F-013 | Admin Resend test email | `src/features/settings/server/actions.ts` | `sendTestEmail` requires `RESEND_API_KEY` |
| F-014 | Cron auth (CRON_SECRET) | `src/server/verifyCronSecret.ts` | Bearer secret check for all cron routes |
| F-015 | Cron: payment reminders | `src/app/api/cron/payment-reminders/route.ts`, `vercel.json` | Daily 14:00 UTC; escalates reminders / auto-cancel unpaid |
| F-016 | Cron: outbox sweep | `src/app/api/cron/outbox-sweep/route.ts`, `src/server/outbox.ts`, `vercel.json` | Daily; retries pending outbox (email, geocode) with backoff |
| F-017 | Cron: pickup expiry | `src/app/api/cron/pickup-expiry/route.ts`, `vercel.json` | Daily; pickup reminder / expiry policy |
| F-018 | Cron: purge email & webhook logs | `src/app/api/cron/purge-email-log/route.ts`, `vercel.json` | Daily retention purge for EmailLog / SentEmail / ProcessedWebhookEvent |
| F-019 | Cron: Stripe reconcile | `src/app/api/cron/reconcile-stripe/route.ts`, `vercel.json` | Monthly (`0 6 1 * *`); wraps `runReconciliation` |
| F-020 | Shippo shipping API | `src/integrations/shippo.ts`, `src/features/shipping/server/shipmentActions.ts` | Rate, buy label, void, track, validate address; optional `SHIPPO_API_KEY` |
| F-021 | Mapbox geocoding | `src/integrations/mapbox.ts`, `src/features/shipping/server/geocodeRefresh.ts` | Geocode saved addresses (outbox); degrades if token missing |
| F-022 | Vercel Blob media storage | `src/app/api/media/route.ts`, `src/app/api/media/[id]/route.ts` | Staff upload (`put`) / delete (`del`) image blobs |
| F-023 | Clerk auth SDK boundary | `src/integrations/clerk.ts` | Sole `@clerk/nextjs/server` import; `getClerkAuth` / `getClerkUser` |
| F-024 | Address validate API (USPS not wired) | `src/app/api/addresses/validate/route.ts`, `.env.example` | Local ZIP/format check only; comments note future USPS; `USPS_USER_ID` env reserved unused |
| F-025 | Neon / Postgres via Prisma | `src/server/db.ts`, `.env.example` | `DATABASE_URL` (Neon PostgreSQL); required external datastore |

## Out of scope / not implemented as live integrations
- **UPS direct** (`UPS_*` in `.env.example` / `src/config/env-schema.ts`): env reserved; no UPS API client or call sites found.
- **Route-builder refresh-coords** (`src/app/api/route-builder/refresh-coords/route.ts`): placeholder count only; does not call Mapbox (geocode path is via outbox `geocodeRefresh` instead).
