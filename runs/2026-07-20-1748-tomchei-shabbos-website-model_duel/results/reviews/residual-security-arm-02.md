# Security Residual Review — arm-02 (Test 5, post self-fix)

**Reviewer specialist:** Security
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Tree graded:** `arms/arm-02/workspace/` (post self-fix, full tree)
**Method:** Blind — graded the post-fix tree only; no access to SELF-REVIEW / SELF-FIX-NOTES / self-review chat.
**Focus:** trust boundaries, auth, secrets, IDOR, injection.
**Scope:** findings only — no fixes proposed.

---

## Severity summary

| Severity | Count |
|---|---|
| High     | 0 |
| Medium   | 5 |
| Low      | 7 |
| **Total** | **12** |

No High-severity issues found. The money path, auth token signing, webhook authenticity, and IDOR scoping are solid. The residuals below are hardening gaps and one design-level privilege caveat — none are an immediate path to account takeover or fund movement.

---

## What is already done well (context for the findings)

- **Session tokens** are 32 random bytes, stored only as an HMAC-SHA256 keyed by `SESSION_SECRET`; a leaked `Session`/`CustomerSession` table cannot forge lookups (`lib/auth/session.ts`, `lib/auth/customer-session.ts`). Staff and customer identity live in separate tables/cookies and cannot cross.
- **Webhook authenticity** is enforced with a Stripe-spec HMAC over `t.payload`, 5-minute timestamp tolerance, and `timingSafeEqual` (`lib/payments/webhook-verify.ts`). The route is idempotent via a unique event-id ledger with a processing-grace reclaim window (`app/api/webhooks/stripe/route.ts`).
- **Fail-closed env guards** (`lib/env.ts`): real mode refuses the public `DEV_WEBHOOK_SECRET`, refuses the public `SESSION_SECRET` placeholders, requires `TRUST_PROXY` in production, requires `STRIPE_SECRET_KEY` in production, and refuses half-configured Shippo/Twilio. Cron endpoints return 503 when `CRON_SECRET` is unset.
- **IDOR scoping is consistent** on customer surfaces: `account/orders/[id]`, `account/addresses/[id]`, `repeat`, and `addresses/autocomplete` all derive the owner from the session and return identical 404s for foreign/missing ids. Driver endpoints scope every stop by the link's own route+season (`markStopDelivered` filters `where: { id: stopId, routeId, route: { seasonId } }`).
- **No raw SQL / no string-interpolated queries** anywhere — all data access is Prisma parameterized. No path traversal in media storage (bytes are keyed by a DB-issued `MediaAsset.id`, not a user-supplied filename).
- **Anti-enumeration** on login/register (one message per failure kind), **log-forging defense** on `client-error` (control chars stripped), **same-origin + rate-limit guard** on public state-changing routes (`checkout`, `checkout/quote`).
- **File-upload validation** is by magic-byte signature, not browser content-type (`lib/media.ts`); 5 MB cap.
- **Staff privilege changes kill live sessions** in the same transaction (`app/api/staff/[id]/route.ts`).

---

## Findings

### M1 — In-memory rate limiter is per-process (Medium)
`lib/rate-limit.ts` keeps the fixed-window map in module memory. Under any multi-instance runtime (Vercel serverless functions, >1 container) each instance maintains its own map, so the *effective* limit is `limit × instance_count`. The brute-force protections that depend on it are:

- Staff login: 20/IP and 10/account per 15 min (`app/api/auth/login/route.ts`).
- Customer login: 20/IP and 10/account per 15 min (`app/api/account/login/route.ts`).
- Driver PIN: 20/IP per minute (`app/api/d/[token]/pin/route.ts`) — note the DB-side per-link lockout (5 tries → 15 min) still holds regardless, so this is the weaker of the two.
- Registration, repeat, draft-save, autocomplete, client-error, newsletter.

The code comments acknowledge this ("swap for a shared store before horizontal scaling"), but `lib/env.ts` already targets Vercel for production, where multi-instance is the default. A shared store (Upstash/Vercel KV) is needed before this control actually delivers its advertised limits in prod.

