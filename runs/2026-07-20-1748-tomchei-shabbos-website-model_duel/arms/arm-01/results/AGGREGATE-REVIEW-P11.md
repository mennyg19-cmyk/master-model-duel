# P11 Aggregate Review — arm-01

**Phase:** P11 — Email & notification platform
**Scope:** `arms/arm-01/workspace/` P11 touch-points only.
**Inputs:** `P11-security-arm-01.md`, `P11-quality-arm-01.md`, `P11-rules-arm-01.md`, `P11-clean-code-arm-01.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker (security) | 0 |
| Major (High + Medium) | 24 |
| Minor (Low + Info) | 22 |
| **Total** | **46** |

Source roll-up before dedupe: Security 10, Quality 15, Rules 16, Clean-code 20 = 61 raw findings. 15 duplicates merged (see Dedupe notes).

No Critical/High security findings were raised by the security specialist, so no security blockers were promoted. Two Medium security findings (HTML injection in transactional emails; unauthenticated newsletter subscribe) are classified as majors below — they are the highest-priority fixes despite the "Medium" label.

## Blocker (security)

None.

## Major — High

### A-H1 — Three seeded templates are dead; delivery notifications bypass the template system
`src/domain/messaging.ts:62-81`; `src/domain/delivery-notifications.ts:22-44`
Sources: Q-H1, R-M1.

`delivery.day_of`, `pickup.ready`, `delivery.bulk` are seeded and editable in the email hub, but `startDeliveryRoute`, `markPickupReady`, and `scheduleBulkDelivery` call `captureCustomerNotification`, which synthesizes a raw `subject`/`htmlBody`/`textBody` from `payload.type` and bypasses `enqueueTransactionalEmail`, the template table, the `isEnabled` flag, and `brandedHtml`. Staff edits to those templates persist but never affect the actual delivery/pickup/bulk emails, which are unbranded. Violates EXPECTED P11 §1 (per-key overrides) and §3 (templated transactional flow).

### A-H2 — No lease/reaper for claimed outbox messages
`src/domain/messaging.ts:285` (claimMessages)
Sources: Q-H2.

`claimMessages` flips `status` to `PROCESSING` and sets `lockedAt`/`lockedBy` but records no lease (`lockedUntil`), and the schema has no such column. No reaper re-queues `PROCESSING` rows whose worker died mid-sweep. A crash after claim (or inside `recordFailedDelivery` — see A-M4) leaves the row locked in `PROCESSING` forever: never retried, never purged (purge only touches `SENT`/`CAPTURED`), never surfaced to operators.

### A-H3 — God file: `src/domain/messaging.ts` (486 lines, 5+ concerns)
Sources: CC-H1.

Mixed concerns: list/template seeding, message enqueue, transactional email rendering, campaign queueing, outbox claim/sweep/retry, delivery recording, cron-run tracking, log purge. Split by concern (`messaging-seed`, `messaging-templates`, `messaging-campaign`, `messaging-outbox`, `messaging-purge`).

### A-H4 — God file: `src/domain/delivery.ts` (657 lines, mixed concerns)
Sources: CC-H2.

Route creation, PIN access, stop delivery, fulfillment switching, geocoding, nearby search, pickup ready/stamp/expire, bulk delivery, **and** `sendPaymentReminders`. `sendPaymentReminders` (lines 633–657) is unrelated to delivery — wrong module. Move to a billing/messaging domain.

### A-H5 — Duplicated logic: refund-email enqueue (Rule of 2 → extract)
`src/app/api/admin/orders/[orderId]/refunds/route.ts:90-100`; `src/app/api/stripe/webhook/route.ts:147-157`
Sources: CC-H3. Cross-ref: A-M5 (idempotency-key divergence).

Two call sites build the same `order.refund` transactional email with near-identical idempotency keys and `refundAmount`/`orderNumber` variables. Extract a shared `enqueueRefundEmail(transaction, order, payment, amountCents)` helper.

### A-H6 — Duplicated data-fetch query
`src/app/(admin)/admin/email/page.tsx:11-32`; `src/app/api/admin/email/route.ts:45-67`
Sources: CC-H4.

Identical four-entity Prisma query (lists, templates, campaigns, recentMessages) with same `orderBy`/`take`/`select` in SSR page and API GET. Extract `loadEmailHubState(db)` and share.

## Major — Medium

### A-M1 — HTML injection in transactional email bodies (no variable escaping)
`src/domain/messaging.ts:84-92,184-186,231-233`
Sources: Sec-M1.

`renderTemplate` interpolates `variables` raw into `htmlBody`/`textBody` without HTML-escaping. `customerName` (Clerk/displayName) and `package.recipientName` (customer-entered at checkout) are user-controlled and land verbatim in branded HTML sent via Resend. Email clients won't run script, but tracking pixels, phishing links, and content spoofing inside branded transactional emails are achievable. Also affects `preferenceUrl`, `paymentUrl`, `refundAmount`, `pickupLocation`, `deliveryWindow`, `orderNumber`.

### A-M2 — Unauthenticated, unthrottled newsletter subscribe endpoint
`src/app/api/newsletter/subscribe/route.ts:7-38`; compare `src/lib/public-request.ts`
Sources: Sec-M2.

`POST /api/newsletter/subscribe` performs no auth and no rate limit (the `PublicRequestThrottle` helper used by checkout/drafts is not applied). Upserts any email and enqueues a preference email/capture each time. An attacker can enumerate/pollute the subscriber list, re-subscribe victims who unsubscribed (clearing `unsubscribedAt`), and generate large volumes of outbox rows / provider sends.

### A-M3 — `ensureMessagingConfiguration` runs on every transactional send
`src/domain/messaging.ts:179`
Sources: Q-M1, R-M4, CC-M8.

3 list upserts + 7 template upserts (10 round trips) on every order confirmation, payment reminder, refund, and newsletter-preferences send — including inside the serializable transactions in `commitStripePayment` (`checkout.ts:311`), the refunds route, `processRefund` in the Stripe webhook, and `sendPaymentReminders`' 500-order loop (5,000 no-op upserts). Adds lock surface (EmailList/EmailTemplate rows locked inside an already-serializable Order/Payment transaction) and per-event latency for no runtime benefit. Should run once at boot/seed.

### A-M4 — `queueCampaign` silently truncates at 5,000 recipients
`src/domain/messaging.ts:216-219`
Sources: Q-M2, R-M6. Cross-ref: A-L (magic numbers).

`take: 5_000` with no overflow signal. A list larger than 5,000 sends to the first 5,000 (by `email` asc) and reports `subscribers.length` as if complete. The hub reports `queued: 5000` with no warning; the campaign is marked `SENT` as if complete. Operators have no signal that part of the list was excluded.

### A-M5 — `queueCampaign` non-atomic across status transitions; marked SENT before delivery
`src/domain/messaging.ts:221-241`
Sources: Q-M3, R-M2, CC-M9.

Sets `SENDING`, enqueues per-subscriber messages in a plain `for` loop (no transaction), then immediately sets `SENT` and `sentAt`. The outbox is delivered later by the cron sweeper; rows can still be PENDING or FAILED. A crash or DB error mid-loop leaves the campaign stuck in `SENDING` with a partial outbox — no recovery path, no resume. The hub UI renders `SENT` for a campaign whose emails have not left the system.

### A-M6 — Refund email idempotency key diverges between admin route and webhook (double refund email)
`src/app/api/admin/orders/[orderId]/refunds/route.ts:91`; `src/app/api/stripe/webhook/route.ts:148`
Sources: R-M3. Cross-ref: A-H5 (extract helper).

Admin route uses `refund:${payment.id}:${payment.refundedCents}:${parsed.data.amountCents}`; webhook uses `refund:${payment.id}:${payment.refundedCents}:${refundedCents - payment.refundedCents}`. The admin route creates a Stripe refund, which fires `charge.refunded` → `processRefund` → a second refund email with a different key. The customer receives two refund emails for one refund.

### A-M7 — `recordFailedDelivery` failure strands the message
`src/domain/messaging.ts:358-376`
Sources: Q-M4. Cross-ref: A-H2 (no lease/reaper).

`recordFailedDelivery` uses the batch form `prisma.$transaction([...])`. If `messageAttempt.create` violates the `[outboxId, attemptNumber]` unique constraint (concurrent retry race) or any statement errors, the transaction rolls back but the caller's catch block has no further handler: the outbox row remains `PROCESSING` with `lockedAt`/`lockedBy` still set, and `nextAttemptAt` is never reset. Same stuck-state as A-H2.

### A-M8 — Purge never reclaims the outbox and never purges FAILED attempts
`src/domain/messaging.ts:457`
Sources: Q-M5.

`purgeMessageLogs` deletes `MessageAttempt` rows only where the outbox is `SENT` or `CAPTURED`, and deletes `NotificationCapture` rows by `sentAt`. It never deletes `MessageOutbox` rows in any state, and never deletes attempts for `FAILED` messages. The `MessageOutbox` table grows without bound for every terminal state; `FAILED` attempt logs are retained indefinitely while `SENT`/`CAPTURED` logs are purged — inconsistent retention vs. EXPECTED S5 intent.

### A-M9 — Smoke coverage gap on delivery/pickup/bulk and SMS failure
`scripts/p11-smoke.ts`
Sources: Q-M6.

S3 exercises only `order.confirmation`, `order.payment_link`, `order.refund` via `enqueueTransactionalEmail`, and forces a Resend failure only for the email channel. The `delivery.day_of` / `pickup.ready` / `delivery.bulk` triggers are never exercised (consistent with A-H1 — no path to exercise them), and SMS provider failure/retry is not validated at the provider level. Retry/audit trail proven only for one channel and three templates.

### A-M10 — Disabled template silently suppresses transactional email
`src/domain/messaging.ts:183`
Sources: R-M5.

`if (!template.isEnabled) return null;` with no audit row, no log, no caller signal. A staff member who toggles a template off in the hub suppresses order confirmations / refund emails with no record that the send was skipped. Callers treat `null` and a real enqueue the same.

### A-M11 — Campaign enqueue is unbounded and sequential per subscriber
`src/domain/messaging.ts:216-243`
Sources: R-M7, Sec-L6.

`queueCampaign` loads up to 5,000 subscribers and `await`s `enqueueMessage` sequentially inside the admin HTTP request. A large list will exceed the function timeout / hold a DB connection for the whole request — an availability risk for an admin-triggered operation. `enqueueMessage` is independent per subscriber and could be batched / `Promise.all`'d in chunks.

### A-M12 — Two transaction patterns in the same module
`src/domain/messaging.ts:314` (interactive) vs `:366` (batch array)
Sources: R-M8, CC-M2.

`recordSuccessfulDelivery` uses `prisma.$transaction(async (tx) => …)`; `recordFailedDelivery` uses `prisma.$transaction([...])`. Both touch `messageOutbox` + `messageAttempt` for the same kind of write. Pick one pattern per concern.

### A-M13 — Inconsistent error-handling pattern; admin email route re-throws → 500
`src/app/api/admin/email/route.ts:34-39`; `src/app/api/admin/orders/[orderId]/refunds/route.ts:107-112`
Sources: CC-M1, R-L3.

`apiError` returns 403 for `AccessDeniedError` and re-throws everything else → 500; the refunds route inlines the same `AccessDeniedError` → 403 check. A PATCH on an unknown `template.key` or a POST `createCampaign` with an unknown `emailListId` throws a Prisma P2025/P2003 that surfaces as 500 instead of 4xx. Two patterns for the same concern — pick the helper and apply everywhere.

### A-M14 — Magic numbers in `messaging.ts`
`src/domain/messaging.ts:219,364,372,394`
Sources: CC-M3. Cross-ref: A-M4 (5,000 cap).

`take: 5_000`, `limit ?? 100`, `attempts >= 3`, `2 ** attempts * 1_000` backoff are unnamed. Name them (`MAX_CAMPAIGN_RECIPIENTS`, `OUTBOX_SWEEP_BATCH`, `MAX_DELIVERY_ATTEMPTS`, `BACKOFF_BASE_MS`).

### A-M15 — Magic numbers in `delivery.ts`
`src/domain/delivery.ts:105,113,437,534,641`
Sources: CC-M4.

Geocode cache TTL `30 * 24 * 60 * 60 * 1000`, pickup expiry `14 * 24 * 60 * 60 * 1000`, payment-reminder `take: 500`, nearby-candidate `take: 200`. Some constants in this file are named (`routeLinkLifetimeMs`, `pinLockMs`, `nearbyMiles`); these aren't. Inconsistent.

### A-M16 — `subscriberFilter` duplicates `defaultLists` field names
`src/domain/messaging.ts:203-209`
Sources: CC-M5.

Hardcodes `productUpdates` / `volunteerStories` / `communityImpact` — the same three fields declared in `defaultLists` (lines 14–30) and the schema. Adding a list requires editing two places; the filter should derive from `defaultLists.preferenceField`. Type/schema drift risk.

### A-M17 — Type drift: `"EMAIL" | "SMS"` string union vs `MessageChannel` enum
`src/domain/delivery-notifications.ts:12,30`
Sources: CC-M6.

`input.channel: "EMAIL" | "SMS"` is converted via `MessageChannel[input.channel]`. Two representations of the same concept. Use `MessageChannel` directly at the API boundary.

### A-M18 — Type drift: loose `string` for enum fields in `email-hub.tsx`
`src/components/email-hub.tsx:18,25-27`
Sources: CC-M7.

`CampaignSummary.status: string`, `MessageSummary.channel: string` / `status: string` mirror Prisma `CampaignStatus` / `MessageChannel` / `MessageStatus` enums but are typed as bare strings — manual projection types that can drift from the schema. Use the generated enum types.

## Minor — Low

### A-L1 — Preference-token disclosure when `EMAIL_TEST_MODE=true`
`src/app/api/newsletter/subscribe/route.ts:34-37`; `src/lib/newsletter.ts:30-54`
Sources: Sec-L1.

When `EMAIL_TEST_MODE === "true"`, the subscribe response echoes the signed `preferenceToken`. Anyone subscribing an email they don't own in a test-mode deployment obtains a valid HMAC token granting read/PATCH access to that subscriber's preferences. Gated by an explicit env flag, but it is the same flag used for smoke/CI and is easy to leave on in preview.

### A-L2 — `isEmailTestMode()` silently captures in any non-prod env lacking `RESEND_API_KEY`
`src/lib/resend.ts:22-27`
Sources: Sec-L2. Cross-ref: A-L3 (SMS gating).

Returns true when `NODE_ENV !== "production" && !RESEND_API_KEY`. Staging/preview without a Resend key silently captures all sends instead of delivering, masking delivery failures and expanding the test-mode surface that A-L1 depends on.

### A-L3 — `isEmailTestMode()` gates SMS dispatch (misleading name)
`src/lib/resend.ts:22`; consulted in `sweepMessageOutbox`
Sources: Q-L2.

`isEmailTestMode()` is consulted for both email and SMS channels. The name is misleading — SMS provider calls are skipped under "email test mode" — and there is no independent SMS test-mode switch.

### A-L4 — User-supplied cron run-key can pre-claim future cron runs
`src/app/api/cron/message-outbox/route.ts:10-11`; `src/app/api/cron/message-log-purge/route.ts:17-18`; `src/domain/messaging.ts:426-428,462-463`
Sources: Sec-L3.

Both P11 cron routes use the `x-cron-run-key` header verbatim as the `CronRun.runKey` unique key. A caller holding `CRON_SECRET` can supply a runKey matching a future scheduled run to pre-create a row, causing that future invocation to no-op via the `priorRun` short-circuit. Requires the secret, so impact is limited to denial of scheduled work by an insider/leaked-secret holder.

### A-L5 — `RESEND_FORCE_FAILURE` test hook left in the delivery path
`src/lib/resend.ts:30-32`
Sources: Sec-L4, Q-L1.

`sendResendEmail` throws for every recipient when `RESEND_FORCE_FAILURE === "true"`. A test-only switch in the production code path; anyone with env-variable control can silently disable all email delivery (messages retry, then FAIL after 3 attempts). `src/lib/sms.ts` has no equivalent, so SMS failure/retry cannot be exercised end-to-end the way email can. The hook should not exist in shipped code.

### A-L6 — TOCTOU on `CronRun.runKey` lets concurrent cron calls 500
`src/domain/messaging.ts:426-431,462-466`
Sources: Sec-L5.

`runOutboxSweep` and `purgeMessageLogs` do `findUnique(runKey)` then `create` without a unique-constraint retry. Two overlapping cron invocations sharing the same default runKey both pass the check and both attempt insert; the second throws on the unique constraint and surfaces as a 500, even though the underlying sweep is idempotent via `FOR UPDATE SKIP LOCKED`.

### A-L7 — Template rendering silently blanks missing variables
`src/domain/messaging.ts:84-88`
Sources: Q-L3, R-L2.

`renderTemplate` substitutes `""` for any `{{key}}` not present in `variables`. A template referencing an omitted variable (e.g. a refund email sent without `refundAmount`, or a typo like `{{orderNumer}}`) ships with a blank, no warning — masking template bugs in production.

### A-L8 — Campaign "Send" has no confirmation or dry-run count
`src/components/email-hub.tsx:79`
Sources: Q-L5.

`EmailHub.campaignAction("sendCampaign")` queues the entire list on a single click with no confirmation dialog and no recipient-count preview. A misclick enqueues up to 5,000 deliveries immediately (and, per A-M4, silently skips beyond 5,000).

### A-L9 — `brandedHtml` duplicates brand tokens (hardcoded inline colors)
`src/domain/messaging.ts:90-91`
Sources: Q-L6, R-L1.

`brandedHtml` hardcodes `#7a2434`, `#17231d`, `#66736c` and inline styles, diverging from the `--brand` / `--ink` / `--muted` tokens used elsewhere. Email HTML can't use CSS vars, but the palette should come from one brand constant, not three loose hex strings. Campaign and delivery-notification styling are not sourced from a single place.

