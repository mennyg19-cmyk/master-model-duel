# P3 Security Review — arm-03 (Storefront)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P3 (marketing, catalog, archive, newsletter, admin catalog & media, settings hub)
Scope: `arms/arm-03/workspace/src` — API routes, libs, middleware, auth.
Smoke: `pass: true` (all S1–S5 green). Findings only below.

## Severity counts

```
Critical: 0
High:     1
Medium:   3
Low:      3
Info:     1
```

## Findings

### H1 — Newsletter HMAC secret falls back to a public constant
`src/lib/storefront/newsletter.ts:9-11` — `secret()` returns
`process.env.NEWSLETTER_HMAC_SECRET || process.env.APP_URL || "tomchei-dev-newsletter"`.
If `NEWSLETTER_HMAC_SECRET` is unset in a deployed environment, the signing key is a
publicly known string (or the app URL). An attacker can forge valid unsubscribe
tokens for any `subscriberId`/`tokenVersion` and mass-unsubscribe the list. The
fallback should fail closed (throw) rather than degrade to a guessable secret.

### M1 — Unauthenticated newsletter preferences IDOR
`src/app/api/newsletter/preferences/route.ts` — `POST` accepts any email and
updates that subscriber's preferences with no token or auth. Any caller can
mutate preferences for arbitrary subscribers, and the error message
("No active subscription found for that email") enumerates subscription status.
Require the signed unsubscribe token (or a per-subscriber auth session) before
mutating preferences.

### M2 — Media upload extension is not validated against the MIME allowlist (stored XSS)
`src/lib/storefront/media.ts:13-50` — `validateUpload` only checks the
client-supplied `file.type` against the image MIME set, but `storeMedia` derives
the on-disk extension from the sanitized original filename
(`name.replace(/[^a-zA-Z0-9._-]/g,"_")`). An admin with `settings.write` can
upload `evil.html` (or `.svg`) with `Content-Type: image/jpeg`; it passes
validation, is written to `public/uploads/media/<ts>-<rand>.html`, and is served
from the storefront origin as `text/html`/`image/svg+xml` (`/uploads(.*)` is
public in `middleware.ts`). That is a stored-XSS vector on the customer origin
via admin compromise. Validate the extension against an allowlist matching the
MIME type (or sniff magic bytes), and serve uploads with
`Content-Disposition: attachment` / `application/octet-stream`.

### M3 — Subscribe returns the unsubscribe token to the caller with no email verification
`src/app/api/newsletter/subscribe/route.ts:30-34` — the unsubscribe token is
returned in the response body to whoever calls `subscribe(email)`. Combined with
no email-ownership check, an attacker can subscribe a victim's address and
immediately receive a valid token to unsubscribe them (or hold it). Issue a
double-opt-in confirmation and deliver the token only via email.

### L1 — Dev auth bypass via spoofable header / weak cookie
`src/lib/auth.ts:34-49` and `src/middleware.ts:30-36` — when `AUTH_MODE=dev`,
`getAuthIdentity` trusts `x-dev-user-id` header or a `dev_user_id` cookie, and
the middleware short-circuits `NextResponse.next()` for every route. Any caller
can become any staff user (incl. manager) by setting a header. The dev-session
cookie (`src/app/api/dev/session/route.ts:17`) is set with `httpOnly: false` and
no `secure`/`sameSite`. Dev mode is opt-in, but if it ever ships, it is a full
auth bypass. Gate dev identity behind a signed/secret header and make the cookie
`httpOnly; secure; sameSite=lax`.

### L2 — Unsubscribe route double-verifies and leaks reason codes
`src/app/api/newsletter/unsubscribe/route.ts:16-23` — `verifyUnsubscribeToken`
runs in the route and again inside `unsubscribeWithToken`; the route also
surfaces distinct `reason` values (`tampered`/`expired`/`stale`/`malformed`) to
the client. Minor oracle for token state. Verify once and return a single
generic "invalid or expired link" message.

### L3 — `assertInventoryTargetXor` runs on the outer `db` inside a transaction
`src/app/api/admin/catalog/route.ts:131` and `addons/route.ts:52` — the XOR
assertion is called with the module-level `db` (not the `tx` passed to
`$transaction`), so the invariant check reads outside the transaction's
snapshot. Not directly exploitable, but it weakens the inventory-target
exclusivity guarantee under concurrency. Pass `tx` to the assertion.

### I1 — Preferences update audit-logs the wrong action
`src/app/api/newsletter/preferences/route.ts:25-27` — preference changes log
`NEWSLETTER_SUBSCRIBED` with `prefsUpdated: true` instead of a distinct
`NEWSLETTER_PREFERENCES_UPDATED` action, so audit readers cannot distinguish a
subscribe from a preference mutation. Use a dedicated audit action.
