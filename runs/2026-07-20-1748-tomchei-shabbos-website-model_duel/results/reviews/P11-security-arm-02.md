# Reviewer specialist — Security

**Arm:** arm-02 (blind)
**Tree / phase:** P11 — Email & notification platform
**Scope:** `lib/email/*`, `lib/sms/provider.ts`, `lib/notifications.ts`, `lib/newsletter-token.ts`, `lib/cron.ts`, `app/api/admin/email/*`, `app/api/cron/{notification-sweeper,email-log-purge}`, `app/(storefront)/newsletter/preferences`, `app/(admin)/admin/email`, `components/admin/email-hub.tsx`, `components/admin/settings/email-tab.tsx`.
**Posture:** findings only — no fixes. Trust boundaries, auth, secrets, IDOR, injection.

## Summary

P11 is well-postured at the trust boundaries that matter most: provider secrets (Resend, Twilio) are isolated behind one type each and never leak past their file; the outbox claim is a conditional UPDATE so overlapping sweeps send exactly once; cron endpoints fail closed (503) without `CRON_SECRET` and compare the bearer token in constant time; newsletter manage/unsubscribe links are HMAC-signed with `SESSION_SECRET` and verified in constant time; the public subscribe route is rate-limited and deliberately returns no token (no token-mint oracle); session cookies are `httpOnly` + `sameSite=lax` + `secure` in prod, so cross-origin POST mutations can't ride a staff cookie; `email.log_retention_days` is schema-validated `int >= 1` (a 0/NaN retention cannot be stored); and the production env guard refuses to run the mock email provider without a real key or explicit test mode.

The findings below are audit-trail gaps and one token-leak in the admin hub, not provider/auth bypasses.

## Findings

### M1 — Campaign preview returns a live signed manage token for a real subscriber
`app/api/admin/email/campaigns/[id]/route.ts` GET mints `createNewsletterToken(sample.email)` for `audience[0]` (a real subscriber when the audience is non-empty) and returns the rendered body containing `…/newsletter/preferences?token=<signed>` in the JSON `preview`. The hub renders this body in the DOM (`email-hub.tsx` `loadPreview`). Any staff member with `email.manage` can copy that token and use `/api/newsletter/preferences` (PATCH) or `/api/newsletter/unsubscribe` (POST) to change that subscriber's preferences or unsubscribe them — exactly the "staff can look up, not impersonate" posture the Subscribers tab explicitly claims is forbidden. The token is 90-day-lived.

### M2 — Test-send endpoints send to arbitrary external addresses with no AuditLog entry
`app/api/admin/email/campaigns/[id]/test-send/route.ts` and `app/api/admin/email/test/route.ts` dispatch a real email (through the live Resend provider when configured) to a staff-entered address. Unlike `campaigns` POST, `campaigns/[id]` PATCH, `campaigns/[id]/send` POST, `lists` POST, and `templates` PATCH — all of which call `writeAudit` — neither test-send route writes an audit row. The only trail is the `Notification` + `NotificationAttempt` rows, which the `email-log-purge` cron deletes after `email.log_retention_days` (min 1 day). A staff member with `email.manage` can therefore exfiltrate draft campaign content to an arbitrary external address and have the only evidence age out of the database with no `AuditLog` record. The campaign test-send additionally embeds `gate.staff.realUser.name` in the rendered body, leaking the real staff member's name (even during impersonation) to the external recipient.

### M3 — List membership add/remove is not audited
`app/api/admin/email/lists/[id]/members/route.ts` mutates campaign audience composition (add/remove a subscriber from a list) with no `writeAudit` call, while the sibling `lists/route.ts` POST does audit. Audience membership directly determines who a `campaigns/[id]/send` delivers to, so an unlogged add/remove can silently change the reach of a later send with no audit trail.

### L1 — Test-send rows enter the cron retry outbox on failure
Both test-send routes create a `Notification` with `status: "sending"` and call `dispatchOne`. On provider failure, `dispatchOne` (lib/email/dispatch.ts) sets `status: "pending"`, `claimedAt: null`, `nextAttemptAt = now + backoff`, after which the `notification-sweeper` cron retries it up to `MAX_ATTEMPTS`. A staff-initiated test send to an external address that fails will therefore be retried automatically by the cron, repeatedly attempting delivery to that address without further staff action and with no audit entry (see M2).

### L2 — No rate limiting on admin email send endpoints
No `rateLimit` call in any `app/api/admin/email/*` route. The test-send endpoints are dedupe-free by design (`dedupeKey = …|${Date.now()}`), so a staff member can repeatedly fire test sends to the same external address with no throttle. Staff-gated, so low severity, but it amplifies M2's exfiltration/abuse vector.

### L3 — Campaign preview `to` field exposes a real subscriber's email
`campaigns/[id]/route.ts` GET returns `preview.to = sample.email` (the first real audience member's address). Already visible to `email.manage` via the subscribers search, so low impact, but the preview endpoint is meant to render content, not enumerate audience members.

### I1 — Preferences PATCH is a (weak) token-state oracle
`app/api/newsletter/preferences/route.ts` returns 403 for an invalid/expired token, 404 for a valid token with no subscriber, and 200 on success. Tokens can't be forged without `SESSION_SECRET`, so this is not exploitable for impersonation, but the distinct 403-vs-404 response leaks whether a signed token is still live. The unsubscribe route correctly collapses all cases to 200.

### I2 — `from`/`reply_to` settings have no email-format validation
`lib/settings.ts` declares `email.from_address` and `email.reply_to` as bare `z.string()` with no `.email()` check. A staff member with `settings.manage` can store an arbitrary string; Resend will reject malformed addresses at send time, but a syntactically valid address on a spoofed domain (if the org's Resend sending domain allows) would be accepted. Staff-gated config; flagged for completeness.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 (M1, M2, M3) |
| Low | 3 (L1, L2, L3) |
| Info | 2 (I1, I2) |
| **Total** | **8** |

## What is not a finding (cleared on inspection)

- Provider secret isolation (R-171): Resend/Twilio keys never leave `lib/email/provider.ts` / `lib/sms/provider.ts`. Cleared.
- Outbox idempotency / overlap (S2, S4): conditional claim UPDATE + `dedupeKey` unique constraint. Cleared.
- Cron auth (S4): `requireCronAuth` fails 503 without secret, constant-time bearer compare. Cleared.
- Newsletter token (S1): HMAC-SHA256 over `base64url(email).expires`, constant-time verify, expiry enforced. Cleared.
- Purge safety (S5): `email-log-purge` only deletes `sent/captured/failed` with `createdAt < cutoff`; pending/sending untouched; retention schema-validated `>= 1`. Cleared.
- Test-mode capture (S5): `EMAIL_TEST_MODE` short-circuits provider send to `captured` before any network call. Cleared.
- Production mock-provider guard: env refuses to run mock email in production without key/test-mode. Cleared.
- CSRF: session cookie `sameSite=lax`; no GET mutations on admin email routes; cross-origin POSTs don't carry the cookie. Cleared.
- SQL injection: no raw SQL in P11 code; `finalize.ts` advisory-lock query is parameterized. Cleared.
- Email body injection: campaign/template bodies are plain text sent as Resend `text` (no HTML). Cleared.
