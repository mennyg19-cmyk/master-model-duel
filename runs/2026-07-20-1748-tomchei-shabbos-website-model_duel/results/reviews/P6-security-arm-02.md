# P6 Security Review — arm-02 (blind)

**Phase:** P6 — Admin operations hub & POS (`shared/phases/PHASE-P6-EXPECTED.md`)
**Tree:** `arms/arm-02/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.
**Reviewer focus:** permission-aware admin dashboard, order list/detail + money actions + Stripe refund, POS (cash/check, no public POS payments), customer directory + detail + order history, staged atomic CSV import, settings hub, bounded list queries + bulk actions.

## Summary

Auth model is solid: DB-backed HMAC session tokens, per-route `requirePermissionApi`/`requirePermissionPage` gates, role + override resolution, ownership checks on customer-facing endpoints, signature-verified Stripe webhook with idempotency ledger, charged-amount safety + auto-refund, magic-byte media validation, and atomic audited writes. Findings below are hardening / audit-completeness gaps, not direct bypasses.

## Findings

### SEC-01 — Bulk order actions write one aggregate audit row, not per-order (Medium)
`app/api/admin/orders/bulk/route.ts:33-49`
`finalizeOrder`/`discardOrder` in `lib/domain/finalize.ts` do not write audit themselves. The single-id routes (`orders/[id]/finalize`, `.../discard`) write a per-order `AuditLog` row with `targetId`. The bulk path calls `finalizeOrder(id)`/`discardOrder(id)` per id but writes only ONE aggregate row: `detail: { requested, done, skipped }` — no `targetId`, no id list. Individual orders finalized/discarded via bulk are not attributable per-order in the audit trail. For money-adjacent state transitions this breaks per-target auditability; the audit log cannot answer "who bulk-finalized order X".

### SEC-02 — Edge middleware is cookie-presence-only and does not cover `/api/admin/*` (Low)
`middleware.ts:6-22`
`devSessionGate` only checks `request.cookies.has("tomchei_session")` — any value (even `x`) passes the edge gate. The matcher is `["/admin/:path*", "/driver/:path*"]` and excludes `/api/admin/*`, so admin API routes have no edge gate at all and rely entirely on `requirePermissionApi` (which does DB validation). Page handlers re-check, so this is defense-in-depth only, but the edge layer provides no real authentication and gives a false sense of a perimeter.

### SEC-03 — `requirePermissionApi` discloses the exact missing permission name (Low)
`lib/auth/current-user.ts:66-73`
A 403 returns `Missing permission: ${permission}` (e.g. `payments.refund`). This tells an authenticated-but-underprivileged caller exactly which permission to seek/escalate. A generic "Forbidden" would leak less.

### SEC-04 — Mock webhook secret is a public repo constant; mock-mode webhook is forgeable (Low)
`lib/env.ts:5`, `lib/payments/webhook-verify.ts`, `app/api/webhooks/stripe/route.ts:44-48`
`DEV_WEBHOOK_SECRET = "whsec_dev_mock_secret"` is committed. `env.ts` correctly refuses real mode (`STRIPE_SECRET_KEY` set) with this default and refuses production without a real key. But any non-production deployment running mock mode (no `STRIPE_SECRET_KEY`, `NODE_ENV !== "production"`) accepts webhook events signed with the public default. Anyone who can reach the endpoint can forge `checkout.session.completed` / `charge.refunded` and drive the money state machine (post payments, finalize orders, sync refunds). Mock mode moves no real money, but it can mark orders paid/finalized. Acceptable for local dev; risky if a mock-mode instance is ever exposed.

### SEC-05 — `/api/dev/stripe-checkout` lets any caller complete/mock-pay any session (Low)
`app/api/dev/stripe-checkout/route.ts:22-33`
Mock-only (404s when Stripe is configured) and accepts an optional `amountCents` override to exercise the charged-amount safety path. In mock mode it is unauthenticated and looks up the session purely by `sessionId` (exposed in the mock checkout URL). Any caller who learns a session id can "pay" for / finalize any order, or simulate a mismatch to trigger auto-refund. Intended as test infrastructure; the risk is only if a mock-mode deployment is publicly reachable.

### SEC-06 — POS checkout payment amount has no upper bound (Low)
`app/api/admin/pos/checkout/route.ts:22-26`
`payment.amountCents` is `z.number().int().min(1).optional()` with no `max`, unlike the per-order payments route (`payments/route.ts:11`) which caps at `10_000_000`. Staff-gated (`orders.manage` + `payments.record`) and offline money only, so overpaying just creates a positive balance — but the inconsistency with the sibling route is a defense-in-depth gap.

### SEC-07 — `season-status` PATCH does not audit the auto-closed seasons (Low)
`app/api/admin/season-status/route.ts:24-37`
Opening a season closes every other OPEN season via `updateMany`, but only the target season is audited. The side-effect closures (which remove the open store for those seasons) leave no audit entry; the audit log cannot show who/when closed them.

### SEC-08 — Media serve route is unauthenticated and lacks `X-Content-Type-Options: nosniff` (Low)
`app/media/[id]/route.ts:14-19`
Publicly serves any locally-stored asset by id (intended — product images). Asset ids are unguessable (cuid) and `Content-Type` is always a real image type from magic-byte detection, so XSS via sniffing is unlikely, but the missing `nosniff` header is a hardening gap; a polyglot image served without `nosniff` could be mis-sniffed by older browsers.

### SEC-09 — `staff.impersonate` has no protection against targeting a same/higher-privilege user (Informational)
`app/api/impersonate/route.ts:22-27`
Only `staff.impersonate` (MANAGER-only via role defaults) and `target.status === "ACTIVE"` are checked. A manager can impersonate another manager. No escalation occurs (managers already hold all permissions) and the real user is recorded in every audit row, so this is by-design — noted only because impersonating a peer manager is a powerful action with no extra confirmation/limit.

### SEC-10 — Admin API mutation routes have no rate limiting (Informational)
`app/api/admin/**` (bulk, refund, payments, void, import, season-status, staff, impersonate)
`guardPublicEndpoint`/`rateLimit` is applied to public endpoints (checkout, login, register) but no admin mutation route is rate-limited. A compromised staff session or a CSRF-like burst (admin routes use cookie auth, same-site=lax) could hammer refund/import/bulk endpoints without throttling. Staff are trusted and same-origin is enforced on public routes only, so this is informational.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 7 |
| Informational | 2 |
| **Total** | **10** |

## Out of scope (noted, not scored)
- P7+ surfaces (package board, greeting cards, Shippo, driver magic links, repeat-order replacement) — not present in this tree.
- Real Stripe key handling — env guards in `lib/env.ts` are correct; no real keys in the harness.
