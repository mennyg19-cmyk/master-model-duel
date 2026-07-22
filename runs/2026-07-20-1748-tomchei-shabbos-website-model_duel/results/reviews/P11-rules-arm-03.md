# P11 Rules Review — arm-03 (blind)

Reviewer: glm-5.2-high (external)
Phase: P11 — Email & notification platform
Workspace: `arms/arm-03/workspace`
EXPECTED: `shared/phases/PHASE-P11-EXPECTED.md`
Scope: protocol/rules compliance — ponytail ladder, clean-code discipline, workflow gates, inventory ID coverage (R-082..R-090, R-163, R-171, R-172, R-178, R-181, R-185, R-087, G-021).

Method: read `lib/email/*`, `lib/sms/provider.ts`, `lib/notifications.ts`, `lib/newsletter-token.ts`, `lib/cron.ts`, `lib/settings.ts`, `lib/env.ts`, `lib/orders/finalize.ts`, `lib/payments/post-payment.ts`, `lib/bulk-delivery.ts`, `lib/pickup.ts`, `lib/routes/service.ts`, all `app/api/cron/*`, `app/api/newsletter/*`, `app/api/admin/email/*`, `app/(admin)/admin/email/page.tsx`, `components/admin/email-hub.tsx`, `components/admin/settings/email-tab.tsx`, `components/storefront/preferences-form.tsx`, `prisma/schema.prisma` (Notification/NotificationAttempt/Campaign/EmailList/EmailTemplate/NewsletterSubscriber/CronRunLog), `vercel.json`, `tests/email-platform.test.ts`. Codegraph index re-synced (was stale on `src/` layout). Findings only — no fixes applied.

## Inventory ID coverage

| ID | Covered | Evidence |
|---|---|---|
| R-082 (email hub UI) | ✓ | `app/(admin)/admin/email/page.tsx`, `components/admin/email/email-hub.tsx` — campaigns/lists/subscribers/templates tabs behind `email.manage` |
| R-083 (campaign builder + send) | ✓ | `lib/email/campaigns.ts`, `app/api/admin/email/campaigns/*` |
| R-084 (named lists) | ✓ | `EmailList`/`EmailListMember` models, `app/api/admin/email/lists/*` |
| R-085 (idempotent rerun) | ✓ | `dedupeKey: campaign|${id}|${email}` in `sendCampaign` |
| R-086 (per-key template overrides) | ✓ | `lib/email/templates.ts` + `EmailTemplate` table |
| R-087 (transactional order emails) | ✓ | `lib/email/transactional.ts` — confirmation/payment_link/refund_notice |
| R-088 (outbox + retry sweeper) | ✓ | `lib/email/dispatch.ts`, `app/api/cron/notification-sweeper` |
| R-089 (preferences + signed tokens) | ✓ | `lib/newsletter-token.ts`, `app/api/newsletter/preferences`, `app/api/newsletter/unsubscribe` |
| R-090 (email test sender in settings) | ✓ | `app/api/admin/email/test`, `components/admin/settings/email-tab.tsx` |
| R-163 (CronRunLog per run) | ✓ | `lib/cron.ts` `runCronJob` |
| R-171 (Resend isolated in SDK module) | ✓ | `lib/email/provider.ts` — Resend never leaks past the file |
| R-172 (email-log purge cron) | ✓ | `app/api/cron/email-log-purge` |
| R-178 (test mode capture) | ✓ | `EMAIL_TEST_MODE` → capture provider in both email + sms |
| R-181 (conditional-UPDATE claiming) | ✓ | `sweepNotificationOutbox` claim on `(id + claimable state)` |
| R-185 (Vercel cron GET) | ✓ | every cron route exports `POST as GET` |
| G-021 (SMS dispatch, channel reuse) | ✓ | `lib/sms/provider.ts`, `notifyCustomer` wired in bulk-delivery/pickup/routes |

All targeted IDs have a concrete implementation. Findings below are quality/security issues found while reading that implementation, not missing IDs.

## Findings

