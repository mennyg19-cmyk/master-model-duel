# P11 Security Review — arm-05 (blind)

**Phase:** P11 — Email & notification platform
**Scope:** preference-token crypto, campaign send authz, cron bearer auth, outbox claim races, PII in logs, test-mode leakage. Findings only — no fixes. P11 scope only.
**Evidence:** `lib/newsletter.ts`, `lib/email.ts`, `lib/resend.ts`, `lib/sms.ts`, `lib/cron-auth.ts`, `lib/delivery.ts`, `app/api/admin/email/route.ts`, `app/api/newsletter/route.ts`, `app/api/newsletter/confirm/route.ts`, `app/api/cron/*/route.ts`, `prisma/migrations/20260728012000_p11_email_platform/migration.sql`, `.env.example`, `vercel.json`, `scripts/smoke-p11.ts`.

## Summary counts

- Critical: 1
- High: 2
- Medium: 4
- Low: 4
- Informational: 2

---

## CRITICAL

### C1 — Unsubscribe token is a long-lived, single-secret HMAC with no key versioning and no per-operation scoping

**Location:** `lib/newsletter.ts:6,19-56,37-40`; `app/api/newsletter/confirm/route.ts:10-12`
**Claim:** A single `NEWSLETTER_TOKEN_SECRET` signs every preference/unsubscribe token with a 30-day lifetime, no key id, no audience binding, and the same token authorizes read (GET), update (PATCH), and unsubscribe (DELETE). Rotating the secret invalidates every outstanding link; not rotating it leaves a 30-day window during which any forwarded/leaked link is a full capability.
**Evidence:**
- `tokenLifetimeMs = 1000 * 60 * 60 * 24 * 30` (`lib/newsletter.ts:6`).
- `sign(payload)` uses `createHmac("sha256", signingSecret())` with no key id and no audience field (`lib/newsletter.ts:29-31`).
- `readUnsubscribeToken` only checks signature, payload shape, and `expiresAt` (`lib/newsletter.ts:42-56`). The same token is accepted by `getNewsletterSubscription`, `updateNewsletterPreferences`, and `unsubscribe` (`lib/newsletter.ts:118-145`).
- The confirmation flow mints a fresh unsubscribe token and redirects to `/unsubscribe?token=...` in plaintext over GET (`app/api/newsletter/confirm/route.ts:10-12`), so the capability URL lands in browser history, referrers, and any forwarded confirmation email.
- `signingSecret()` throws if `NEWSLETTER_TOKEN_SECRET` is unset; `readUnsubscribeToken` does not wrap that call in its try/catch (`lib/newsletter.ts:45`), so a missing secret turns every token check into an unhandled 500 rather than a clean null.

---

## HIGH

### H1 — Confirmation token never expires and `subscribe()` resets confirmed/unsubscribed state for any known email

**Location:** `lib/newsletter.ts:58-71,105-116`; `app/api/newsletter/route.ts:47-60`
**Claim:** The confirmation token is a 32-byte random with a sha256 hash store and **no expiry field** — once issued it is valid until consumed. Separately, `POST /api/newsletter` calls `subscribe()` which, for an existing subscriber, overwrites `confirmationTokenHash`, nulls `confirmedAt`, and nulls `unsubscribedAt`. An attacker who only knows a victim's email can repeatedly reset their subscription state and force new confirmation emails; the only throttle is a per-IP rate limit that is trivially bypassed from multiple IPs.
**Evidence:**
- `subscribe()` upserts with `update: { confirmationTokenHash: hashToken(confirmationToken), confirmedAt: null, unsubscribedAt: null }` (`lib/newsletter.ts:61-69`) — unconditionally wipes confirmation and unsubscribe on every subscribe call.
- `confirmSubscription` matches by `confirmationTokenHash` and clears it, but never checks an expiry (`lib/newsletter.ts:105-116`). The `NewsletterSubscriber` schema in the migration has no `confirmationTokenExpiresAt` column.
- The route's only abuse control is `isRateLimited` keyed on `x-forwarded-for`/`x-real-ip` (`app/api/newsletter/route.ts:29-45`), which an attacker rotating IPs defeats.

