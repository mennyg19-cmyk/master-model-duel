# P11 Security Review — arm-01 (blind)

**Phase:** P11 — Email & notification platform
**Tree:** `arms/arm-01/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.
**Reviewer model:** blind to contestant identity.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 6 |
| Informational | 2 |
| **Total** | **10** |

## Findings

### M1 — HTML injection in transactional email bodies (no variable escaping)
`renderTemplate` in `src/domain/messaging.ts` interpolates `variables` raw into `htmlBody`/`textBody` without HTML-escaping. `customerName` (Clerk/displayName) and `package.recipientName` (customer-entered at checkout) are user-controlled and land verbatim in branded HTML sent via Resend. Email clients won't run script, but tracking pixels, phishing links, and content spoofing inside branded transactional emails are achievable. Also affects `preferenceUrl`, `paymentUrl`, `refundAmount`, `pickupLocation`, `deliveryWindow`, `orderNumber`.
Ref: `src/domain/messaging.ts:84-92,184-186,231-233`.

### M2 — Unauthenticated, unthrottled newsletter subscribe endpoint
`POST /api/newsletter/subscribe` performs no auth and no rate limit (the `PublicRequestThrottle` helper used by checkout/drafts is not applied). It upserts any email and enqueues a preference email/capture each time. An attacker can enumerate/pollute the subscriber list, re-subscribe victims who unsubscribed (clearing `unsubscribedAt`), and generate large volumes of outbox rows / provider sends.
Ref: `src/app/api/newsletter/subscribe/route.ts:7-38`; compare `src/lib/public-request.ts`.

### L1 — Preference-token disclosure when `EMAIL_TEST_MODE=true`
When `EMAIL_TEST_MODE === "true"`, the subscribe response echoes the signed `preferenceToken`. Anyone subscribing an email they don't own in a test-mode deployment obtains a valid HMAC token granting read/PATCH access to that subscriber's preferences (unsubscribe, preference flips). Gated by an explicit env flag, but it is the same flag used for smoke/CI and is easy to leave on in preview.
Ref: `src/app/api/newsletter/subscribe/route.ts:34-37`; `src/lib/newsletter.ts:30-54`.

### L2 — `isEmailTestMode()` silently captures in any non-production env lacking `RESEND_API_KEY`
`isEmailTestMode()` returns true when `NODE_ENV !== "production" && !RESEND_API_KEY`. Staging/preview without a Resend key silently captures all sends instead of delivering, masking delivery failures and expanding the test-mode surface that L1 depends on.
Ref: `src/lib/resend.ts:22-27`.

### L3 — User-supplied cron run-key can pre-claim future cron runs
Both P11 cron routes use the `x-cron-run-key` header verbatim as the `CronRun.runKey` unique key. A caller holding `CRON_SECRET` can supply a runKey matching a future scheduled run to pre-create a row, causing that future invocation to no-op via the `priorRun` short-circuit. Requires the secret, so impact is limited to denial of scheduled work by an insider/leaked-secret holder.
Ref: `src/app/api/cron/message-outbox/route.ts:10-11`; `src/app/api/cron/message-log-purge/route.ts:17-18`; `src/domain/messaging.ts:426-428,462-463`.

### L4 — `RESEND_FORCE_FAILURE` test hook left in the delivery path
`sendResendEmail` throws for every recipient when `RESEND_FORCE_FAILURE === "true"`. A test-only switch in the production code path; anyone with env-variable control can silently disable all email delivery (messages retry, then FAIL after 3 attempts). Env access is privileged, but the hook should not exist in shipped code.
Ref: `src/lib/resend.ts:30-32`.

### L5 — TOCTOU on `CronRun.runKey` lets concurrent cron calls 500
`runOutboxSweep` and `purgeMessageLogs` do `findUnique(runKey)` then `create` without a unique-constraint retry. Two overlapping cron invocations sharing the same default runKey (e.g. two within the same minute for `message-outbox`) both pass the check and both attempt insert; the second throws on the unique constraint and surfaces as a 500, even though the underlying sweep is idempotent via `FOR UPDATE SKIP LOCKED`.
Ref: `src/domain/messaging.ts:426-431,462-466`.

### L6 — Campaign send is an unbounded in-request loop
`queueCampaign` loads up to 5,000 subscribers and `await`s `enqueueMessage` sequentially inside the admin HTTP request. A large list will exceed the function timeout / hold a DB connection for the whole request — an availability risk for an admin-triggered operation (not anonymous).
Ref: `src/domain/messaging.ts:216-243`.

### I1 — `lastError` from provider responses stored and surfaced to admins
`recordFailedDelivery` stores `error.message` (including Resend error text) into `MessageOutbox.lastError` and `MessageAttempt.errorMessage`, rendered in the admin email hub. Admin-only, but provider error text can include request details; acceptable but worth noting.
Ref: `src/domain/messaging.ts:364-376`; `src/components/email-hub.tsx:239`.

### I2 — Admin-authored campaign/template HTML sent unescaped to recipients
By design the email hub lets `settings:manage` staff author raw `htmlBody` for campaigns and templates. This is the expected email-builder trust boundary, but a compromised or low-trust admin can send arbitrary HTML (including phishing markup) through the org's Resend identity to any list. No approval/preview gate beyond test-send.
Ref: `src/app/api/admin/email/route.ts:74-179`; `src/domain/messaging.ts:232-233`.

## Notes (no findings)

- Cron auth (`isAuthorizedCronRequest`) is fail-closed when `CRON_SECRET` is unset and uses `timingSafeEqual`. Correct.
- Newsletter preference token is HMAC-SHA256 with 30-day expiry, `timingSafeEqual` signature check, and rejects extra `.` segments. Solid; no IDOR on preference PATCH (token-bound).
- Outbox claim uses parameterized `Prisma.sql` with `FOR UPDATE SKIP LOCKED` — no SQL injection, correct overlap handling at the message level.
- `requirePermission("settings:manage")` / `payments:manage` guards are present on all admin email and refund routes; refund route writes audit log.
- `.env.example` and `generate-env-example.mjs` contain only placeholder values; no real secrets committed.