### M2 — Public auth endpoints lack the same-origin guard (Medium)
`guardPublicEndpoint` (same-origin + rate-limit) is applied to `checkout` and `checkout/quote`, but **not** to:

- `app/api/auth/login/route.ts` (staff login)
- `app/api/account/login/route.ts` (customer login)
- `app/api/account/register/route.ts` and `app/api/account/register/complete/route.ts`
- `app/api/newsletter/subscribe/route.ts`

These rely on rate-limit only. `SameSite=Lax` session cookies block cross-site *form POSTs* (so a classic CSRF that exploits the staff cookie is not viable), and login itself isn't CSRF-sensitive, so this is not directly exploitable as CSRF. The residual risk is that a cross-origin site can drive POSTs to these endpoints (e.g. newsletter list poisoning, triggering verification emails) as long as it stays under the per-IP limit. Inconsistent posture with the checkout routes that *do* guard origin.

### M3 — `staff.impersonate` grants full manager-equivalent power (Medium, design)
`app/api/impersonate/route.ts` lets any holder of the `staff.impersonate` permission impersonate **any** `ACTIVE` staff member, including a `MANAGER` (`MANAGER` resolves to `ALL_PERMISSIONS`). The role defaults in `lib/auth/permissions.ts` give `staff.impersonate` only to `MANAGER`, but the override system can grant it to a `STAFF` or `DRIVER`. If an operator ever grants that override, the recipient can act as any manager with every permission — a one-step privilege escalation that is fully audited but not prevented. Worth a guardrail: forbid impersonating *above* the actor's own role, or restrict the target set to ≤ the actor's role.

### M4 — Setup bootstrap endpoint has no rate limit and no same-origin guard (Medium, low-impact window)
`app/api/setup/route.ts` POST (first-manager bootstrap) is reachable by anyone, with no `guardPublicEndpoint` and no rate limit. The transactional `staffCount > 0` lock makes the window narrow (only before first setup) and prevents multiple managers, but during that window an attacker can drive unlimited bootstrap attempts from a bot. Low likelihood in practice (the window is once, at deploy time) but the endpoint is the one place a password is set with zero throttling. Adding the standard rate-limit + same-origin guard would close it.

