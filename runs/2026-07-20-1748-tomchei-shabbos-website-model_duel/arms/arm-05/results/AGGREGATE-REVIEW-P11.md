# P11 Aggregate Review — arm-05 (blind)

Phase P11. Counts: blocker 1, major 21, minor 17, nit 2, total 41.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 21 |
| Minor | 17 |
| Nit | 2 |
| Total | 41 |

Raw input totals: security 13, quality 15, rules 9, clean-code 14 = 51 findings -> 41 after dedupe (10 duplicates merged across 8 clusters).

Source tags: [S] security, [Q] quality, [R] rules, [C] clean-code.

Severity mapping: Critical/High-security -> blocker; High/Medium -> major; Low -> minor; Info/Nit -> nit.

---

## Prioritized fix list (single pass)

### Blocker - preference-token crypto

1. **Unsubscribe token is a long-lived, single-secret HMAC with no key versioning and no per-operation scoping** [S] - `lib/newsletter.ts:6,19-56,37-40`; `app/api/newsletter/confirm/route.ts:10-12`
   - A single `NEWSLETTER_TOKEN_SECRET` signs every preference/unsubscribe token with a 30-day lifetime, no key id, no audience binding; the same token authorizes read (GET), update (PATCH), and unsubscribe (DELETE). Rotating the secret invalidates every outstanding link; not rotating leaves a 30-day window during which any forwarded/leaked link is a full capability. The confirmation flow mints a fresh unsubscribe token and redirects to `/unsubscribe?token=...` in plaintext over GET, so the capability URL lands in browser history, referrers, and any forwarded confirmation email. `signingSecret()` throws if the secret is unset and `readUnsubscribeToken` does not wrap that call in its try/catch, so a missing secret turns every token check into an unhandled 500. Introduce key ids + audience binding (or split read/update/unsubscribe scopes), shorten lifetime, and fail closed on missing secret.

### Major - confirmation flow abuse

2. **Confirmation token never expires and `subscribe()` resets confirmed/unsubscribed state for any known email** [S] - `lib/newsletter.ts:58-71,105-116`; `app/api/newsletter/route.ts:47-60`
   - The confirmation token is a 32-byte random with a sha256 hash store and no expiry field — once issued it is valid until consumed. Separately, `POST /api/newsletter` calls `subscribe()` which, for an existing subscriber, overwrites `confirmationTokenHash`, nulls `confirmedAt`, and nulls `unsubscribedAt`. An attacker who only knows a victim's email can repeatedly reset their subscription state and force new confirmation emails; the only throttle is a per-IP rate limit trivially bypassed from multiple IPs. Add a `confirmationTokenExpiresAt` column + check, and stop wiping confirmation/unsubscribe state on every subscribe call.

3. **`EMAIL_TEST_MODE=true` in production silently captures all customer email instead of sending, with no guard** [S] - `lib/email.ts:29-31,114-120`; `.env.example:12`
   - `isTestCaptureEnabled()` returns true whenever `EMAIL_TEST_MODE === "true"` regardless of `NODE_ENV`. If an operator flips it to `true` in production (one character from the shipped `"false"`), every order confirmation, payment link, refund, and campaign send is recorded as `DELIVERED` with `provider: "test-capture"` and no real email leaves the system. Customers never receive payment links; staff see green delivery logs. Add a startup assertion that production forbids `EMAIL_TEST_MODE=true` (or scope the flag to non-production only).

### Major - test-send exfiltration + outbox races

4. **Campaign test-send and platform test-send accept any external recipient with no allowlist** [S] - `app/api/admin/email/route.ts:19,22,52-55,62-65`; `lib/email.ts:103-112,237-247`
   - A staff member with `settings.manage` can use `test_campaign` or `test_email` to send arbitrary campaign bodies (which may contain customer PII, donor references, or unreleased content) to any RFC-5321 address they choose. There is no domain allowlist, no recipient confirmation, and no audit event for test sends. This is an exfiltration / content-spray primitive behind a generic settings permission. Add a recipient allowlist and write an `AuditEvent` for test sends.