### A-L10 — `claimMessages` order lacks a tiebreaker
`src/domain/messaging.ts:298`
Sources: Q-L7.

Orders by `createdAt` only. Rows sharing a timestamp may be claimed in nondeterministic order. Low impact given `SKIP LOCKED` correctness, but makes sweep ordering non-reproducible.

### A-L11 — Campaign create/test/send write no audit
`src/app/api/admin/email/route.ts:80-111`
Sources: R-L4.

`createCampaign`, `testCampaign`, `sendCampaign` produce no `auditLog` row; only template PATCH audits (`route.ts:166`). Campaign send is a high-stakes action and is the only one of the four unlogged.

### A-L12 — `nextAttemptAt` written on FAILED rows
`src/domain/messaging.ts:372`
Sources: R-L5.

`recordFailedDelivery` sets `nextAttemptAt` even when `attempts >= 3` (status becomes FAILED). FAILED rows are never claimed (claim filters `status = 'PENDING'`), so the value is dead.

### A-L13 — `testRecipient` sent in `sendCampaign` payload (dead field on the wire)
`src/components/email-hub.tsx:86`
Sources: R-L6.

`campaignAction` always includes `recipient: testRecipient`; the server ignores it for `sendCampaign`.

### A-L14 — `APP_URL` used in code but absent from `.env.example`
`src/app/api/newsletter/subscribe/route.ts:31`; `src/domain/delivery.ts:652`
Sources: R-L7.

