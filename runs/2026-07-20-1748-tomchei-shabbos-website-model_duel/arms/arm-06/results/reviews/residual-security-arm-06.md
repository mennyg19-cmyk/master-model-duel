# Residual Security Review — arm-06 (Test 5, post-fix tree)

**Reviewer:** Security specialist (blind — no model names)
**Tree:** `arms/arm-06/workspace/` (post self-fix)
**Scope:** Full-tree residual security review — auth, secrets, IDOR, injection, webhooks, cron, test-ops, exports.
**Method:** Findings only. No fixes proposed. No self-review/self-fix notes read.

---

## Summary counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Info | 6 |
| **Total** | **13** |

---

## Medium

### M-1 — Admin API mutation routes lack explicit CSRF / same-origin protection

**Location:** All `app/api/admin/**/route.ts` POST/PATCH/DELETE handlers; `lib/auth.ts` `requireApiPermission`; `lib/session-codec.ts` cookie options (`sameSite: "lax"`).

**Observation:** Public mutation endpoints (`/api/checkout/*`, `/api/drafts/*`) guard with `assertSameOrigin` (`lib/public-guard.ts`) plus per-IP rate limiting. Admin API routes rely **solely** on the `SameSite=Lax` session cookie for CSRF defense — there is no Origin/Referer check, no CSRF token, and no rate limit on any `/api/admin/*` mutation. The middleware (`middleware.ts`) only validates cookie presence + signature; role/permission gates run inside each handler via `requireApiPermission`.

**Residual risk:** `SameSite=Lax` blocks cross-site background fetches (XHR/fetch/iframe) in modern browsers, so the practical exposure is limited. However, the defense is entirely browser-policy-dependent and asymmetric with the public routes (which DO assert origin). A future cookie-policy change, a legacy client, or a same-origin XSS would leave every admin mutation unprotected. Defense-in-depth gap, not an exploitable hole today.

**Affected surface (sample):** staff create/patch/revoke, impersonation start/stop, payment post/void/refund, POS checkout, order finalize/repeat/bulk, settings writes, email campaign send/test-send, import stage/commit/discard, media upload/patch/delete, route link/deliver/reassign/reroute/start, export, reconciliation run, test-ops.

### M-2 — `Content-Security-Policy` header is not set

**Location:** `next.config.mjs` `headers()`.

**Observation:** Baseline headers configured: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. No `Content-Security-Policy` and no `Strict-Transport-Security` (HSTS is generally platform-managed on Vercel, but CSP is not).

**Residual risk:** Without CSP, any injected inline script (e.g., from a future stored-XSS in admin-rendered user content, or a compromised third-party script) executes with no policy boundary. React auto-escapes server-rendered text and admin JSON responses are not navigable HTML, so there is no immediate injection vector — but CSP is the standard defense-in-depth layer and its absence leaves the trust boundary implicit.

---

## Low

### L-1 — In-memory rate limiting is per-instance (bypassable under serverless)

**Location:** `lib/rate-limit.ts` (module-level `Map`); `app/api/client-error/route.ts` (`recentHits` array).

**Observation:** The fixed-window limiters (`newsletterRateLimit`, `deliveryCheckRateLimit`, `addressValidateRateLimit`, `draftSaveRateLimit`, `checkoutRateLimit`) and the client-error limiter are in-process maps/arrays. The module comment acknowledges this: "speed bump rather than a hard cap." Under Vercel's serverless model each instance keeps its own buckets, so an attacker rotating across instances effectively gets N× the limit. `MAX_KEYS = 10_000` bounds memory but does not bound bypass.

**Residual risk:** Enumerating the delivery ZIP allowlist or spamming subscribe upserts is slowed but not capped. Documented limitation; no infrastructure dependency was added.

### L-2 — `clientIp` trusts the first hop of `X-Forwarded-For` (spoofable)

**Location:** `lib/client-ip.ts`; consumed by `lib/auth.ts` `createLoginSession`, `lib/customers/session.ts`, every rate limiter, `lib/audit.ts`.

**Observation:** `headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 45)`. The comment correctly notes the header is client-controllable and is "audit metadata, never an auth input." On Vercel the platform prepends the real client IP, but a caller who controls the request can still influence the first hop in some proxy chains, rotating rate-limit keys and planting misleading audit IPs.

