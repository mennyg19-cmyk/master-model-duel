# Residual Security Review — arm-03 (Test 5, post self-fix)

Reviewer: external residual reviewer (security)
Scope: trust boundaries, authentication, secrets, IDOR, injection
Tree reviewed: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/workspace` (on-disk, post self-fix)
Mode: findings only — no fixes proposed or applied.
Date: 2026-07-22

## Summary

The post-fix tree is, on the whole, defensively built: HMAC-signed session/registration/newsletter tokens with `timingSafeEqual` verification, fail-closed environment validation (`lib/env.ts`) that refuses public default `SESSION_SECRET`/`STRIPE_WEBHOOK_SECRET` in real mode and requires `TRUST_PROXY` + `STRIPE_SECRET_KEY` in production, Stripe webhook signature verification with an idempotency ledger and charged-amount safety + auto-refund, per-route permission gates (`requirePermissionApi`/`requirePermissionPage`) with RBAC + overrides, ownership-enforced customer/address routes (foreign ids return a uniform 404), magic-byte image validation for uploads, parameterized Prisma queries (no string-interpolated SQL observed), and audited, transactional mutations for sensitive actions.

Two High-severity residual defects remain. Both are authn/authz bypasses introduced (or left) in the post-fix tree.

## Findings

### S-01 [HIGH] — Driver PIN second factor is dead-coded bypassed

File: `lib/routes/driver-access.ts:23`

```ts
if (access.link.pinHash && false) {
  // ...PIN cookie verification that never runs...
}
```

The PIN gate condition is `access.link.pinHash && false`, which is always `false`. The entire PIN-verification block — which checks the `pinCookieValid` cookie and returns `pin_required` when the browser has not passed the gate — never executes. Every driver API route (`app/api/d/[token]/*`: `start`, `stops/[stopId]/delivered`, etc.) routes through `resolveDriverAccess`, so for any PIN-protected magic link the PIN is never enforced.

Impact: the PIN exists (UR-015) as a second factor for the leaked-link threat model (a printed route sheet, forwarded SMS, or otherwise leaked magic-link URL). With this bypass, anyone who obtains the magic-link token alone can start the route and mark every stop delivered — i.e., mark orders as delivered that were not, defrauding customers and the ledger. The `/api/d/[token]/pin` route still issues the PIN cookie, but it is decorative. The underlying token (`loadLinkByToken`) remains unguessable, so this requires link leakage; the PIN was precisely the control for that case.

Severity: High. Authentication-bypass of a declared second factor on the delivery/finalization path.

### S-02 [HIGH] — Impersonation has no privilege-escalation guard

File: `app/api/impersonate/route.ts` (POST), with effect in `lib/auth/current-user.ts:42`

The impersonation endpoint requires `staff.impersonate` and prevents self-impersonation and impersonation of inactive/nonexistent targets, but it performs **no role-rank / “strictly lower privilege” check on the target**. `getStaffContext` then resolves the effective context to the target and uses the **target’s** permissions (`actingAs.permissions = resolvePermissions(target.role, target.permissionOverrides)`).

Consequence: any holder of `staff.impersonate` can impersonate any other staff member, including one of higher privilege, and inherit that user’s full permission set for the duration of the session.

- `MANAGER` (which has `staff.impersonate` by default) can impersonate any other `MANAGER` — lateral takeover of another manager’s identity and permissions.
- If a `STAFF` user is granted `staff.impersonate` via a `GRANT` override (`lib/auth/permissions.ts:resolvePermissions`), that user can impersonate a `MANAGER` and acquire **all** permissions (`ROLE_DEFAULTS.MANAGER = ALL_PERMISSIONS`) — vertical privilege escalation to full admin.

The action is audit-logged (`staff.impersonation_start` with the target email), but auditing does not prevent the escalation; the impersonator gains the target’s authority first, then the row is written. The stale `src/` tree contained a `canImpersonate` role-rank enforcement that was dropped in the post-fix tree.

Severity: High. Broken access control / privilege escalation via impersonation.

### S-03 [MEDIUM] — Same-origin guard fails open (contradicts its own comment)

File: `lib/public-guard.ts:10-22`

```ts
/** Same-origin check via Origin (fall back to Referer). Requests with neither header are refused. */
export function isSameOrigin(request: Request): boolean {
  const allowed = new URL(env.APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === allowed;
  const referer = request.headers.get("referer");
  if (referer) { try { return new URL(referer).origin === allowed; } catch { return false; } }
  return true; // BUG: This line should be `return false;` (fail-closed)
}
```

When both `Origin` and `Referer` are absent, `isSameOrigin` returns `true`, the opposite of the docstring (“Requests with neither header are refused”). `guardPublicEndpoint` is applied to the public state-changing routes `app/api/checkout/route.ts` and `app/api/checkout/quote/route.ts`.

Mitigating context: browser CSRF against these routes is largely already contained — session/guest cookies are `sameSite=lax` (`lib/auth/session.ts`, `lib/order-builder/draft-store.ts`) and browsers send `Origin` on cross-origin POSTs, so a real cross-site browser request still presents a mismatched `Origin` and is blocked. The fail-open is reachable mainly by non-browser / header-stripping clients, which cannot carry a victim’s cookie as a CSRF payload; they fall back to the per-IP rate limit, which collapses to a single shared `"direct"` bucket when `TRUST_PROXY` is unset (`lib/rate-limit.ts:clientIp`).

Severity: Medium. The declared fail-closed CSRF posture is not implemented; defense-in-depth gap rather than a directly exploitable victim-CSRF given the cookie posture.

### S-04 [LOW] — Newsletter subscription accepts arbitrary emails with no verification or origin check

File: `app/api/newsletter/subscribe/route.ts`

The subscribe endpoint upserts `SUBSCRIBED` for any supplied email with no confirmation email and no same-origin guard; only a per-IP rate limit (5/min) applies. A caller can subscribe arbitrary victim addresses to the mailing list (list pollution / unsolicited mail). The management/unsubscribe tokens are correctly HMAC-signed and are not returned here, so this does not enable token forgery — only unverified list growth.

Severity: Low. Privacy/abuse issue; rate-limited; no token exposure.

### S-05 [LOW] — First-manager bootstrap race does not guarantee a singleton

File: `app/api/setup/route.ts` (POST)

The count-then-create runs inside a `db.$transaction`, but at default isolation the `tx.staffUser.count()` read does not prevent two concurrent bootstrap requests (with different emails) from both creating a `MANAGER` before any staff exists. There is no email-agnostic unique constraint to fall back on (different emails avoid the `email` unique constraint). The transaction therefore does not deliver the singleton guarantee the comment claims. The window is narrow (only before the first manager exists) and self-closing once one exists.

Severity: Low. Exploitable only in the pre-first-manager window; requires concurrent requests.

### S-06 [LOW] — Rate limiter is per-process (latent under horizontal scaling)

File: `lib/rate-limit.ts`

The fixed-window limiter is in-process `Map` state, documented as single-node-only. Under horizontal scaling the login/checkout/newsletter/register brute-force and abuse limits collapse (each node gets its own bucket). `lib/env.ts` already requires `TRUST_PROXY=true` in production so that `clientIp` resolves a real per-client key, but the limiter store itself is not shared, so a multi-node deploy would not enforce the configured limits globally. Not exploitable in the current single-node dev harness.

Severity: Low. Latent; only relevant if the deployment is scaled out.

### S-07 [LOW] — Dev-mode middleware gate is cookie-presence only

File: `middleware.ts` (`devSessionGate`), matcher `["/admin/:path*", "/driver/:path*"]`

In `AUTH_MODE=dev`, the edge gate for matched page paths only checks that a `tomchei_session` cookie **exists**, not that it is valid. A fabricated cookie passes the edge gate. This is defense-in-depth only: matched admin pages are server components that call `requirePermissionPage`, and all `/api/*` routes (excluded from the matcher by design, since the edge cannot reach the DB) enforce fully via `requirePermissionApi` → `readSession` (HMAC lookup, expiry, `ACTIVE` status, permission check). A fake cookie is therefore rejected at the page/API boundary. Note also the `/driver/:path*` matcher does not match the actual driver surface (`/d/[token]`), so it appears to be a stale path with no current effect.

Severity: Low. No real bypass given server-side enforcement; flagged for completeness.

## Areas reviewed and found sound (no findings)

- **Secrets / env**: `lib/env.ts` Zod validation with fail-closed production guards (public `SESSION_SECRET` defaults rejected in real mode; `STRIPE_WEBHOOK_SECRET` default rejected when `STRIPE_SECRET_KEY` set; production requires `STRIPE_SECRET_KEY`, `TRUST_PROXY`, `RESEND_API_KEY`/`EMAIL_TEST_MODE`; half-configured Shippo/Twilio refused). Cron disabled (503) without `CRON_SECRET`.
- **Session tokens**: HMAC-SHA256 keyed by `SESSION_SECRET`, random 32-byte tokens, httpOnly + sameSite=lax + secure-in-prod; sessions invalidated on role/status change (`app/api/staff/[id]`).
- **Registration / newsletter tokens**: `lib/auth/registration-token.ts`, `lib/newsletter-token.ts` — HMAC + `timingSafeEqual` + expiry; registration against an existing passwordless row requires email control before attaching a password (SR-01).
- **Stripe webhook**: signature verification, unique-event idempotency ledger with claim/processing-grace, charged-amount safety with full auto-refund on mismatch/stock-failure, retry-safe handlers (`app/api/webhooks/stripe/route.ts`).
- **Staff refund / void / POS payment**: permission-gated (`payments.refund` / `payments.record`), DB-first with stable idempotency keys, audited, transactional; void verifies `payment.orderId === id`.
- **Customer IDOR**: `app/api/account/addresses/[id]`, `app/api/account/profile` — ownership enforced from the session, no client-supplied customer id; foreign ids return a uniform 404. Drafts are cookie-owned with no client-supplied draft id (`lib/order-builder/draft-store.ts`), and assignment rules validate address-book ids against the owner’s book.
- **Driver stop scoping**: `markStopDelivered` queries `{ id: stopId, routeId, route: { seasonId } }` — stop id is bound to the link’s own route; no cross-route IDOR.
- **Uploads**: `lib/media.ts` — size cap + magic-byte image signature check (PNG/JPEG/GIF/WebP), filename sanitized, local files stored under a generated asset id (no path traversal), Vercel Blob path built from sanitized name.
- **Email rendering**: provider sends `text` only (`lib/email/provider.ts`), so unescaped template placeholders are not rendered as HTML — no email XSS surface.
- **SQL injection**: no string-interpolated SQL observed; audit list (`app/api/audit/route.ts`) uses `findMany`; imports/legacy use Prisma helpers and staged parsing.
- **Cron endpoints**: all bearer-authed via `requireCronAuth` (`lib/cron.ts`) with `timingSafeEqual` and fail-closed when `CRON_SECRET` unset; runs logged to `CronRunLog`.
- **Admin routes**: uniformly gated through `requirePermissionApi` / `adminHandler` (default `fulfillment.manage`, per-route overrides), with whitelisted dataset/setting/template keys and audit rows.

## Counts by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 1 |
| Low | 4 |
| **Total** | **7** |

High: S-01 (driver PIN bypass), S-02 (impersonation privilege escalation).
Medium: S-03 (same-origin fail-open).
Low: S-04 (unverified newsletter subscribe), S-05 (bootstrap race), S-06 (per-process rate limiter), S-07 (dev middleware cookie-presence gate).