### H2 — `EMAIL_TEST_MODE=true` in production silently captures all customer email instead of sending, with no guard

**Location:** `lib/email.ts:29-31,114-120`; `.env.example:12`
**Claim:** `isTestCaptureEnabled()` returns true whenever `EMAIL_TEST_MODE === "true"` regardless of `NODE_ENV`. If an operator sets `EMAIL_TEST_MODE=true` in the production env (e.g., copied from `.env.example` which ships `EMAIL_TEST_MODE="false"` next to `RESEND_API_KEY="re_replace_me"`), every order confirmation, payment link, refund, and campaign send is recorded as `DELIVERED` with `provider: "test-capture"` and **no real email leaves the system**. Customers never receive payment links; staff see green delivery logs.
**Evidence:**
- `isTestCaptureEnabled()` (`lib/email.ts:29-31`): `process.env.EMAIL_TEST_MODE === "true" || (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production")`. The first clause is environment-agnostic.
- `sendOutboxEmail` returns `{ provider: "test-capture", externalId: "capture-..." }` and skips `sendThroughResend` entirely when capture is enabled (`lib/email.ts:114-120`), then the sweeper writes `EmailLog` with `status: "DELIVERED"` (`lib/email.ts:145-153`).
- `.env.example:12` ships `EMAIL_TEST_MODE="false"` but it is a single-character flip from `"false"` to `"true"` with no startup assertion that production forbids it.

---

## MEDIUM

### M1 — Campaign test-send and platform test-send accept any external recipient with no allowlist

**Location:** `app/api/admin/email/route.ts:19,22,52-55,62-65`; `lib/email.ts:103-112,237-247`
**Claim:** A staff member with `settings.manage` can use `test_campaign` or `test_email` to send arbitrary campaign bodies (which may contain customer PII, donor references, or unreleased content) to any RFC-5321 address they choose. There is no domain allowlist, no recipient confirmation, and no audit event for test sends. This is an exfiltration / content-spray primitive behind a generic settings permission.
**Evidence:**
- Route schema: `recipient: z.string().email().max(254)` with no domain restriction (`app/api/admin/email/route.ts:19,22`).
- `testSendCampaign` queues the campaign body to the supplied recipient via the outbox (`lib/email.ts:237-247`); `sendTestEmail` queues a fixed body (`lib/email.ts:103-112`).
- Neither `testSendCampaign` nor `sendTestEmail` writes an `AuditEvent`; only `purgeEmailLogs` and the order-lifecycle path do (`lib/email.ts:185,314` via checkout).

### M2 — Outbox DELIVERED transition is not guarded by `status: "PROCESSING"`, enabling a duplicate-delivery race after the 10-minute stale reset

**Location:** `lib/email.ts:122-176`
**Claim:** The claim step correctly uses `updateMany WHERE status="PENDING"` for atomic claiming, but the post-send DELIVERED update (`prisma.emailOutbox.update({ where: { id }, data: { status: "DELIVERED", ... } })`) has no `status` guard. If a sweeper stalls >10 minutes during a provider call, the stale-reset at the top of the next sweep flips the row back to `PENDING` (`lib/email.ts:124-127`), a second sweeper claims and sends it, and the stalled sweeper then completes its unguarded DELIVERED update — producing two real deliveries and two `EmailLog` rows for one outbox row.
**Evidence:**
- Stale reset: `updateMany where { status: "PROCESSING", claimedAt: { lt: now - 10min } } data { status: "PENDING", claimedAt: null }` (`lib/email.ts:124-127`).
- Claim: `updateMany where { id, status: "PENDING", availableAt: { lte: now } }` — atomic (`lib/email.ts:137-140`).
- Delivery commit: `prisma.emailOutbox.update({ where: { id: outbox.id }, data: { status: "DELIVERED", sentAt, claimedAt: null, lastError: null } })` — **no `status: "PROCESSING"` guard** (`lib/email.ts:146-148`).
- Smoke S4 only proves two concurrent sweeps don't double-claim a fresh row; it does not exercise the stale-reset + slow-sender path.