| ID | Severity | Location | Claim | Suggested fix |
|---|---|---|---|---|
| F-01 | Medium | `lib/notifications.ts:62-77` `notifyCustomer` | SMS body reuses the email body verbatim. A transactional/campaign email body (multi-paragraph, with URLs and the preferences link) is sent as an SMS — real Twilio would split into many segments or fail length checks; the mock hides this. G-021 says "SMS dispatch module wired for P9 channel reuse" — reuse of the channel, not the email copy. | Give SMS its own short body (or truncate to ≤160 chars with no URL) at each `notifyCustomer` call site, or accept a separate `smsBody` field on the message. |
| F-02 | Medium | `app/api/admin/email/campaigns/[id]/route.ts:21` (GET preview) | `campaignAudience(campaign.listId)` runs `findMany` and loads every subscriber row (`id, email, name`) into memory just to return `audience.length`. For a list of thousands this is a full table scan + materialization on every preview click. | Use `db.newsletterSubscriber.count({ where: ... })` for the preview's `audienceCount`; keep `campaignAudience` for the send path only. |
| F-03 | Medium | `app/api/newsletter/preferences/route.ts:22-28` | `db.newsletterSubscriber.update(...).catch(() => null)` swallows every update failure, not just P2025 not-found. A DB connection error, unique-constraint violation, or any Prisma error is reported to the subscriber as "No subscription found for this address" (404) — real failures are hidden and mis-categorized. | Catch only `PrismaClientKnownRequestError` with `code === "P2025"`; rethrow everything else so the 500 path runs. |
| F-04 | Medium | `app/api/newsletter/unsubscribe/route.ts:18-23` | Same `.catch(() => null)` pattern with a comment claiming idempotency. A real DB failure is silently reported as `ok: true` — the subscriber thinks they're unsubscribed but the row never changed, and they keep receiving mail. This is a data-integrity silent failure on a trust-boundary action (CAN-SPAM). | Catch only P2025; let other errors throw → 500. Idempotency only justifies swallowing "row already gone", not "DB down". |
| F-05 | Low-Med | `lib/settings.ts:49-50` | `email.from_address` and `email.reply_to` are `z.string()` with no email-format validation. A manager can save "garbage" or an empty string as the from address and every outgoing email will fail at the provider (or be rejected by Resend), with no startup guard. The branding footer is similarly unbounded. | Use `z.string().email()` (or at minimum `.min(1)`) for the two address settings. |
| F-06 | Low-Med | `lib/email/campaigns.ts:62-73` `sendCampaign` | Per-recipient loop calls `captureNotification` (one DB insert) per subscriber, sequentially. For a large audience this is N round-trips with no batching. STATUS notes scale is P12, but the loop also holds nothing transactional — a crash mid-send leaves a partially queued campaign marked `SENT`. | Batch `db.notification.createMany` in chunks; or at least wrap the audience loop so a crash mid-send doesn't mark the campaign SENT. |
| F-07 | Low-Med | `app/api/admin/email/campaigns/[id]/test-send/route.ts` and `app/api/admin/email/test/route.ts` | Test-send creates a row with `status: "sending"` and calls `dispatchOne` directly. On provider failure `dispatchOne` flips the row to `pending` with backoff — so a failed test email stays in the outbox and the sweeper retries it for up to 5 attempts / ~80 minutes. A "test" email silently becoming a recurring retry is surprising for staff and pollutes the outbox counts. | Either mark test-send rows with a `kind` the sweeper skips on exhaustion, or set `MAX_ATTEMPTS=1` for test rows, or delete the row on failure. |
| F-08 | Low | `lib/sms/provider.ts:41-53` `mockSmsProvider` | Only handles `[failonce]`; no `[failalways]` hook. The email mock has both `+failonce` and `+failalways`. The SMS path can't exercise the exhausted-retry (5-attempt → `failed`) flow in mock mode — asymmetry with email means S3-style failure-trail coverage is email-only. | Add a `[failalways]` branch mirroring the email mock. |
| F-09 | Low | `lib/email/provider.ts:71-82` and `lib/sms/provider.ts:55-66` | Provider is module-memoized (`let provider: EmailProvider | null = null`). Mode is chosen once per process. The smoke has to restart the dev server to toggle `EMAIL_TEST_MODE` (documented in PHASE-P11-SMOKE.md). Any future in-process mode switch (e.g. a runtime "capture now" admin toggle) is impossible without a process restart. | Acceptable for now; record as a known constraint. If a runtime toggle is ever needed, expose a `resetEmailProvider()` test hook. |
| F-10 | Low | `app/api/admin/email/subscribers/route.ts:13` | `take: 200`, no cursor/offset. Subscribers beyond the newest 200 are invisible in the hub. Search by email helps, but a manager browsing "everyone" sees a truncated list with no indication it's truncated. | Add `count` total to the response and a "showing newest 200" note, or add offset pagination. |
| F-11 | Low | `lib/email/templates.ts:11-45` `TEMPLATE_DEFAULTS` | Defaults are kept WIN1252-safe (no arrows) per a comment, because the embedded dev Postgres client encoding is WIN1252. But the template override PATCH (`app/api/admin/email/templates/route.ts`) stores manager-supplied text with no charset check — a manager who pastes a Unicode arrow into an override breaks the dev DB write (and the comment doesn't warn them). Production UTF-8 Postgres is fine; dev is fragile. | Either fix the dev client encoding to UTF-8 (root cause), or validate override text is WIN1252-safe in dev mode, or at least note the constraint in the templates tab UI. |
| F-12 | Low | `lib/payments/post-payment.ts:144-159` `resolveStaffRefund` | `enqueueRefundEmail` is called outside any transaction with the `db.payment.update`. The dedupeKey (`refund|${stripeRefundId}`) makes a retry safe, but if the enqueue throws after the payment row is updated, the refund is recorded with no email queued and no automatic retry path — the customer gets a refund with no notice. | Wrap both writes in one transaction, or enqueue with the sweeper-retry semantics (capture into outbox, let sweeper deliver). |
| F-13 | Low | `lib/email/dispatch.ts:103` | `backoffMinutes` is computed even when `exhausted` is true (the value is then unused because the `failed` branch doesn't set `nextAttemptAt`). Dead computation — harmless but reads as "we schedule a backoff we never use." | Move the `backoffMinutes` line into the non-exhausted branch only. |
| F-14 | Low | `components/admin/settings/email-tab.tsx:89` | `Number(retention)` of empty/non-numeric input is `NaN`/`0`, sent to the settings PATCH which rejects it (schema `min(1)`). The user gets a generic error; the UI does no pre-validation and the input has no `type="number"` or `min`. | Use `<Input type="number" min={1}>` and disable Save when the parsed value isn't a positive int. |
| F-15 | Low | `app/api/admin/email/lists` | No DELETE route for lists and no DELETE for subscribers. Lists and subscribers can be created/added but never removed through the API. A misspelled list name lives forever (only the unique-name 409 stops duplicates). Out of scope for P11 EXPECTED but a gap vs. the "hub" framing in R-082. | Add `DELETE /api/admin/email/lists/[id]` (cascade members) and a subscriber delete, or document that removal is DB-only. |
| F-16 | Low | `tests/email-platform.test.ts` | Only 3 tests cover template rendering + `formatCents`. No unit test for the dispatch claim/backoff state machine, the dedupe-key collision path, or the token sign/verify tamper/expired branches (those run only in the smoke script `.scratch/p11-smoke.ts`, which isn't part of `npm run ci`). CI regression coverage for P11 core logic is thin. | Add unit tests for `verifyNewsletterToken` (tamper/expired/malformed), `captureNotification` P2002 dedupe, and `dispatchOne` attempt→backoff transitions so `npm run ci` catches regressions without the smoke harness. |

## Severity counts

- Medium: 4 (F-01, F-02, F-03, F-04)
- Low-Med: 2 (F-05, F-06, F-07 — counted as Low-Med)
- Low: 10 (F-08..F-16, excluding the Low-Med trio)

Using a 3-tier bucket (Medium / Low-Med / Low): **Medium 4 · Low-Med 3 · Low 9 → 16 findings.**

Using a strict 4-tier (High/Medium/Low-Med/Low): **High 0 · Medium 4 · Low-Med 3 · Low 9.**

No High-severity findings. No rule ID is missing. The phase's smoke evidence (34/34 in PHASE-P11-SMOKE.md) is consistent with what the code does; the findings above are quality/robustness gaps the smoke doesn't exercise.
