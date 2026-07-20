# P11 Quality review — arm-01

Reviewer specialist: Quality. Findings only, no fixes. Blind to model identity.
Phase: P11 (Email & notification platform). Reference: `shared/phases/PHASE-P11-EXPECTED.md`.
Scope reviewed: `src/domain/messaging.ts`, `src/lib/resend.ts`, `src/lib/sms.ts`, `src/lib/cron-auth.ts`, `src/app/api/cron/message-outbox/route.ts`, `src/app/api/cron/message-log-purge/route.ts`, `src/app/api/admin/email/route.ts`, `src/app/(admin)/admin/email/page.tsx`, `src/components/email-hub.tsx`, `src/domain/delivery-notifications.ts`, `src/domain/delivery.ts` (P11 touch points), `src/domain/checkout.ts` (P11 touch points), `src/app/api/stripe/webhook/route.ts`, `src/app/api/admin/orders/[orderId]/refunds/route.ts`, `prisma/migrations/20260721031500_p11_messaging/migration.sql`, `prisma/schema.prisma` (P11 models), `scripts/p11-smoke.ts`, `.scratch/PHASE-P11-SMOKE.md`, `.scratch/PHASE-P11-STATUS.md`.

Smoke evidence (`PHASE-P11-SMOKE.md`) reports S1–S5 PASS, `npm run smoke:p9` PASS, `npm run ci` exit 0, `npm run build` exit 0. Findings below are from source inspection, not from re-running smoke.

## High

### H1 — Delivery/pickup/bulk templates are seeded and editable but never rendered
`defaultTemplates` in `src/domain/messaging.ts` defines `delivery.day_of`, `pickup.ready`, and `delivery.bulk` (lines 62–82). They are upserted by `ensureMessagingConfiguration` and surface in the email hub (the hub lists every `emailTemplate` row and PATCH-saves overrides). However, no code path enqueues them: `startDeliveryRoute`, `markPickupReady`, and `scheduleBulkDelivery` instead call `captureCustomerNotification` (`src/domain/delivery-notifications.ts`), which synthesizes a raw `subject`/`htmlBody`/`textBody` from `payload.type` and bypasses `enqueueTransactionalEmail`, the template table, the `isEnabled` flag, and `brandedHtml`. Result: staff can edit `delivery.day_of` / `pickup.ready` / `delivery.bulk` subjects and bodies in the hub, the saves persist, but the actual delivery/pickup/bulk emails are unbranded and ignore those overrides entirely. The status doc’s claim that these events feed the templated outbox is only true for the outbox row, not for the template/override system.

### H2 — No lease/reaper for claimed outbox messages
`claimMessages` (`src/domain/messaging.ts:285`) flips `status` to `PROCESSING` and sets `lockedAt`/`lockedBy` but records no `lockedUntil`/lease, and the schema has no such column. There is no reaper that re-queues `PROCESSING` messages whose worker died mid-sweep. A process crash after claim, or a thrown error inside `recordFailedDelivery` (see M3), leaves the row locked in `PROCESSING` forever; it is never retried, never purged (purge only touches `SENT`/`CAPTURED` attempts), and never surfaced to operators.

## Medium

### M1 — `ensureMessagingConfiguration` runs on every transactional email
`enqueueTransactionalEmail` (`src/domain/messaging.ts:179`) calls `ensureMessagingConfiguration` before every enqueue. That is 3 list upserts + 7 template upserts (9 round trips) on every order confirmation, payment reminder, refund, and newsletter-preferences send — including inside the serializable transactions in `commitStripePayment` (`src/domain/checkout.ts:311`), the refunds route, and `processRefund` in the Stripe webhook. The extra upserts add lock surface (EmailList/EmailTemplate rows locked inside an already-serializable Order/Payment transaction) and per-event latency for no runtime benefit, since the rows are immutable after first seed.

### M2 — `queueCampaign` silently truncates at 5,000 recipients
`queueCampaign` (`src/domain/messaging.ts:216`) caps subscribers with `take: 5_000` and returns `subscribers.length`. A list larger than 5,000 silently skips the overflow; the hub reports `queued: 5000` with no warning, and the campaign is marked `SENT` as if complete. Operators have no signal that part of the list was excluded.