### M3 — `EmailOutbox` rows (recipient, subject, html, payment link) are never purged; only `EmailLog` is

**Location:** `lib/email.ts:178-187`; `prisma/migrations/20260728012000_p11_email_platform/migration.sql:52-69`
**Claim:** `purgeEmailLogs` deletes only `EmailLog` rows whose outbox is in a terminal state. The `EmailOutbox` row itself — which stores `recipient`, `subject`, full `html` body, and a `payload` referencing `orderId`/`campaignId`/`subscriberId` — is retained indefinitely. For `PAYMENT_LINK` messages the `html` contains the Stripe Checkout URL with the session id. There is no retention cron, no PII redaction, and no plan item addressing outbox retention.
**Evidence:**
- `purgeEmailLogs` deletes from `EmailLog` only and writes an audit event; it never touches `EmailOutbox` (`lib/email.ts:178-187`).
- Migration columns: `recipient TEXT`, `subject TEXT`, `html TEXT`, `payload JSONB` on `EmailOutbox` (`migration.sql:52-69`).
- `queueOrderLifecycleEmail` stores the rendered `html` (with `{{paymentLink}}` replaced by the real Stripe URL) into `EmailOutbox.html` (`lib/email.ts:80-88`).
- `vercel.json` registers only `email-log-purge`; no outbox purge cron exists.

### M4 — Confirmation token and recipient email can leak into server logs via uncaught `console.error`

**Location:** `app/api/newsletter/route.ts:52-58`; `lib/newsletter.ts:73-103`
**Claim:** The subscribe route logs the raw error from `deliverSubscriptionConfirmation` with `console.error("Newsletter confirmation delivery failed.", error)`. That function builds `confirmationUrl` containing the raw `confirmationToken` and, when the webhook path fails, throws after the fetch — the error object can carry the URL and the recipient email into stdout/observability. Anyone with log read access can then confirm the subscription (the confirmation token never expires — see H1).
**Evidence:**
- `confirmationUrl = ${siteUrl}/api/newsletter/confirm?token=${encodeURIComponent(confirmationToken)}` (`lib/newsletter.ts:75`).
- `console.error("Newsletter confirmation delivery failed.", error)` (`app/api/newsletter/route.ts:56`) — no redaction, no scrubbing of `error.message` or nested fields.
- `confirmSubscription` accepts the token with no expiry check (`lib/newsletter.ts:105-116`).

---

## LOW

### L1 — Campaign send marks `SENT` outside any transaction; partial queue failure leaves an unrecoverable state

**Location:** `lib/email.ts:205-235`
**Claim:** `sendCampaign` loops subscribers, upserts `EmailCampaignDelivery`, queues outbox rows one at a time with no transaction, then unconditionally sets `campaign.status = "SENT"`. If the loop throws partway, the campaign is still marked SENT and a re-send is blocked by the `EmailCampaignDelivery` unique constraint — subscribers who errored never receive the campaign and staff have no signal.
**Evidence:**
- Loop body: `await prisma.emailCampaignDelivery.upsert(...)` then `await queueEmail(...)` per subscriber, no `prisma.$transaction` wrapping (`lib/email.ts:215-232`).
- Final update: `prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: "SENT" } })` runs unconditionally after the loop (`lib/email.ts:233`).
- The `EmailCampaignDelivery_campaignId_subscriberId_key` unique index (`migration.sql:84`) prevents re-queueing on a second send.

### L2 — Campaign send, template edit, and platform test-send share one permission (`settings.manage`)

**Location:** `app/api/admin/email/route.ts:33-73`
**Claim:** All email-hub mutations — including mass campaign send to every confirmed subscriber and template body edits that affect all future transactional mail — sit behind a single `settings.manage` permission. There is no separate capability for "send to all" vs "edit templates" vs "send a test", so any staff granted settings management gets full blast-capability over customer email.
**Evidence:**
- GET and POST both call `authorize(request, "settings.manage")` (`app/api/admin/email/route.ts:34,40`).
- Same handler dispatches `send_campaign`, `test_campaign`, `update_template`, `test_email`, `sweep` from one discriminated union (`app/api/admin/email/route.ts:16-31,45-69`).
- No finer permission exists in `lib/permissions.ts` for email operations (verified by the single `authorize` call).

