# P11 Rules Review — arm-01

Reviewer specialist: Rules. Blind to model name.
Scope: P11 changes under `arms/arm-01/workspace/` (email & notification platform — Resend integration, campaigns, transactional templates, outbox sweeper, purge cron, SMS dispatch).
Rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol` (per `arms/arm-01/ARM.md`). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 8 |
| Low | 8 |
| **Total** | **16** |

Strengths: messaging domain is split by concern (`messaging.ts` outbox/sweep, `resend.ts` provider, `sms.ts` provider, `delivery-notifications.ts` P9 reuse). Idempotency is enforced at the outbox via a unique `idempotencyKey` and `FOR UPDATE SKIP LOCKED` claiming — overlap and rerun are safe (smoke S2/S4 confirm). Cron auth uses `timingSafeEqual` with length check. Zod validates the admin email hub. Per-key template overrides are audited on PATCH. Test mode captures without contacting providers. Env additions are typed in `env.ts` and mirrored in `.env.example`; `resend` is pinned.

## Medium findings

### M1 — Three seeded templates are dead; delivery notifications bypass the template system (clean-code: dead code; consistency)
`src/domain/messaging.ts:62-81` seeds `delivery.day_of`, `pickup.ready`, `delivery.bulk`. Grep across `src/` finds no `templateKey` reference to any of them. `startDeliveryRoute` (`src/domain/delivery.ts:289-296`), `markPickupReady` (`delivery.ts:537-544`), and `scheduleBulkDelivery` (`delivery.ts:596-603`) all call `captureCustomerNotification`, which in `src/domain/delivery-notifications.ts:22-44` builds the body from `payload.type` split on `_` and enqueues a raw `enqueueMessage` with no `templateKey`. Customer-facing delivery emails are therefore not brandable, not overridable from the hub, and the three seeded rows are unreachable.

### M2 — Campaign marked SENT before any delivery (workflow: never silently choose business logic)
`src/domain/messaging.ts:221-241` — `queueCampaign` sets `status: "SENDING"`, enqueues outbox rows, then immediately sets `status: "SENT"` and `sentAt`. The outbox is delivered later by the cron sweeper; rows can still be PENDING or FAILED. The hub UI (`email-hub.tsx:164`) renders `SENT` as the campaign state, so a staff member sees "SENT" for a campaign whose emails have not left the system.

### M3 — Refund email idempotency key diverges between admin route and webhook (clean-code: consistency; data integrity)
Admin refund: `src/app/api/admin/orders/[orderId]/refunds/route.ts:91` uses `refund:${payment.id}:${payment.refundedCents}:${parsed.data.amountCents}`. Stripe webhook: `src/app/api/stripe/webhook/route.ts:148` uses `refund:${payment.id}:${payment.refundedCents}:${refundedCents - payment.refundedCents}`. The admin route creates a Stripe refund, which then fires `charge.refunded` → `processRefund` → a second refund email with a different key. The customer receives two refund emails for one refund.

### M4 — `ensureMessagingConfiguration` runs 10 upserts on every transactional send (ponytail: efficiency)
`src/domain/messaging.ts:179` — `enqueueTransactionalEmail` calls `ensureMessagingConfiguration` on every invocation, which `Promise.all`s 3 list + 7 template upserts. This fires inside `commitStripePayment`'s serializable transaction (`checkout.ts:311`), inside `processRefund`'s serializable transaction, and inside `sendPaymentReminders`' 500-order loop (`delivery.ts:633-655` → 5,000 no-op upserts). After first seed the upserts are no-ops but still hit the DB.

### M5 — Disabled template silently suppresses transactional email (workflow: never silently choose business logic)
`src/domain/messaging.ts:183` — `if (!template.isEnabled) return null;` with no audit row, no log, no caller signal. A staff member who toggles a template off in the hub suppresses order confirmations / refund emails with no record that the send was skipped. Callers treat `null` and a real enqueue the same.

### M6 — Campaign send silently caps at 5,000 subscribers (clean-code: magic values; workflow: silent business logic)
`src/domain/messaging.ts:219` — `take: 5_000` with no overflow signal. A list larger than 5,000 sends to the first 5,000 (by `email` asc) and reports `subscribers.length` as if complete. No error, no partial-send flag, no audit.

### M7 — Campaign enqueue is sequential per subscriber (ponytail: efficiency)
`src/domain/messaging.ts:225-237` — `for (const subscriber of subscribers) { await enqueueMessage(...) }`. 5,000 sequential awaited upserts on the request thread. `enqueueMessage` is independent per subscriber and could be batched / `Promise.all`'d in chunks.

### M8 — Two transaction patterns in the same module (clean-code: one pattern per concern)
`src/domain/messaging.ts:314` uses `prisma.$transaction(async (transaction) => …)` (interactive) in `recordSuccessfulDelivery`; `recordFailedDelivery` at line 366 uses `prisma.$transaction([…array])` (sequential). Both touch `messageOutbox` + `messageAttempt` for the same kind of write.

## Low findings

### L1 — Brand colors hardcoded inline in `brandedHtml` (clean-code: magic values; inline styles)
`src/domain/messaging.ts:91` — `#7a2434`, `#17231d`, `#66736c` inline in a template string. The rest of the app uses `--brand` / `--ink` / `--muted` CSS vars. Email HTML can't use CSS vars, but the palette should come from one brand constant, not three loose hex strings.