`.env.example` documents `EMAIL_TEST_MODE`, `RESEND_API_KEY`, etc., but not `APP_URL`. New setups fall back to `127.0.0.1:3101` silently.

### A-L15 — `EmailHub` `testTemplate` refresh overwrites unsaved template edits
`src/components/email-hub.tsx:107-120`
Sources: R-L8.

`testTemplate` calls `refreshHub()` on success, which `GET /api/admin/email` and overwrites local `templates` state. Any unsaved edits to other templates in the hub are lost. `saveTemplate` does not refresh (correct), but the two paths disagree on whether server state wins.

### A-L16 — Dead prop: `CampaignSummary.sentAt`
`src/components/email-hub.tsx:20`; `src/app/(admin)/admin/email/page.tsx:41`
Sources: CC-L1.

Declared and mapped but never rendered. Dead code across two files.

### A-L17 — Inconsistent projection between page and API
`src/app/(admin)/admin/email/page.tsx:22-30`; `src/app/api/admin/email/route.ts:56-65`
Sources: CC-L2.

The page's `messageOutbox.findMany` select omits `createdAt`; the API GET select includes it. Same entity, two projections, no shared selector — drift waiting to happen.

### A-L18 — `purgeMessageLogs` reuses `cronRun.claimed`/`succeeded` for purge counts
`src/domain/messaging.ts:480-481`
Sources: CC-L3.