### L3 — Cron routes accept POST with no CSRF protection alongside the bearer secret

**Location:** `app/api/cron/email-outbox/route.ts:11`; `app/api/cron/email-log-purge/route.ts:11`; `app/api/cron/pickup-expiry/route.ts:11`; `app/api/cron/payment-reminders/route.ts:11`; `app/api/cron/season-auto-flip/route.ts:11`
**Claim:** Every cron handler aliases `POST = GET`. Vercel Cron calls GET; the POST surface adds nothing functional but means a browser-initiated cross-site POST with the bearer secret in a header is the only thing standing between an attacker and cron invocation. The bearer is not deliverable by a browser without custom JS, so the practical risk is low, but the POST surface is unnecessary attack surface.
**Evidence:**
- `export const POST = GET;` on all five cron routes (cited above).
- `authorizeCron` only checks the `authorization` header (`lib/cron-auth.ts:5-13`); it does not check method, origin, or `CRON_SECRET` presence at startup.

### L4 — `authorizeCron` parses the `Bearer ` prefix case-sensitively

**Location:** `lib/cron-auth.ts:6`
**Claim:** `request.headers.get("authorization")?.replace(/^Bearer /, "")` only strips a capitalized `Bearer `. RFC 7235 makes the scheme case-insensitive; a caller sending `bearer <secret>` is rejected. Not a security hole (fail-closed), but a fragility that could mask a misconfigured cron caller as a 401 and lead an operator to disable the guard.
**Evidence:**
- `/^Bearer /` is case-sensitive (`lib/cron-auth.ts:6`); no `i` flag, no case-insensitive scheme parse.

---

## INFORMATIONAL

### I1 — P9 delivery/pickup/payment-reminder notifications are captured to `deliveryNotification` and never dispatched via email or SMS

**Location:** `lib/delivery.ts:98-112,269-278,404-411,438-446,514-521`; `lib/sms.ts:12-18`
**Claim:** `captureNotification` writes a `deliveryNotification` row with `channel: "TEST_CAPTURE"` for day-of-delivery, pickup-ready, and payment-reminder events. There is no path from these events to `queueEmail` or `dispatchSms` that would actually send a message. The P11 deliverable "SMS dispatch module reused by P9 notification channel reuse (G-021)" is structurally present (`dispatchSms` exists) but unused by P9 callers. This is a functional gap, not a leak; flagged for scope awareness because it means customer-facing notifications silently do not leave the system.
**Evidence:**
- `startDriverRoute` calls `captureNotification({ channel: "TEST_CAPTURE", event: "DAY_OF_DELIVERY", ... })` (`lib/delivery.ts:269-278`).
- `markPickupReady` uses `channel: "TEST_CAPTURE"` (`lib/delivery.ts:438-446`); `sendPaymentReminders` likewise (`lib/delivery.ts:514-521`).
- `dispatchSms` is only reached when `captureNotification` receives `channel === "SMS"` (`lib/delivery.ts:106`), which no P9 caller passes.

### I2 — `NEWSLETTER_DELIVERY_WEBHOOK_SECRET` is optional; the webhook URL is called with no auth when unset

**Location:** `lib/newsletter.ts:88-101`
**Claim:** When `NEWSLETTER_DELIVERY_WEBHOOK_URL` is set but `NEWSLETTER_DELIVERY_WEBHOOK_SECRET` is unset, `deliverSubscriptionConfirmation` POSTs the confirmation URL (containing the raw confirmation token) to the webhook with no `authorization` header. The webhook is expected to enforce its own auth, but the code does not require a secret to be present before sending token-bearing payloads off-host.
**Evidence:**
- Headers built with a conditional `authorization` only when `NEWSLETTER_DELIVERY_WEBHOOK_SECRET` is set (`lib/newsletter.ts:92-94`).
- Body includes `confirmationUrl` with the raw `confirmationToken` (`lib/newsletter.ts:96-100`).