5. **Outbox DELIVERED transition is not guarded by `status: "PROCESSING"`, enabling a duplicate-delivery race after the 10-minute stale reset** [S] - `lib/email.ts:122-176`
   - The claim step correctly uses `updateMany WHERE status="PENDING"` for atomic claiming, but the post-send DELIVERED update has no `status` guard. If a sweeper stalls >10 minutes during a provider call, the stale-reset flips the row back to `PENDING`, a second sweeper claims and sends it, and the stalled sweeper then completes its unguarded DELIVERED update — producing two real deliveries and two `EmailLog` rows for one outbox row. Smoke S4 only proves two concurrent sweeps don't double-claim a fresh row; it does not exercise the stale-reset + slow-sender path. Guard the DELIVERED update with `status: "PROCESSING"`.

6. **Confirmation token and recipient email can leak into server logs via uncaught `console.error`** [S] - `app/api/newsletter/route.ts:52-58`; `lib/newsletter.ts:73-103`
   - The subscribe route logs the raw error from `deliverSubscriptionConfirmation` with `console.error("Newsletter confirmation delivery failed.", error)`. That function builds `confirmationUri` containing the raw `confirmationToken` and, when the webhook path fails, throws after the fetch — the error object can carry the URL and the recipient email into stdout/observability. Anyone with log read access can then confirm the subscription (the confirmation token never expires — see #2). Redact the URL/email from the logged error.

### Major - sendCampaign atomicity / SENT guard / audit (cluster)

7. **`sendCampaign` is not atomic, marks `SENT` unconditionally, has no DRAFT guard, and writes no audit event** [S][Q][R][C] - `lib/email.ts:205-235`; `app/api/admin/email/route.ts:46-51`
   - Merged from security L1 + quality M5 + rules M2 + clean-code F13. Four gaps in `sendCampaign`: (a) no `prisma.$transaction` wraps the subscriber loop — a crash after queueing some emails but before the final update leaves the campaign in `DRAFT` with emails already in the outbox; (b) `prisma.emailCampaign.update({ ... data: { status: "SENT" } })` runs unconditionally even when `queued === 0` (all subscribers unsubscribed/marketing-opt-out) — a campaign with zero deliveries shows `SENT`, a silent misleading business outcome; (c) no check that the campaign is still `DRAFT` before sending — a SENT campaign can be re-sent (see #8); (d) no `AuditEvent` is written for `send_campaign`, `test_campaign`, `test_email`, or `update_template` — the admin layout banner claims "changes to orders, payments, and imports are audited" but email is the one admin mutation surface with no audit row, inconsistent within the same module (`purgeEmailLogs` is the only email action that writes an `AuditEvent`). Wrap the loop in a transaction, gate the SENT flip on `queued > 0` and `DRAFT` status, and write audit rows for all email mutations.

### Major - campaign re-send + dedupe semantics

8. **Re-sending a SENT campaign silently queues newly-confirmed subscribers; refund emails collapse to one per order** [Q][R] - `lib/email.ts:207-233,85`; `app/api/admin/email/route.ts:25`
   - Merged from quality M6 + rules M1. (a) `sendCampaign` re-iterates all currently confirmed, non-unsubscribed subscribers on every call with no `status === "SENT"` short-circuit. A subscriber who confirmed after the first send gets queued on the rerun, with no operator signal that the campaign was already sent or that new recipients were added. The smoke only verifies the original subscriber's counts; it does not cover late-joiner behavior. (b) `queueOrderLifecycleEmail` dedupeKey for `REFUND` is always suffixed `current`, so every refund email for one order shares one dedupeKey. A customer who gets a partial refund then a full refund (two `charge.refunded` webhook events) receives only the first email; the second `queueOrderLifecycleEmail` call is silently dropped. No `DECISION-LOG.md` records either choice. Add a SENT short-circuit (or a "new-subscriber-only" rerun mode), and vary the REFUND dedupeKey by refund event id.

### Major - outbox retry / recovery

9. **Stale-claim recovery exhausts retries without a real failure (double-counts attempts)** [Q][R] - `lib/email.ts:124-127,137-141`
   - Merged from quality M1 + rules L4. A crashed worker leaves an outbox row in `PROCESSING`. The next sweep resets it to `PENDING` but `attemptCount` (incremented at claim time) is never decremented. One stalled instance therefore burns 2 attempts. After `MAX_OUTBOX_ATTEMPTS = 3` the message is `FAILED` even if the provider never actually returned an error — only the instance died. This is a known trade-off of claim-based sweepers, but the double-count is not documented in code, README, or a DECISION-LOG entry, and smoke S4 does not cover the stale-claim-recovery path. Either decrement `attemptCount` on stale reset, or distinguish claim-crash from provider-failure in the counter, and document the choice.

10. **Permanently FAILED outbox messages can never be re-queued; no admin recovery path** [Q][R] - `lib/email.ts:59-64,162`; `app/admin/settings/page.tsx` (email section)
    - Merged from quality M2 + rules M3. `queueEmail` upserts on `dedupeKey` with `update: {}`. Once a row exists for a dedupeKey — including a `FAILED` one — re-triggering the domain event is a silent no-op. The sweeper retries up to `MAX_OUTBOX_ATTEMPTS = 3` then sets `status: "FAILED"` with `lastError`; the settings UI has no "retry failed" control (only `send_campaign`, `test_campaign`, `create_list`, `add_list_member`, `test_email`, `update_template`, `sweep`). A refund email that fails 3 times (provider outage) is silently lost with no surfaced recovery; `lastError` is recorded but never shown to staff. The plan's merge boundary says "all required messaging is decoupled from provider outages" — a permanently failed message is not decoupled, it is dropped. Add a retry-failed admin action and a non-empty `update` (or status reset) path for FAILED rows.

### Major - retention / PII

11. **`EmailOutbox` rows (recipient, subject, html, payment link) are never purged; only `EmailLog` is** [S][Q] - `lib/email.ts:178-187`; `prisma/migrations/20260728012000_p11_email_platform/migration.sql:52-69`
    - Merged from security M3 + quality L6. `purgeEmailLogs` deletes only `EmailLog` rows whose outbox is in a terminal state. The `EmailOutbox` row itself — which stores `recipient`, `subject`, full `html` body, and a `payload` referencing `orderId`/`campaignId`/`subscriberId` — is retained indefinitely. For `PAYMENT_LINK` messages the `html` contains the Stripe Checkout URL with the session id. There is no retention cron, no PII redaction, and no plan item addressing outbox retention. `vercel.json` registers only `email-log-purge`; no outbox purge cron exists. At 5k-package scale with retries this is unbounded table growth in the outbox plus a PII store with no retention. Add an outbox purge cron (or redact html/recipient after terminal state) with a documented retention policy.

12. **Log purge deletes FAILED failure trails after 30 days; `AuditEvent` records only an aggregate count** [Q] - `lib/email.ts:178-187`
    - EXPECTED S5 says "Purge eligible logs without deleting active outbox records or audit evidence," and S3 requires an "auditable failure trail." The purge deletes `EmailLog` rows for any outbox with status in `["DELIVERED", "FAILED"]` older than the cutoff. The `AuditEvent` row records only an aggregate count (`email.logs_purged` with `deleted`), not the per-message failure detail. After 30 days, the only auditable failure trail for a permanently-failed message is gone. Either retain FAILED logs longer than DELIVERED, or capture per-message failure detail into the audit row.

### Major - template / branding / SMS

13. **Template `branding` is stored but never applied to rendered email** [Q] - `lib/email.ts:25-27,80-88`; `prisma/schema.prisma` `EmailTemplate.branding` (line 242)
    - The EXPECTED P11 §1.1 calls for "templates + branding." `branding` is persisted and shown in the settings UI ("custom branding" vs "default branding"), but `replaceTemplateVariables` only substitutes `{{key}}` placeholders in subject/body. No code reads `template.branding` during rendering. Branding has no effect on the delivered email. The settings page advertises state to the operator that the system ignores. Either apply branding during render or remove the field.

14. **SMS dispatch is capture-only with no provider seam, test toggle, or retry** [Q] - `lib/sms.ts:12-18`; `lib/delivery.ts:106`
    - EXPECTED P11 §4 calls for "SMS dispatch module wired for P9 notification channel reuse (G-021)." `dispatchSms` writes a `DeliveryNotification` row with `channel: "SMS"` and returns. There is no provider call, no `SMS_TEST_MODE` toggle (unlike email's `EMAIL_TEST_MODE`), no outbox, and no retry. When a provider is later confirmed (open question 1), there is no dispatch path to wire it into without rewriting the function. P9 callers route through `captureNotification` which only invokes `dispatchSms` for `channel === "SMS"`, and no P9 caller passes that channel (see #28). Build the seam (provider adapter + test toggle + retry) or document that SMS is out of scope.

### Major - admin test-send side effects (cluster)

15. **Admin test-send sweeps the entire outbox as a side effect; test-send dedupe makes repeat tests a silent no-op** [Q][C] - `app/api/admin/email/route.ts:52-55,62-65`; `lib/email.ts:103-112,237-247`
    - Merged from quality M4 + clean-code F14. After queueing a test message, the handler calls `sweepEmailOutbox()` inline and returns the sweep result. An operator clicking "Test-send" or "Send platform test" triggers delivery of every other pending outbox row, not just the test message — coupling unrelated deliveries to a manual click and masking the test result behind a batch summary. The sweep is also exposed as its own explicit action (`route.ts:30,69`); three entry points trigger the same sweeper from one route. Separately, `testSendCampaign` dedupeKey is `campaign:test:${campaignId}:${recipient}` and `sendTestEmail` is `email-platform-test:${recipient}`; both use `queueEmail`'s `update: {}` upsert, so an operator who test-sends to the same recipient twice gets a "Test email captured" success message for the second call even though no new outbox row was created. Test-send should queue and let the cron or an explicit sweep handle delivery; surface the actual insert count.

### Major - clean-code structure / type drift

16. **`EmailLog.status` is a plain String while siblings use Postgres enums** [Q][C] - `prisma/schema.prisma:298`; `prisma/migrations/20260728012000_p11_email_platform/migration.sql:74`
    - Merged from quality L2 + clean-code F1. `EmailOutboxStatus` and `EmailCampaignStatus` are Postgres enums, but `EmailLog.status` is plain `TEXT`. `lib/email.ts:151,169` writes the string literals `"DELIVERED"` and `"FAILED"` untyped — no compile-time guard against a typo the enum would have caught. The log table is the audit trail of the outbox table; they should share a status vocabulary. Use the enum (or a shared string-literal union with a CHECK constraint).

17. **`emailHub()` lazy-seeds templates on every GET (write-on-read); lifecycle queue upserts the template on every send** [R][C] - `lib/email.ts:249-250,38-45,77`; `app/api/admin/email/route.ts:33-36`
    - Merged from rules L2 + clean-code F6. `emailHub()` calls `ensureDefaultEmailTemplates()` — which fires three `upsert` writes against `EmailTemplate` — on every `GET /api/admin/email`. The upserts are idempotent but every hub load issues three write-capable queries against the DB. The same pattern repeats per lifecycle email: `queueOrderLifecycleEmail` -> `templateFor` -> `upsert` on every queue. At 5k orders the template table is re-upserted 5k times for nothing. REST hygiene: GET should not mutate. Seeding defaults belongs in a migration or a one-time bootstrap, not a per-request upsert.

18. **Mixed concerns in `lib/email.ts` (god-file candidate, 7 concerns)** [C] - `lib/email.ts` (259 lines)
    - The clean-code rule "split files by concern, not by line count" triggers on mixed concerns even under 500 lines. `lib/email.ts` owns: (a) transactional template defaults + variable substitution; (b) outbox queue + sweeper + retry; (c) log retention/purge; (d) subscriber lists; (e) campaigns + campaign delivery dedupe; (f) the admin hub aggregator; (g) the test sender. These are separable concerns that the plan itself lists as distinct deliverables (R-082..R-090). A split along `lib/email/{templates,outbox,lists,campaigns,hub}.ts` would let each concern be read independently.

19. **Test-fixture branch shipped in production code path** [C] - `lib/email.ts:33-36,115-117`
    - The anti-AI-tics rule bans "just in case code — every line must have a reason." `hasForcedFixtureFailure` reads `payload.testFailureOnce === true` and throws a synthetic provider failure purely to exercise the retry path in smoke. This is test-only logic living in the production outbox sender. The smoke script sets `payload: { testFailureOnce: true }` to exercise it; production callers never set this key, so the branch is dead in any non-test path. Either gate it behind `EMAIL_TEST_MODE` or move the failure injection into the test harness.

20. **Duplicated notification-write logic between `captureNotification` and `dispatchSms`** [C] - `lib/delivery.ts:98-112`; `lib/sms.ts:12-18`
    - Both functions write to `prisma.deliveryNotification` with the same idempotent-upsert shape. `captureNotification` branches: if `channel === "SMS"` it delegates to `dispatchSms` (which hardcodes `channel: "SMS"` and ignores `input.channel`); otherwise it inlines the same upsert using `input.channel`. Two code paths, one table, slightly different field handling — the SMS branch silently drops `input.channel` (always becomes `"SMS"`); the inline branch trusts it. One helper should own the write.

21. **Sequential `await` in a for-loop over potentially 5k subscribers** [C] - `lib/email.ts:215-232`
    - `sendCampaign` iterates subscribers with `await` inside a `for` loop, queueing one by one. The plan's non-functional baseline is 1,000+ orders / 5,000+ packages / 10 concurrent staff (G-024). A campaign to all confirmed subscribers at that scale serializes 5k DB upserts + 5k outbox upserts. The outbox sweeper itself uses a bounded batch (`outboxBatchSize = 25`), so the pattern exists in the same file — just not applied here. Batch or parallelise the per-subscriber queue.

### Minor - security / data integrity

22. **Campaign send, template edit, and platform test-send share one permission (`settings.manage`)** [S] - `app/api/admin/email/route.ts:33-73`
    - All email-hub mutations — including mass campaign send to every confirmed subscriber and template body edits that affect all future transactional mail — sit behind a single `settings.manage` permission. There is no separate capability for "send to all" vs "edit templates" vs "send a test", so any staff granted settings management gets full blast-capability over customer email. No finer permission exists in `lib/permissions.ts` for email operations. Split the permission (e.g., `email.send_campaign`, `email.edit_template`, `email.test_send`).

23. **Cron routes accept POST with no CSRF protection alongside the bearer secret** [S] - `app/api/cron/email-outbox/route.ts:11`; `app/api/cron/email-log-purge/route.ts:11`; `app/api/cron/pickup-expiry/route.ts:11`; `app/api/cron/payment-reminders/route.ts:11`; `app/api/cron/season-auto-flip/route.ts:11`
    - Every cron handler aliases `POST = GET`. Vercel Cron calls GET; the POST surface adds nothing functional but means a browser-initiated cross-site POST with the bearer secret in a header is the only thing standing between an attacker and cron invocation. The bearer is not deliverable by a browser without custom JS, so the practical risk is low, but the POST surface is unnecessary attack surface. Drop the POST export.

24. **`authorizeCron` parses the `Bearer ` prefix case-sensitively** [S] - `lib/cron-auth.ts:6`
    - `request.headers.get("authorization")?.replace(/^Bearer /, "")` only strips a capitalized `Bearer `. RFC 7235 makes the scheme case-insensitive; a caller sending `bearer <secret>` is rejected. Not a security hole (fail-closed), but a fragility that could mask a misconfigured cron caller as a 401 and lead an operator to disable the guard. Add the `i` flag.

### Minor - quality / correctness

25. **`EmailLog` has no index on `outboxId`** [Q] - `prisma/migrations/20260728012000_p11_email_platform/migration.sql:88`
    - Queries `prisma.emailLog.findMany({ where: { outboxId } })` (used in smoke and presumably admin failure-trail views) will table-scan as logs grow. Only `EmailLog_createdAt_idx` exists. The FK `EmailLog_outboxId_fkey` does not auto-index in Postgres for the referencing column. Add an index on `outboxId`.

26. **Triggered template keys are hardcoded to three** [Q] - `app/api/admin/email/route.ts:25`; `lib/email.ts:8`
    - EXPECTED P11 §1.1 calls for "triggered (transactional) keys" with per-key overrides. The API only accepts `["ORDER_CONFIRMATION", "PAYMENT_LINK", "REFUND"]`. There is no way to add new triggered keys (e.g., a P9 delivery-notification email) without a code change. New keys default-seed via `ensureDefaultEmailTemplates` but cannot be created or managed through the hub. Open the union (or move to a DB-driven key registry).

27. **`sendCampaign` return value `queued` is misleading** [Q] - `lib/email.ts:214-232`
    - `queued` is incremented for every iterated subscriber, even when both the `emailCampaignDelivery.upsert` and `queueEmail` upsert were no-ops on an existing row. The API response `${body.queued} campaign messages queued.` over-reports actual new work on a rerun. Count only actual inserts.

28. **P9 delivery/pickup/payment-reminder notifications are captured to `deliveryNotification` and never dispatched via email or SMS** [S][Q] - `lib/delivery.ts:98-112,269-278,404-411,438-446,514-521`; `lib/sms.ts:12-18`
    - Merged from security I1 + quality M8 (P9 side). `captureNotification` writes a `deliveryNotification` row with `channel: "TEST_CAPTURE"` for day-of-delivery, pickup-ready, and payment-reminder events. There is no path from these events to `queueEmail` or `dispatchSms` that would actually send a message. The P11 deliverable "SMS dispatch module reused by P9 notification channel reuse (G-021)" is structurally present (`dispatchSms` exists) but unused by P9 callers. This is a functional gap, not a leak; customer-facing notifications silently do not leave the system. Wire P9 events through the email/SMS dispatch path (or document that P9 notifications are capture-only this phase).

29. **Resend env var name leaks into the email orchestration layer** [Q] - `lib/email.ts:29-31`
    - EXPECTED P11 §1.1 calls for "Resend integration isolated in SDK module." `lib/resend.ts` is the SDK module, but `lib/email.ts` reads `process.env.RESEND_API_KEY` directly to decide test-capture vs live send. The orchestration layer knows the provider's env var name, weakening the isolation boundary. Expose a `sendThroughResend.isConfigured()` helper on the SDK module and call that instead.

### Minor - rules / workflow

30. **In-memory subscribe rate limiter is per-instance on serverless** [R] - `app/api/newsletter/route.ts:29-45`
    - The subscribe endpoint is public and triggers outbound email. `const subscribeAttempts = new Map<string, { count: number; startedAt: number }>()` is module-level. On Vercel serverless each instance has its own map and instances recycle, so a determined caller can exceed `maximumSubscribeAttempts = 5` per minute by hitting different instances. The limiter also never evicts stale entries except on window expiry for the same key — memory grows with distinct client addresses. Acceptable as a cheap first-pass guard, but the per-instance limitation is not documented in code or README. Document the limit or move to a shared store (Upstash/KV).

31. **Settings page nests email AJAX controls inside the settings `<form>`** [R] - `app/admin/settings/page.tsx:94-125`
    - The email section with campaign name/subject/body inputs, test-recipient input, and `createCampaign` / `runCampaign` / `sendPlatformTest` buttons lives inside `<form onSubmit={saveSettings}>`. The email buttons use `type="button"` so they do not submit the settings form, but the campaign `<textarea>` and `<input>` elements are unassociated form controls inside a form whose submit handler ignores them. A staff member tabbing through the email section interacts with controls that belong to a different submit context. The store-settings form and the email hub are distinct concerns; co-locating them in one `<form>` mixes submit semantics. Split into separate forms.

32. **`sendCampaign` preferences cast is an unvalidated `Json` assertion** [R] - `lib/email.ts:216`
    - `const preferences = subscriber.preferences as { marketing?: boolean }`. `preferences` is `Json` in the schema. The cast is unvalidated — a malformed value (e.g., `null`, a string, or `{"marketing":"yes"}`) makes `preferences.marketing` `undefined`, which is not `=== false`, so the subscriber is included. That is the safe direction (include by default), but the cast papers over the invariant rather than validating the shape. `updateNewsletterPreferences` writes via Zod-validated input, so well-formed rows are the norm, but a manual DB edit or migration could break the assumption silently. Validate the shape before trusting.

### Minor - clean-code / consistency

33. **Inconsistent constant naming in the same file** [C] - `lib/email.ts:5-6`
    - Module-level constants mix two conventions in the same file: `const MAX_OUTBOX_ATTEMPTS = 3;` (SCREAMING_SNAKE) vs `const outboxBatchSize = 25;` (camelCase). Both are module-level immutable config. Pick one.

34. **Inline magic numbers in outbox sweeper (10-min claim TTL, backoff minute, 30-day retention)** [C][R] - `lib/email.ts:125,164,178`
    - Merged from clean-code F3 + rules L5. Three time-window constants are inlined as numeric expressions instead of named constants: `10 * 60_000` (10-minute stale-claim recovery threshold), `outbox.attemptCount * 60_000` (per-attempt backoff minute), and `30 * 24 * 60 * 60_000` (30-day retention cutoff). The 10-minute claim TTL and the 30-day retention are policy values that belong in named constants next to `MAX_OUTBOX_ATTEMPTS`. The 30-day retention is also a magic value tied to an open question (plan § 4 Open questions Q6: retention periods for transactional message logs) — the code silently picks 30 days with no env override, no settings field, and no `DECISION-LOG` entry; the `AuditEvent` records `before` but not the policy name or rationale. Name all three, and make the retention policy configurable (or at least documented).

35. **Duplicated cron route boilerplate (5 sites)** [C] - `app/api/cron/email-outbox/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/cron/payment-reminders/route.ts`, `app/api/cron/pickup-expiry/route.ts`, `app/api/cron/season-auto-flip/route.ts`
    - Five cron route handlers are copy-paste: import `authorizeCron`, call it, return its rejection or `NextResponse.json(await handler())`, then `export const POST = GET`. Rule of 2 is satisfied (5 call sites). A `makeCronRoute(handler)` factory would remove the boilerplate and make the auth pattern impossible to drift.

36. **Inconsistent rejection variable name across cron routes** [C] - `app/api/cron/season-auto-flip/route.ts:6` vs the other four cron routes
    - Four cron routes name the auth rejection `rejected`; `season-auto-flip` names it `unauthorized`. Same concept, different name, same patch. Pick one.

37. **Premature extraction: `lib/sms.ts` has a single call site** [C] - `lib/sms.ts` (whole file, 19 lines); `lib/delivery.ts:6,106`
    - Rule of 2 requires 2+ real call sites before extracting. `dispatchSms` has exactly one caller (`captureNotification` in `lib/delivery.ts:106`). The plan calls for an "SMS dispatch module reused by P9" (G-021), but P9 already shipped and currently routes both SMS and non-SMS through `captureNotification` — the module is not yet reused, it is only invoked. Either inline until a second caller exists, or wire P9's other notification paths through it so the extraction earns its keep.

38. **Implicit fall-through handler for explicit `sweep` action** [C] - `app/api/admin/email/route.ts:30,69`
    - The discriminated union declares `action: z.literal("sweep")` but no `if (parsed.data.action === "sweep")` branch exists. The action is handled by the final catch-all `return NextResponse.json(await sweepEmailOutbox())`. Every other action has an explicit branch; `sweep` relies on fall-through. A reader has to infer that the catch-all is the sweep handler. Either add an explicit `sweep` branch or drop the literal from the union and document the default.

### Nit - informational

39. **`NEWSLETTER_DELIVERY_WEBHOOK_SECRET` is optional; the webhook URL is called with no auth when unset** [S] - `lib/newsletter.ts:88-101`
    - When `NEWSLETTER_DELIVERY_WEBHOOK_URL` is set but `NEWSLETTER_DELIVERY_WEBHOOK_SECRET` is unset, `deliverSubscriptionConfirmation` POSTs the confirmation URL (containing the raw confirmation token) to the webhook with no `authorization` header. The webhook is expected to enforce its own auth, but the code does not require a secret to be present before sending token-bearing payloads off-host. Require a secret when the URL is set (or document that the webhook must self-authenticate).

40. **`EmailLog.status` values are string literals with no DB-level constraint** [Q][C] - `prisma/schema.prisma:298`; `prisma/migrations/20260728012000_p11_email_platform/migration.sql:74`
    - Subset of #16's evidence, noted separately as a nit because the typo risk is the lower-severity face of the same root cause. `lib/email.ts:151,169` writes `"DELIVERED"` and `"FAILED"` as untyped strings; a typo (e.g., `"DELIVERD"`) compiles and writes a row that the enum would have rejected. Resolved by #16 (adopt the enum); tracked here so the typo vector is visible even if #16 is deferred.

41. **`purgeEmailLogs` 30-day default is the only retention policy and is undocumented** [R] - `lib/email.ts:178`; `app/api/cron/email-log-purge/route.ts:8`
    - The cron route calls `purgeEmailLogs()` with no argument, so the 30-day default is the only retention policy. The plan lists retention as an open question; the code silently picks 30 days. The `AuditEvent` records `before` but not the policy name or rationale. Subset of #34's policy angle; tracked separately as a nit because the documentation gap is independently fixable. Document the policy (and the open-question status) in code and README.

---

## Notes

- 1 blocker (preference-token crypto). 21 major. 17 minor. 2 nit. Total 41.
- 8 clusters merged (10 duplicates removed): (a) sendCampaign atomicity/SENT/audit — S-L1 + Q-M5 + R-M2 + C-F13 (#7); (b) outbox never purged — S-M3 + Q-L6 (#11); (c) stale-claim burns attempts — Q-M1 + R-L4 (#9); (d) FAILED no recovery — Q-M2 + R-M3 (#10); (e) admin test-send sweeps + repeat-test no-op — Q-M4 + C-F14 (#15); (f) EmailLog.status String — Q-L2 + C-F1 (#16); (g) emailHub write-on-read — R-L2 + C-F6 (#17); (h) magic numbers + 30-day policy — C-F3 + R-L5 (#34).
- Cross-source overlap noted without merge: security I1 + quality M8 (#28) — P9 dispatch gap (S side: P9 callers don't dispatch; Q side: SMS seam insufficient). Kept as one merged finding because both point to the same customer-impact gap.
- No new findings introduced during aggregation.