**Residual risk:** Rate-limit evasion (compounds L-1) and polluted audit `ip` columns. Not used for authorization anywhere — confirmed by reading every consumer.

### L-3 — Open-redirect-shaped `next` parameter in dev-login customer form

**Location:** `app/dev-login/page.tsx` (lines 48, 63); `app/dev-login/dev-customer-login-form.tsx` `router.push(next)`.

**Observation:** The staff form coerces `next` to `/admin` unless it `startsWith("/admin")`. The customer form does the inverse: `next?.startsWith("/admin") ? "/account" : (next ?? "/account")` — so any `next` that does NOT start with `/admin` is passed verbatim to `router.push`. A `next=//evil.com` (protocol-relative) or `next=https://evil.com` would navigate off-origin. The page is gated by `isDevAuthBypass` (`lib/dev-auth.ts`), which is hard-disabled on every Vercel deploy (`VERCEL_ENV` production AND preview both refuse, plus `APP_ENV=test` required), so this is unreachable in any deployed environment.

**Residual risk:** Local/test only. Still, the validation is a negative-prefix check rather than an allowlist of internal paths.

### L-4 — `assertSameOrigin` allows requests with no `Origin` header

**Location:** `lib/public-guard.ts` `assertSameOrigin`.

**Observation:** `if (!origin) return null;` — a request with no Origin header passes the guard. The comment justifies this: browsers always send Origin on cross-origin fetches, so a missing Origin means a same-site form or a non-browser caller (curl). This is correct for browser CSRF defense, but it means a same-origin XSS or a browser bug that omits Origin would bypass the check on the public checkout/draft routes.

**Residual risk:** Defense-in-depth gap on the public mutation surface. The admin surface (M-1) has no Origin check at all.

### L-5 — `$executeRawUnsafe` used for `TRUNCATE` in test-ops

**Location:** `lib/testops/actions.ts` `truncateAll` (line 113).

**Observation:** `db.$executeRawUnsafe(\`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE\`)` where `list` is built by mapping the hardcoded `WIPE_TABLES` / `CLEAR_TABLES` arrays through `"${table}"`. The table names are static module constants exported for the test suite to pin against the schema — no user input reaches the string. The unsafe variant is used because Prisma's tagged-template `$executeRaw` cannot compose a dynamic table list.

**Residual risk:** None today — the inputs are constants. Flagged only because the unsafe API is in use; a future copy-paste that interpolates a parameter here would be injectable. The route is also double-gated (`settings.manage` permission + `requireTestEnv()` refusing non-test `APP_ENV`).

---

## Info

### I-1 — Unauthenticated first-manager bootstrap at `/api/setup`

**Location:** `app/api/setup/route.ts`.

**Observation:** The route is intentionally unauthenticated (no staff exists yet to authenticate). It uses `pg_advisory_xact_lock(1)` + `staffUser.count() > 0` inside one transaction to make the empty-database check atomic, then 409s forever after the first manager. By design; the advisory lock prevents a TOCTOU double-bootstrap.

### I-2 — `/uploads/[name]` serves files unauthenticated

**Location:** `app/uploads/[name]/route.ts`.

**Observation:** Strict regex `^[0-9a-f-]{36}\.(jpg|png|webp|gif)$` (UUID + image ext) prevents path traversal and non-image names. Files are served with immutable cache headers. Names are server-generated UUIDs, so enumeration is infeasible. Product images are public by intent; no auth gate is correct here.

### I-3 — Stripe webhook verification is correct and replay-protected

**Location:** `app/api/webhooks/stripe/route.ts`; `lib/payments/stripe.ts` `verifyWebhookSignature`.

**Observation:** RAW body is read with `request.text()` and verified against the v1 signature with a 5-minute replay window (`SIGNATURE_TOLERANCE_SECONDS = 300`), timing-safe compare. Idempotency via unique `StripeWebhookEvent(eventId)` row created before any domain work; on processing failure the row is deleted so Stripe retries cleanly. Zod parses the envelope and per-type object — a signed-but-malformed payload is a 400, never an unsafe cast. No residual issue.