Stores `attempts.count + captures.count` in both `claimed` and `succeeded`. `claimed` semantically means "claimed for processing"; reusing it for a delete count is schema/semantic drift on `CronRun`.

### A-L19 — `response.json()` parsed before `response.ok` check
`src/components/email-hub.tsx:51,74,88,103,117`
Sources: CC-L4.

`refreshHub`, `createCampaign`, `campaignAction`, `saveTemplate`, `testTemplate` all `await response.json()` unconditionally. A non-JSON error response (502 HTML, empty body) throws before the `ok` branch can set a status message. Parse defensively or check `ok` first.

### A-L20 — `testTransactional` idempotencyKey uses `Date.now()`
`src/app/api/admin/email/route.ts:117`
Sources: CC-L5.

`idempotencyKey: \`settings-test:${templateKey}:${Date.now()}\``. Each click produces a new key, so reruns are not idempotent (duplicates on retry). For a test sender this may be intentional, but it contradicts the P11 idempotent-rerun guarantee.

### A-L21 — Vague standalone names
`src/components/email-hub.tsx:46` (`message`); `src/domain/delivery.ts:12` (`hash`)
Sources: CC-L6.

`message` is a status banner, not a message entity — prefer `statusMessage`. `hash` is a generic SHA-256 helper alongside the specific `pinHash` — name it `sha256Hex` or similar.