### L2 — `renderTemplate` silently drops missing variables (clean-code: error handling)
`src/domain/messaging.ts:85-88` — `variables[key] ?? ""`. A typo like `{{orderNumer}}` renders empty with no error, masking template bugs in production.

### L3 — Admin email route re-throws non-AccessDenied errors (clean-code: consistency)
`src/app/api/admin/email/route.ts:34-39` — `apiError` returns 403 for `AccessDeniedError` and re-throws everything else → 500. Sibling admin routes catch and return 400 with the message. Same pattern flagged P10 L4.

### L4 — Campaign create/test/send write no audit (clean-code: consistency)
`src/app/api/admin/email/route.ts:80-111` — `createCampaign`, `testCampaign`, `sendCampaign` produce no `auditLog` row; only template PATCH audits (`route.ts:166`). Campaign send is a high-stakes action and is the only one of the four unlogged.

### L5 — `nextAttemptAt` written on FAILED rows (clean-code: anti-AI-tics)
`src/domain/messaging.ts:372` — `recordFailedDelivery` sets `nextAttemptAt` even when `attempts >= 3` (status becomes FAILED). FAILED rows are never claimed (claim filters `status = 'PENDING'`), so the value is dead.

### L6 — `testRecipient` sent in `sendCampaign` payload (clean-code)
`src/components/email-hub.tsx:86` — `campaignAction` always includes `recipient: testRecipient`; the server ignores it for `sendCampaign`. Dead field on the wire.

### L7 — `APP_URL` used in code but absent from `.env.example` (workflow: security basics / env discipline)
`src/app/api/newsletter/subscribe/route.ts:31` and `src/domain/delivery.ts:652` read `process.env.APP_URL`. `.env.example` documents `EMAIL_TEST_MODE`, `RESEND_API_KEY`, etc., but not `APP_URL`. New setups fall back to `127.0.0.1:3101` silently.

### L8 — `EmailHub` `testTemplate` refresh overwrites unsaved template edits (clean-code: consistency)
`src/components/email-hub.tsx:107-120` — `testTemplate` calls `refreshHub()` on success, which `GET /api/admin/email` and overwrites local `templates` state. Any unsaved edits to other templates in the hub are lost. `saveTemplate` does not refresh (correct), but the two paths disagree on whether server state wins.

## Severity tally

- High: 0
- Medium: 8 (M1–M8)
- Low: 8 (L1–L8)
- Total: 16