### I-4 — Driver magic link + PIN throttling is sound

**Location:** `lib/routes/links.ts`; `app/api/drive/[token]/guard.ts`, `pin/route.ts`, `start/route.ts`, `deliver/route.ts`.

**Observation:** 256-bit token (`randomBytes(32).toString("base64url")`), only SHA-256 hash stored. PIN optional, hashed with route-id salt. Escalating lockout (`pinLockCount` never resets on success; 10m→20m→…→12h, then dead until rotation). PIN cookie is HMAC-bound to `linkId + expiresAt`, so it cannot outlive the link or transfer to another route. `requireActiveLink` is the single guard for every `/api/drive/[token]/*` verb. No residual issue.

### I-5 — Guest draft token transport is httpOnly-only

**Location:** `lib/orders/guest-draft-cookie.ts`; `lib/orders/guest-token.ts`.

**Observation:** Raw guest token is issued once in the create response, then travels only in an httpOnly, `SameSite=Lax`, scoped, max-age-bounded cookie — never in URLs, response bodies, or localStorage. The DB stores only the HMAC hash (`hashGuestToken`), so a DB leak alone cannot open guest drafts. Misses return 404 (not 403) to prevent enumeration. No residual issue.

### I-6 — Export CSV formula-injection guard present

**Location:** `lib/exports/datasets.ts` `safeText` (line 40); `app/api/admin/export/[dataset]/route.ts`.

**Observation:** Every text cell starting with `= + - @` or a tab is prefixed with `'` so spreadsheet apps render it literally. Numbers pass through (typed cells). The `content-disposition` filename for print-batch PDFs (`app/api/admin/fulfillment/print-batches/[batchId]/pdf/route.ts`) sanitizes quotes, backslashes, and control chars from the staff-influenced `filingGroup`. Route PDFs use `routeId` (server UUID) in filenames. No residual issue.

---

## Notes on areas checked and found clean

- **IDOR / ownership:** Customer address book (`/api/account/addresses/[id]`), profile, order repeat, and draft routes all enforce ownership server-side and return 404 on foreign ids — anti-enumeration consistent. Admin customer/order/package routes are manager/staff-scoped by permission (no per-actor ownership, by design).
- **Privilege escalation:** `canManageStaffRole` and `canImpersonate` are role-rank checks (not permission checks), so a `GRANT` override of `staff.manage` / `staff.impersonate` alone cannot escalate an actor into a higher-ranked identity. Self-targeting is blocked (`canTargetStaff`). Optimistic concurrency (`version`) prevents stale-writer overwrites on staff edits.
- **Session lifecycle:** Server-side `AuthSession` / `CustomerSession` rows validated on every gated request (existence, `revokedAt`, `expiresAt`, `status === ACTIVE`); revocation on staff revoke kills existing cookies immediately. 12h TTL.
- **Secrets:** `.gitignore` excludes `.env*` (except `.env.example`); `.env.example` carries placeholder values only. `AUTH_SECRET`, `CRON_SECRET`, Stripe/Shippo/Resend/Twilio keys all flow through the zod-validated `lib/env.ts`. Dev-auth bypass is fail-closed and Vercel-disabled.
- **Cron auth:** `lib/cron-auth.ts` `isCronAuthorized` is constant-time (SHA-256 hash compare via `timingSafeEqual`) and refuses all callers when `CRON_SECRET` is unset. `lib/cron-route.ts` applies it uniformly to every cron route.
- **Raw SQL:** All `$queryRaw` / `$executeRaw` uses tagged templates (parameterized) except the documented `$executeRawUnsafe` in test-ops (L-5, constant inputs). `FOR UPDATE` locks in `lib/inventory/reserve.ts` and counter increments in `lib/orders/numbers.ts` are parameterized.
- **File upload:** `lib/media/validation.ts` validates content-type allowlist, size cap (5MB), extension↔type agreement, and magic-byte sniffing (`sniffImageType`) — a polyglot/misnamed file cannot reach storage.
- **Test-ops:** Double gate (`settings.manage` permission + `requireTestEnv()` refusing non-test `APP_ENV`); identity and audit survive every action.