### M3 — `queueCampaign` is non-atomic across status transitions
`queueCampaign` sets the campaign to `SENDING`, enqueues per-subscriber messages in a plain `for` loop (no transaction), then sets `SENT` with `sentAt`. A crash or DB error mid-loop leaves the campaign stuck in `SENDING` with a partial outbox; there is no recovery path and no way to resume — a second `sendCampaign` is idempotent only for already-enqueued subscribers, so the truncated tail is never filled.

### M4 — `recordFailedDelivery` failure strands the message
`recordFailedDelivery` (`src/domain/messaging.ts:358`) uses the batch form `prisma.$transaction([...])`. If the `messageAttempt.create` violates the `[outboxId, attemptNumber]` unique constraint (e.g. concurrent retry race) or any statement errors, the transaction rolls back but the caller’s catch block has no further handler: the outbox row remains `PROCESSING` with `lockedAt`/`lockedBy` still set from `claimMessages`, and `nextAttemptAt` is never reset. Same stuck-state as H2.

### M5 — Purge never reclaims the outbox and never purges FAILED attempts
`purgeMessageLogs` (`src/domain/messaging.ts:457`) deletes `MessageAttempt` rows only where the outbox is `SENT` or `CAPTURED`, and deletes `NotificationCapture` rows by `sentAt`. It never deletes `MessageOutbox` rows in any state, and never deletes attempts for `FAILED` messages. The `MessageOutbox` table therefore grows without bound for every terminal state, and `FAILED` attempt logs are retained indefinitely while `SENT`/`CAPTURED` logs are purged — an inconsistent retention policy vs. the EXPECTED S5 intent of purging eligible logs.

### M6 — Smoke coverage gap on delivery/pickup/bulk and SMS failure
`scripts/p11-smoke.ts` S3 exercises only `order.confirmation`, `order.payment_link`, and `order.refund` via `enqueueTransactionalEmail`, and forces a Resend failure only for the email channel. The `delivery.day_of` / `pickup.ready` / `delivery.bulk` triggers are never exercised (consistent with H1 — there is no path to exercise them), and SMS provider failure/retry is not validated at the provider level. The retry/audit trail is thus proven only for one channel and three templates.

## Low

### L1 — Test escape hatch in production provider code
`src/lib/resend.ts:30` ships `RESEND_FORCE_FAILURE` in production source. `src/lib/sms.ts` has no equivalent, so SMS failure/retry cannot be exercised end-to-end the way email can.

### L2 — `isEmailTestMode()` gates SMS dispatch
`isEmailTestMode()` (`src/lib/resend.ts:22`) is consulted in `sweepMessageOutbox` for both email and SMS channels. The name is misleading — SMS provider calls are skipped under “email test mode” — and there is no independent SMS test-mode switch.

### L3 — Template rendering silently blanks missing variables
`renderTemplate` (`src/domain/messaging.ts:84`) substitutes `""` for any `{{key}}` not present in `variables`. A template referencing an omitted variable (e.g. a refund email sent without `refundAmount`) ships with a blank, no warning.

### L4 — Unknown key/listId returns 500
`apiError` in `src/app/api/admin/email/route.ts:34` only translates `AccessDeniedError`; a PATCH on an unknown `template.key` or a POST `createCampaign` with an unknown `emailListId` throws a Prisma P2025/P2003 that surfaces as a 500 instead of a 4xx.

### L5 — Campaign “Send” has no confirmation or dry-run count
`EmailHub.campaignAction("sendCampaign")` (`src/components/email-hub.tsx:79`) queues the entire list on a single click with no confirmation dialog and no recipient-count preview. A misclick enqueues up to 5,000 deliveries immediately (and, per M2, silently skips beyond 5,000).

### L6 — `brandedHtml` duplicates brand tokens
`brandedHtml` (`src/domain/messaging.ts:90`) hardcodes `#7a2434` and inline styles, diverging from the `brand` tokens used elsewhere; campaign and delivery-notification styling are not sourced from a single place.

### L7 — `claimMessages` order lacks a tiebreaker
`claimMessages` orders by `createdAt` only (`src/domain/messaging.ts:298`). Rows sharing a timestamp may be claimed in nondeterministic order. Low impact given `SKIP LOCKED` correctness, but makes sweep ordering non-reproducible.

## Severity counts

- Critical: 0
- High: 2
- Medium: 6
- Low: 7
- Total: 15