### A-L22 — Redundant field in `enqueueMessage` create
`src/domain/messaging.ts:139-142`
Sources: CC-L7.

Spreads `...input` then re-sets `recipient: input.recipient` explicitly. `recipient` is already part of `input`; the explicit line is redundant.

## Minor — Informational

### A-I1 — `lastError` from provider responses stored and surfaced to admins
`src/domain/messaging.ts:364-376`; `src/components/email-hub.tsx:239`
Sources: Sec-I1.

`recordFailedDelivery` stores `error.message` (including Resend error text) into `MessageOutbox.lastError` and `MessageAttempt.errorMessage`, rendered in the admin email hub. Admin-only, but provider error text can include request details; acceptable but worth noting.

### A-I2 — Admin-authored campaign/template HTML sent unescaped to recipients
`src/app/api/admin/email/route.ts:74-179`; `src/domain/messaging.ts:232-233`
Sources: Sec-I2.

By design the email hub lets `settings:manage` staff author raw `htmlBody` for campaigns and templates. This is the expected email-builder trust boundary, but a compromised or low-trust admin can send arbitrary HTML (including phishing markup) through the org's Resend identity to any list. No approval/preview gate beyond test-send.

## Dedupe notes

Merged duplicates (location+claim):
- A-H1 ← Q-H1 + R-M1 (dead delivery/pickup/bulk templates)
- A-M3 ← Q-M1 + R-M4 + CC-M8 (ensureMessagingConfiguration on every send)
- A-M4 ← Q-M2 + R-M6 (5,000 silent cap; CC-M3's `5_000` magic-value note folded into A-M14)
- A-M5 ← Q-M3 + R-M2 + CC-M9 (queueCampaign non-atomic / SENT-before-delivery)
- A-M11 ← R-M7 + Sec-L6 (campaign enqueue loop: sequential + unbounded)
- A-M12 ← R-M8 + CC-M2 (two transaction patterns)
- A-M13 ← CC-M1 + R-L3 (inconsistent error handling / re-throws → 500)
- A-L5 ← Sec-L4 + Q-L1 (RESEND_FORCE_FAILURE test hook)
- A-L7 ← Q-L3 + R-L2 (renderTemplate blanks missing variables)
- A-L9 ← Q-L6 + R-L1 (brandedHtml hardcoded brand colors)
- A-H5 and A-M6 kept separate: same refund-email code region but distinct claims (code duplication → extract helper vs idempotency-key divergence → double email bug). Cross-referenced.

No new findings introduced during aggregation.

## Notes (no findings, from specialists)

- Cron auth (`isAuthorizedCronRequest`) is fail-closed when `CRON_SECRET` is unset and uses `timingSafeEqual`. Correct.
- Newsletter preference token is HMAC-SHA256 with 30-day expiry, `timingSafeEqual` signature check, rejects extra `.` segments. Solid; no IDOR on preference PATCH (token-bound).
- Outbox claim uses parameterized `Prisma.sql` with `FOR UPDATE SKIP LOCKED` — no SQL injection, correct overlap handling at the message level.
- `requirePermission("settings:manage")` / `payments:manage` guards present on all admin email and refund routes; refund route writes audit log.
- `.env.example` and `generate-env-example.mjs` contain only placeholder values; no real secrets committed.
- `resend` dependency pinned exactly (`6.17.2`).
- No narration/change-explanation comments in P11 code — comment quality is clean.
- Email hub reuses the existing eyebrow + `text-4xl font-black` H1 + `bg-white` card pattern from `settings-hub.tsx` — consistent.
