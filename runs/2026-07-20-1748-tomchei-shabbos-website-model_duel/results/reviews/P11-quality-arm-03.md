# P11 Quality review — arm-03

Reviewer specialist: Quality. Findings only, no fixes. Blind to model identity.
Phase: P11 (Email & notification platform). Reference: `shared/phases/PHASE-P11-EXPECTED.md`.
Scope reviewed: `src/lib/notify/outbox.ts`, `src/lib/notify/sms.ts`, `src/lib/resend/client.ts`, `src/lib/email/campaigns.ts`, `src/lib/email/order-emails.ts`, `src/lib/email/templates.ts`, `src/lib/email/purge.ts`, `src/lib/cron/auth.ts`, `src/lib/cron/runs.ts`, `src/app/api/admin/email/route.ts`, `src/app/api/cron/outbox-sweep/route.ts`, `src/app/api/cron/purge-email-log/route.ts`, `src/app/api/cron/payment-reminder/route.ts`, `src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/season-auto-flip/route.ts`, `src/app/api/newsletter/subscribe/route.ts`, `src/app/api/newsletter/preferences/route.ts`, `src/app/api/newsletter/unsubscribe/route.ts`, `src/app/(admin)/admin/email/page.tsx`, `src/components/admin/email-hub.tsx`, `src/app/(storefront)/newsletter/page.tsx`, `src/app/(storefront)/newsletter/preferences/page.tsx`, `src/lib/storefront/newsletter.ts`, `src/lib/checkout/session.ts` (P11 touch point), `src/lib/payments/webhook.ts` (P11 touch point), `src/lib/ops/refunds.ts` (P11 touch point), `src/middleware.ts`, `prisma/schema.prisma` (P11 models), `prisma/migrations/20260722050000_p11_email/migration.sql`, `vercel.json`, `scripts/smoke-p11.mjs`, `arms/arm-03/results/PHASE-P11-SMOKE.md`, `arms/arm-03/results/PHASE-P11-STATUS.md`.

Smoke evidence (`PHASE-P11-SMOKE.md`) reports S1–S5 PASS (5/5). Findings below are from source inspection, not from re-running smoke.

## High

### H1 — P11 cron routes are POST-only; Vercel Cron invokes GET → 405 in production
`outbox-sweep/route.ts` and `purge-email-log/route.ts` export only `POST`. `vercel.json` registers both as cron jobs (`*/5 * * * *` and `0 4 * * *`). Vercel Cron invokes the path with GET. The contestant already knew this — `season-auto-flip/route.ts` carries the comment `/** Vercel Cron invokes GET; smoke/manual use POST. */` and exports both `GET` and `POST` — but the fix was applied only to `season-auto-flip`. `payment-reminder` and `pickup-expiry` are also POST-only (pre-existing from earlier phases, out of P11 scope), but the two P11 crons are the core of the outbox retry sweeper and log purge. In production both would 405 on every invocation; the outbox never drains and logs are never purged. Smoke S4 passes because it tests POST.

### H2 — Subscribers have no path to obtain a signed token; preferences/unsubscribe are unreachable
`mintUnsubscribeToken` (`src/lib/storefront/newsletter.ts:98`) is exported but never called anywhere in the workspace. The subscribe endpoint (`src/app/api/newsletter/subscribe/route.ts`) explicitly does not return a token (comment: `// Do not return unsubscribeToken — requires email verification path (H3).`). The preferences page (`src/app/(storefront)/newsletter/preferences/page.tsx`) reads the token from `?token=…` in the URL, and the unsubscribe route requires a token in the body. No email is sent on subscribe, no admin UI mints a token, and no verification flow exists. So a real subscriber cannot reach the preferences or unsubscribe flow. Smoke S1 passes only because `scripts/smoke-p11.mjs` mints the token directly with `NEWSLETTER_HMAC_SECRET` (line 27–31), bypassing the app entirely. The EXPECTED S1 ("change all three preference states via signed token") is satisfied at the API layer but not as a user-facing feature.

## Medium

### M1 — `ensureSystemTemplates` runs 3 upserts on every order email and every hub load
`enqueueOrderEmail` → `resolveTriggeredContent` → `ensureSystemTemplates` (`src/lib/email/order-emails.ts:102, 12`). `listTemplates` and `listTriggeredOverrides` also call it. So every order confirmation, payment link, and refund email triggers 3 `upsert` round trips (with `update: {}` no-op), and every time staff opens the Templates or Triggered tab the same 3 upserts run. The rows are immutable after first seed; the repeated upserts add latency and DB load for no benefit.

### M2 — `sendCampaign.resolveRecipients` with no list fetches all subscribers unbounded
`resolveRecipients` (`src/lib/email/campaigns.ts:111`) does `db.newsletterSubscriber.findMany({ where: { unsubscribedAt: null } })` with no `take`. A large list loads every row into memory. Unlike arm-01's silent 5,000 cap, there is no truncation here, but no pagination either — OOM risk under load. The campaign then loops recipients one-by-one with a per-recipient create+enqueue+update (no transaction, no batching).