### M5 — `SESSION_SECRET` minimum length is 16 characters (Medium)
`lib/env.ts` enforces `SESSION_SECRET` min 16 chars and rejects two known-public placeholder values. 16 characters is below the recommended 32 bytes for an HMAC key that signs every staff *and* customer session, the registration tokens, the newsletter tokens, and the driver link/PIN cookies — all keyed by the same `SESSION_SECRET`. A low-entropy 16-char secret is within offline-brute-force range if the hashed token store ever leaks. Recommend ≥32 bytes (the error message already suggests `openssl rand -hex 32`, but the schema doesn't require it).

---

### L1 — Middleware dev gate checks cookie presence only (Low)
`middleware.ts` `devSessionGate` only checks that `tomchei_session` *exists*. Setting any value for that cookie passes the edge gate and renders the `/admin/*` shell. The comment is explicit that real validation happens server-side in `requirePermissionPage`/`requirePermissionApi`, and indeed every admin page/API does, so the worst case is rendering the empty admin layout (no data). Defense-in-depth gap only.

### L2 — `clientIp` takes the LAST `X-Forwarded-For` hop (Low)
`lib/rate-limit.ts` reads `chain[chain.length - 1]` when `TRUST_PROXY` is set. For a single-tier proxy (Vercel's default) this is the real client IP and the comment's reasoning holds. If a deploy ever sits behind more than one proxy (CDN → Vercel, or a self-hosted chain), the last hop becomes an intermediate, not the client, and rate-limit keys collapse. The standard convention is the *leftmost* untrusted hop. Document the single-proxy assumption or take the leftmost hop.

### L3 — Account-order detail page asserts non-null customer context (Low)
`app/(storefront)/account/orders/[id]/page.tsx:18` uses `const customer = (await getCustomerContext())!;`. If the customer cookie is absent/expired, `customer` is `null`, the non-null assertion is unsound, and the next line (`order.customerId !== customer.id`) throws a `TypeError` → 500 instead of a clean redirect to `/signin`. The `/account` layout normally redirects first, so this is a defense-in-depth gap. Use `notFound()` / redirect when `customer` is null.

### L4 — Newsletter subscribe allows list poisoning (Low)
`app/api/newsletter/subscribe/route.ts` upserts `SUBSCRIBED` for any supplied email and returns `{ ok: true }` with no token. Rate-limited at 5/min/IP. An attacker can add arbitrary addresses to the subscriber list (the management/unsubscribe token is only ever sent *by email* later, so this doesn't mint tokens). Still, it lets a third party subscribe addresses that never asked to be subscribed. Consider opt-in confirmation before `SUBSCRIBED`.

### L5 — Test-email and campaign test-send accept arbitrary recipients (Low)
`app/api/admin/email/test/route.ts` and `app/api/admin/email/campaigns/[id]/test-send/route.ts` send to any `email()`-valid address supplied by the caller. Both are permission-gated (`settings.manage` / `email.manage`) and audited, and the campaign test-send uses a neutral "Test Recipient" display name. Residual: a holder of either permission can use the org's sender to mail arbitrary external addresses (potential abuse as a low-volume phishing relay using the org's domain reputation). Acceptable for an internal tool; worth a allowlist or a confirm step for external addresses.

### L6 — Registration race on the fresh-email branch (Low)
`app/api/account/register/route.ts` checks `db.customer.findUnique({ where: { email } })`, then in the `!existing` branch calls `findOrLinkCustomer(...)` and separately `db.customer.update({ where: { id: customer.id }, data: { passwordHash, name } })`. Between the check and the create, a concurrent registration for the same email can create the row; `findOrLinkCustomer` will then return that row and the second writer overwrites the first `passwordHash`. Two customers registering the same brand-new email simultaneously could clobber each other's password. Extremely narrow window; both used the same email. A unique constraint plus upsert-on-create, or a single transaction, would remove it.

### L7 — `verify-email` page reflects the token's email in the page (Low, informational)
`app/(storefront)/verify-email/page.tsx` renders `Choose a password for {email}` where `email` is decoded from the signed token. The email only reaches the token via staff/guest entry that validated it as an email address, and React escapes it, so there is no injection. Noted only because reflecting server-provided strings is a habit worth keeping conscious of.

---

## Notes / out of scope

- **Driver magic links** are 32 random bytes, HMAC-hashed, with rotation revoking prior links and optional 4-digit PIN with DB-side lockout. The URL token is the credential by design; PIN adds a second factor for PIN-protected links. No residual.
- **`/dev/stripe-checkout`** and **`/api/dev/stripe-checkout`** are mock-only and 404 when a live Stripe key is configured (`getPaymentGateway().mode !== "mock"`). No residual.
- **Test-console** wipe/seed routes 404 outside `isTestMode()` and are `settings.manage`-gated. No residual.
- **Cron endpoints** all call `requireCronAuth` (verified for all 6 routes under `app/api/cron/*`); fail-closed to 503 without `CRON_SECRET`. No residual.
- **Impersonation** is audited on start and stop (`app/api/impersonate/route.ts`); `actingAs` is the impersonated user, `realUser` is preserved, and audit logs record `(impersonating …)`. The residual is the privilege caveat in M3, not the audit trail.

---

## Bottom line

The post-fix tree has no High-severity security residuals. Auth, secrets, webhook authenticity, IDOR scoping, and the money path are implemented with fail-closed guards and consistent ownership checks. The Medium findings (M1–M5) are hardening gaps — the most operationally relevant is **M1 (per-process rate limiter under multi-instance prod)**, which silently weakens every brute-force control the codebase advertises. **M3 (impersonation scope)** is the one design-level item worth an explicit policy decision. The Low findings are defense-in-depth polish.
