# Residual Security Review — arm-04 (Test 5)

Reviewer: external (security), blind to SELF-REVIEW / SELF-FIX-NOTES.
Scope: `arms/arm-04/workspace/` post-fix tree only.
Focus: trust boundaries, auth, secrets, IDOR, injection.
Findings only — no proposed fixes.

## Severity summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 5 |

## Findings

### SEC-01 — Minor — CSV import stores formula-injection prefixes verbatim
`src/lib/imports/csv.ts` parses RFC 4180 and, by comment, stores values that
begin with `=`, `+`, `-`, or `@` as typed. Imported customer/product fields
(name, address, notes) flow into admin list views and CSV exports
(`src/lib/reports/export-service.ts`). An attacker who can submit a CSV import
(a `migration.manage`/`imports.manage` staff member, or a poisoned legacy file)
can plant cells that Excel/Sheets interpret as formulas when an admin opens the
re-exported CSV. Impact is bounded (admin-only audience, no server execution)
but is a classic injection-of-trust vector. Not exploitable by anonymous users.

### SEC-02 — Minor — In-memory rate limiter is per-instance and not shared
`src/lib/http/public-guards.ts` keeps a `Map` of hits in module scope. Under
serverless / multi-instance deployments each warm instance has its own counter,
so the effective limit is `limit × instanceCount`. Public endpoints
(client-error reporter, Stripe webhook) therefore tolerate more hits than the
configured ceiling suggests. No data is exposed, but the brute-force / abuse
throttling is weaker than the configuration implies.

### SEC-03 — Minor — `clientIpAddress` trusts `x-forwarded-for` only when
`TRUST_PROXY_HEADERS` is set, but the first IP is taken unconditionally
When `TRUST_PROXY_HEADERS=true`, `request-ip.ts` / `public-guards.ts` read the
first entry of `x-forwarded-for`. On a single-hop proxy this is correct; on a
chain where the leftmost value is client-controlled and not stripped by the
edge, the first IP can be spoofed. Audit logs and rate-limit buckets would then
attribute actions to an attacker-chosen address. The setting is opt-in and the
default is `false`, so this is a deployment-footgun rather than a default bug.

### SEC-04 — Minor — Local hosted-payment page is gated only by session URL,
not by a server-verified ownership check on the order
`src/app/checkout/hosted/[sessionId]/actions.ts` and `src/lib/payments/local-hosted.ts`
accept a `sessionId`, look up the hosted session, and act on the bound order.
The lookup is by session id (an unguessable random value) and the session
references the order, so confidentiality rests on session-id entropy. There is
no secondary `customerId`/`draftOwner` match. For the local provider
(loopback-only by env validation) this is acceptable, but the pattern would be
unsafe if the local provider were ever exposed off-loopback. Flagging as a
trust-boundary note, not an exploitable path today.

### SEC-05 — Minor — `proxy.ts` middleware is a coarse auth check only and
relies on a cookie name, not its validity
`src/proxy.ts` lets any request through if `SESSION_COOKIE` is present, without
verifying the signature. Tampered or junk cookies reach the route handler, where
`requirePermission` does the real check. The middleware comment acknowledges
this. Net effect: no bypass (the real gate is server-side), but every request
with a cookie-shaped value skips the redirect, which is fine. Noted as a
defense-in-depth gap, not a vulnerability.

## What was checked and looked solid (no finding)

- **Staff auth / permissions**: single `requirePermission` gate on every admin
  server action and route handler; 401/403 on miss; role defaults + per-user
  overrides; `guardSelfTarget` blocks self-edit of role/permissions/status;
  impersonation re-checks `staff.impersonate` and splits actor/acting in audit.
- **Session cookies**: HMAC-SHA256 signed, `timingSafeEqual` compare, `httpOnly`,
  `sameSite=lax`, `secure` in production; impersonation and guest-draft cookies
  carry only non-secret identifiers.
- **Secrets**: `env-spec.ts` rejects weak/placeholder secrets at boot; local-only
  providers (`AUTH_PROVIDER=local`, `MEDIA_STORAGE=local`, `PAYMENT_PROVIDER=local`,
  `EMAIL_PROVIDER=capture`, `CRON_SECRET`) are confined to loopback origins;
  `.env.example` carries placeholders only; no secrets in code.
- **Cron / webhooks**: `CRON_SECRET` bearer with `timingSafeEqual`, rejects
  unset secret; Stripe webhook verifies signature with timestamp tolerance and
  `timingSafeEqual`, `isSameOrigin` guard, idempotency via `claimEvent`.
- **IDOR (customer-facing)**: order detail / repeat / confirmation / address book
  all filter by `customerId` (and `addressId` for addresses); draft access uses
  hashed guest tokens and `ownerFilter`; `cancelDraftAction` resolves ownership
  before using the client-supplied `orderId`.
- **Driver routes**: token is SHA-256 hashed at rest, PIN is scrypt-hashed, PIN
  submission throttled with exponential lockout, each driver action re-validates
  the token and PIN; driver session cookie signs `linkId`.
- **Newsletter tokens**: HMAC-signed with purpose prefix and expiry, verified
  with `timingSafeEqual`; unsubscribe requires POST (defends against mail-scanner
  GETs).
- **Open redirects**: `safeDestination` canonicalizes and allowlists staff and
  customer destinations; `redirectWithFlash`/`rejectWith` use fixed paths.
- **Media uploads**: extension + declared content-type + byte-sniff consistency,
  SVG rejected, `buildPathname` sanitizes filename, `storeOnDisk` re-checks the
  resolved path stays inside the upload root.
- **Checkout integrity**: `expectedTotalCents` re-verified at `payAction` and in
  `checkout-service`; `requireOpenStore` blocks mutations when the store is
  closed; reconciliation sweep is read-only and audit-logged.
- **Health endpoint**: DB error detail is logged server-side, generic message
  returned to caller — no connection-string leakage.
- **Setup bootstrap**: `isSetupLocked` + unique-key insert in a transaction
  prevents re-running setup once a manager exists.