### M3 — `processClaimedMessage` writes EmailLog and updates outbox in separate awaits (no transaction)
`processClaimedMessage` (`src/lib/notify/outbox.ts:306`) calls `deliverClaimed` (provider send), then `writeEmailLog`, then `db.notificationOutbox.update` as three separate awaits with no wrapping transaction. If the outbox update fails (DB hiccup), the email was already sent and logged, but the outbox row stays `CLAIMED`. After `CLAIM_STALE_MS` (2 min) another worker re-claims and re-delivers — double delivery. Same risk if the process crashes between the log write and the outbox update.

### M4 — Purge never deletes `NotificationOutbox` rows; outbox grows without bound
`purgeEmailLogs` (`src/lib/email/purge.ts:16`) deletes only `EmailLog` rows where `purgeAfter <= now` and the linked outbox is not active. It never deletes `NotificationOutbox` rows in any terminal state (`SENT`, `CAPTURED`, `FAILED`-exhausted). The schema comment on `NotificationOutbox` says "capture (test) or pending→claim→sent/failed", but terminal outbox rows are retained forever. The EXPECTED S5 intent ("Purge eligible logs without deleting active outbox/audit") is met for `EmailLog` but the outbox itself has no retention path.

### M5 — `purgeEmailLogs` loads all active outbox IDs into memory unbounded
`purgeEmailLogs` does `db.notificationOutbox.findMany({ where: { status: { in: [PENDING, CLAIMED, FAILED] } }, select: { id: true } })` with no `take` (`src/lib/email/purge.ts:18`). It builds an in-memory `Set` to filter eligible logs. A large active outbox loads every active ID into the Node process on every purge run.

### M6 — `finishCronRun` hardcodes `ok: true` regardless of sweep outcomes
Both cron routes call `finishCronRun(claim.run.id, { ok: true, meta: result })` (`outbox-sweep/route.ts:25`, `purge-email-log/route.ts:23`). `ok` is always `true` even when `sweepOutbox` returns `failed > 0` or `purgeEmailLogs` deletes nothing. `CronJobRun.ok` is therefore not a reliable signal of a healthy run; operators must parse `meta` to detect failures.

### M7 — `BRANDING_DEFAULT` and `EmailTemplate.branding` are write-only
`BRANDING_DEFAULT` (`src/lib/email/templates.ts:33`) is exported but never read. `upsertTemplate` stores `branding` into the column (`src/lib/email/order-emails.ts:49,56`), and the admin route passes it through (`api/admin/email/route.ts:183`), but `renderTemplate` never applies branding and `enqueueOrderEmail` never reads the `branding` field. The email hub Templates tab does not display or edit branding. Stored branding has zero effect on rendered output.

### M8 — Email hub UI is read-only for templates, triggered overrides, and list membership
The API supports `upsert_template`, `set_triggered`, and `add_list_members`, but `src/components/admin/email-hub.tsx` exposes none of them. The Templates tab lists `key / name / subject` only. The Triggered tab lists `key / defaults.subject / override.enabled` only — no toggle, no subject/body editor. The Lists tab has "Create list" but no "add members" control. The Campaign builder has no list selector, so every campaign broadcasts to all subscribers. Staff cannot manage templates, overrides, or list membership from the UI; the actions are API-only.

### M9 — `enqueueOrderEmail` is awaited inside checkout/refund/webhook and propagates DB errors
`checkout/session.ts:552` does `await enqueuePaymentLinkEmail(...)`, `payments/webhook.ts:275` does `await enqueueOrderConfirmation(...)`, `ops/refunds.ts:247` does `await enqueueRefundEmail(...)`. None inspect the returned `Result` (a returned `err` is silently ignored — fine), but a *thrown* DB error from `resolveTriggeredContent` or `enqueueNotification` propagates into the caller's try/catch. In `checkout/session.ts` the catch returns `err(...)` — so a DB hiccup in the email enqueue fails the checkout session creation. Email enqueue is best-effort in intent but blocking in implementation.

### M10 — `sweepOutbox` sequential loop can exceed the 2-minute stale claim threshold
`sweepOutbox` (`src/lib/notify/outbox.ts:381`) loops up to `limit` (40 in the cron) times, awaiting `claimOutboxMessage` + `processClaimedMessage` (which includes a live provider call) per iteration. `CLAIM_STALE_MS` is 2 minutes (`outbox.ts:18`). If 40 sequential provider sends exceed 2 minutes (slow Resend/Twilio, network stall), a parallel sweep can re-claim a still-in-flight row and double-deliver.

## Low

