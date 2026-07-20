# Security review — P6, arm-01 (blind)

**Phase:** P6 — Admin operations hub & POS (`shared/phases/PHASE-P6-EXPECTED.md`)
**Tree:** `arms/arm-01/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 4 |
| Low | 4 |
| Info | 1 |

## Findings

### H1 — Stripe refund issued before DB transaction commits (financial integrity)
`src/app/api/admin/orders/[orderId]/refunds/route.ts:40-83`
`stripe.refunds.create(...)` runs **before** the `db.$transaction` that records the refund on the `Payment` row. The transaction can fail (the `updateMany ... refundedCents` guard returns `count !== 1` on concurrent refund, yielding a 409 with `outcome === null`). In that path Stripe has already debited the refund, but the local `Payment.refundedCents` and cached payment status are never updated and no audit row is written. Result: customer is refunded externally while the system reports the original paid amount — a financial discrepancy with no compensation/rollback path. The idempotency key `admin-refund:${payment.id}:${payment.refundedCents}:${amountCents}` also changes once `refundedCents` mutates, so a retry can issue a **second** real Stripe refund against the same intent.

### M1 — Audit trail exposed under `admin:view` instead of `audit:view`
`src/app/(admin)/admin/audit/page.tsx:7`, `src/app/(admin)/admin/page.tsx:11-16`, `src/app/(admin)/admin/orders/[orderId]/page.tsx:22-31`
The `audit:view` permission is declared in `lib/permissions.ts` but enforced **nowhere**. The audit page, the overview "Recent security activity" panel, and the order-detail audit trail all gate only on `admin:view` — which `STAFF` holds. A staff user can read the newest 200 audit events (impersonation start/stop, `payment.refunded`, `settings.storefront_updated`, import commits) including `actorStaffId` and `targetId`, defeating the least-privilege separation the permission list implies.

### M2 — Guest draft rate limit keyed on spoofable `X-Forwarded-For`
`src/app/api/order/drafts/route.ts:17-41`
`enforceGuestDraftLimit` derives the throttle key from `x-forwarded-for`'s first hop (falling back to `x-real-ip` or `"unknown"`). The header is client-controllable in any deployment that does not strip/overwrite it at a trusted proxy, so an attacker can rotate the header to bypass the 10/min guest-draft limit and create unbounded guest `Customer` + `Order` rows (data pollution / DoS) and burn the `randomInt` draft-reference space. `"unknown"` is also a single shared bucket for any request missing the header.

### M3 — Bulk-repeat authorized by `admin:view`
`src/app/api/admin/orders/bulk-repeat/route.ts:15`, `src/lib/admin-operations.ts:128-217`
`repeatOrders` creates up to `MAX_BULK_ORDERS` (50) draft orders in arbitrary customers' names, copying totals, line items, and add-ons. It only requires `admin:view`, so any `STAFF` user can mass-generate drafts against any finalized order in the system. Given the financial weight (copied totals, recipient snapshots) this is closer to a `payments:manage` / manager action than a view action.

### M4 — Impersonation cookie is a raw session id with no expiry on the row
`src/app/api/admin/impersonation/route.ts:30-57`, `src/lib/auth.ts:76-95`
The `impersonation_session_id` cookie stores the bare `ImpersonationSession.id` (a cuid) with `maxAge: 1h`, `sameSite: "lax"`, path `/`. The session row has no `expiresAt`; revocation is only via `DELETE` setting `endedAt`. The lookup is correctly bound to `actorStaffId`, so theft alone is insufficient — but the cookie is sent to **every** route (path `/`), including storefront, and any cookie exfiltration within the 1h window yields a long-lived handle. No rotation on privilege change, no server-side expiry.

### L1 — `deliveryZips` / admin settings strings unbounded
`src/app/api/admin/settings/route.ts:29-39`, `src/lib/store-settings.ts:32-44`
`saveDeliveryZips` accepts any string array with only `trim()`/dedupe; `saveAdminSettings` validates `followUpDays` range and `trim()` non-empty on three strings but imposes **no max length** on `emailSenderName`/`operationsAlert`/`developerWebhookLabel`. A manager can store arbitrarily large strings in `AppSetting.value`. `operationsAlert` is rendered in the admin layout banner (React-escaped, so no XSS), but unbounded JSON storage is a mild DoS / integrity gap. ZIPs are also not validated as ZIPs, so the delivery allowlist can be polluted with arbitrary tokens.

### L2 — Offline payment amount has no upper bound vs. order total
`src/app/api/admin/orders/[orderId]/payments/route.ts:32-83`
`postPaymentSchema` only requires `amountCents` to be a positive integer; there is no check against `order.totalCents` or the remaining balance. A `payments:manage` actor can post a cash/check payment exceeding the order total, producing a negative balance / overpaid state that flows into `recalculatePaymentStatus` and the audit metadata. Refund route correctly caps against `refundableCents`; the post route does not.

### L3 — Import commit has no re-validation / no P2002 handling
`src/app/api/admin/imports/[batchId]/commit/route.ts:31-85`
Between stage and commit the route re-reads stored rows and calls `createMany` without re-checking for duplicates that another user may have inserted in the window. A unique-constraint violation (`P2002`) is not caught here (unlike the customers POST route), so a race surfaces as an unhandled 500 rather than a 409. No data corruption, but a reliability/audit gap on a `settings:manage` atomic path.

### L4 — Test-auth path trusts `Host` header for localhost gate
`src/lib/auth.ts:35-57`
`getAuthenticatedClerkUserId`'s local test branch admits the request when `host` (split on `:`) is `127.0.0.1` or `localhost`. Behind a proxy that forwards a client-influenced `Host` header, the localhost gate could be satisfied remotely. The branch is additionally gated by `NODE_ENV !== production && ENABLE_TEST_AUTH === true` and an HMAC signed with `TEST_AUTH_SECRET`, so exploitability requires a misconfigured proxy **and** a leaked secret — hence Low/Info.

### I1 — CSRF relies on JSON content-type preflight, no explicit token
All state-changing admin routes (`bulk-repeat`, `imports`, `imports/[batchId]/commit`, `settings` PATCH, `refunds`, `payments` POST/PATCH, `impersonation` POST/DELETE, `customers` POST) authenticate via cookies (Clerk session + impersonation cookie) with no CSRF token. They consume `application/json`, which forces a CORS preflight that blocks simple cross-site submission, so practical CSRF risk is low. Noted only because the impersonation `DELETE` and any future form-accepting route would not enjoy the same implicit protection.

## Out of scope (noted, not findings)
- Customer directory/detail exposing PII to `admin:view` — required by P6 §4.
- `listOrders` / customer search using Prisma `contains` — parameterized, no injection.
- CSV parser splitting on `\r?\n` before unquoting (no embedded-newline handling) — correctness, not security.