### L1 — `writeCronAudit` is dead code
`src/lib/cron/runs.ts:39` exports `writeCronAudit` but no caller exists in the workspace.

### L2 — `renderTemplate` silently blanks missing variables
`renderTemplate` (`src/lib/email/templates.ts:39`) substitutes `""` for any `{{key}}` not in `vars`. A refund email sent without `refundAmount` ships with a blank, no warning.

### L3 — `apiErrorResponse` doesn't translate Prisma P2025/P2003
`src/lib/api-error.ts` handles `AuthError`, `ApiError`, `ZodError`, else masks to 500. A PATCH on an unknown `template.key` or a `createCampaign` with a bad `listId` throws Prisma P2025/P2003 that surfaces as 500 instead of 4xx.

### L4 — Campaign "Send" has no confirmation or recipient-count preview
`EmailHub` "Send" button (`src/components/admin/email-hub.tsx:161`) queues the entire subscriber base on a single click with no confirm dialog and no recipient count shown.

### L5 — `claimOutboxMessage` ordering lacks a tiebreaker
`claimOutboxMessage` orders candidates by `createdAt: "asc"` only (`src/lib/notify/outbox.ts:249`). Rows sharing a timestamp may be claimed in nondeterministic order. Low impact given `SKIP LOCKED`-style updateMany correctness, but sweep ordering is non-reproducible.

### L6 — `captureNotification` writes no `EmailLog` while `enqueueNotification` capture mode does
`captureNotification` (`src/lib/notify/outbox.ts:20`, used by P9 `captureEmailAndSms`) creates a `NotificationOutbox` row and audit entry but no `EmailLog`. `enqueueNotification` with `forceCapture` or capture mode writes both. So P9 captured notifications are invisible in `EmailLog` and unreachable by purge, while P11 captured emails are logged. Inconsistent capture logging.

### L7 — `smsSend` mock mode returns no `captured` field → row marked `SENT`
`smsSend` mock branch (`src/lib/notify/sms.ts:37`) returns `{ ok: true, providerId }` without `captured`. `processClaimedMessage` then sets `NotifyStatus.SENT`. Mock email (`resend/client.ts:58`) returns `captured: true` → `CAPTURED`. So mock SMS is `SENT` and mock email is `CAPTURED` — inconsistent semantics for the same "no real provider" intent.

### L8 — Unsubscribe route verifies the token twice
`src/app/api/newsletter/unsubscribe/route.ts:16` calls `verifyUnsubscribeToken` for a pre-check, then `unsubscribeWithToken` (`src/lib/storefront/newsletter.ts:124`) verifies again internally. Wasted work; harmless.

### L9 — `updatePreferencesWithToken` doesn't rotate `tokenVersion`
`updatePreferencesWithToken` (`src/lib/storefront/newsletter.ts:102`) saves new preferences without incrementing `tokenVersion`. A leaked preferences token stays valid for the full 30-day TTL for preference changes (only unsubscribe rotates the version).

### L10 — `NotificationOutbox` schema default status is `CAPTURED`
`prisma/schema.prisma:1125` sets `@default(CAPTURED)`. A plain `create` without explicit status would be `CAPTURED` and therefore never swept. Misleading default given the outbox is primarily a pending-then-send queue.

### L11 — `EmailCampaignDelivery.status` is a free-form string with no sent/failed transition
`sendCampaign` sets delivery status to `"queued"` or `"captured"` only (`src/lib/email/campaigns.ts:165`). There is no `"sent"` or `"failed"` transition after the outbox row is processed. Delivery status never reflects actual send outcome; the outbox row is the only source of truth.

### L12 — `CronJobRun` has no reaper for stale rows
A cron that crashes after `beginCronRun` but before `finishCronRun` leaves a `CronJobRun` row with `ok: null` and no `finishedAt`. No reaper cleans them up; they accumulate. The unique `claimedToken` still lets new runs succeed, so this is clutter, not a blocker.

### L13 — `testSendCampaign` prefixes `[TEST]` only in live mode
`testSendCampaign` live branch prefixes the subject with `[TEST]` (`src/lib/email/campaigns.ts:83`); the capture branch stores the original subject in the log (`campaigns.ts:67`). The captured log and the live send disagree on subject for the same action.

### L14 — Subscribers tab fetches 200 rows with no pagination
`api/admin/email/route.ts:38` does `findMany({ take: 200 })` for the Subscribers tab. Beyond 200 subscribers, the UI silently shows a truncated list with no indication.

### L15 — `getEmailMode` "mock" and "capture" are identical for email
`resend/client.ts:50` (capture) and `resend/client.ts:58` (mock) both return `{ ok: true, captured: true, providerId }`. The two modes are indistinguishable for email, unlike SMS where mock returns no `captured` (see L7).

## Severity counts

- Critical: 0
- High: 2
- Medium: 10
- Low: 15
- Total: 27
