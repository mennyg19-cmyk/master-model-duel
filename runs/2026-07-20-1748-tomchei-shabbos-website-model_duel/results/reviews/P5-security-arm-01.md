# P5 Security Review — arm-01 (blind)

**Phase:** P5 — Checkout, Stripe hosted, order lifecycle, payments
**Scope:** `arms/arm-01/workspace/` P5 surface only. Findings only — no fixes.

## Findings

### HIGH-1 — Stripe `success_url`/`cancel_url` derived from request `Host` header (open redirect / phishing)
`src/app/api/checkout/stripe/route.ts:145-166` builds `requestUrl.origin` from `request.url`, whose host is the client-sent `Host` header. `guardPublicWrite` only checks `originHost === host` — both are attacker-controlled on a direct connection (no trusted proxy overwriting Host). An attacker who reaches the app directly can set `Host: evil.com` + `Origin: https://evil.com`, pass the guard, and have Stripe redirect paying customers to `https://evil.com/account/orders/...?paid=1` after capture. No server-trusted base URL is used.

### HIGH-2 — Public rate limit keyed on spoofable `x-forwarded-for` / `x-real-ip`
`src/lib/public-request.ts:29-33` and `src/app/api/order/drafts/route.ts:17-19` derive the throttle key from `x-forwarded-for` (first entry) or `x-real-ip`, falling back to `"unknown"`. Both headers are client-controllable when no trusted proxy normalizes them. An attacker can rotate `X-Forwarded-For` per request to bypass the 30/min checkout limit and 10/min guest-draft limit — the spec requires "rate limit" as a public endpoint guard (P5 §5).

### MEDIUM-1 — `charge.refunded` / `payment_intent.payment_failed` lack in-transaction idempotency
`src/app/api/stripe/webhook/route.ts:103-139` checks `priorEvent` once at the top, then for refund/failed/unknown branches inserts `stripeWebhookEvent` in a separate transaction with no atomic dedup. Two concurrent deliveries of the same `event.id` both pass the prior-event check; the second insert fails on PK and returns 500 to Stripe (retry), or — for refunds — both proceed to void the payment before the insert, double-processing. Only `commitStripePayment` re-checks inside its serializable transaction; the refund/failed paths do not.

### MEDIUM-2 — Admin cash/check POS finalizes DRAFT without inventory reservation or snapshot preservation
`src/app/api/admin/orders/[orderId]/payments/route.ts:36-80` lets `payments:manage` staff finalize a DRAFT and assign `orderNumber` with no `SELECT ... FOR UPDATE`, no inventory reservation, and no `fulfillmentFeeCentsSnapshot` / `unitPriceCentsSnapshot` preservation. Spec P5 §6 requires "fulfillment price snapshots preserved" and §3 requires stock validation at checkout. The POS path bypasses both — a staff member can finalize an out-of-stock or stale-priced draft. Staff-trusted, but it breaks the stock-safety invariant the Stripe path enforces.

### MEDIUM-3 — Partial Stripe refund marks whole payment VOIDED and mis-derives order status
`src/app/api/stripe/webhook/route.ts:87-100` voids the entire `payment` row on any `charge.refunded` event regardless of refund amount. `recalculatePaymentStatus` (`src/domain/checkout.ts:329-352`) then recomputes from POSTED payments only and flags the order REFUNDED only if every intent is REFUNDED. A partial refund zeroes the payment, drops it from `postedCents`, and can flip a partially-refunded order to UNPAID/PARTIALLY_PAID incorrectly. Refund amount is never compared to the captured amount.

### LOW-1 — `constructStripeEvent` falls back to hardcoded placeholder Stripe key
`src/lib/stripe.ts:21` instantiates `new Stripe("sk_test_local_webhook_verification")` when `STRIPE_SECRET_KEY` is unset. Webhook verification only uses `STRIPE_WEBHOOK_SECRET` (which is still required), so functionally safe, but a placeholder secret string is committed to the repo and the client is constructed without a real key — code smell that could mask a misconfiguration in production.

### LOW-2 — `publicRequestErrorResponse` re-throws non-`PublicRequestError`
`src/lib/public-request.ts:56-61` re-throws unexpected errors instead of returning a sanitized 500. In dev this surfaces stack traces to the client; in any environment it lets unexpected errors propagate unhandled from the checkout/test-complete routes.

### LOW-3 — `recalculatePaymentStatus` runs outside the payment transaction
`src/app/api/admin/orders/[orderId]/payments/route.ts:81,131` calls `recalculatePaymentStatus(db, orderId)` after the transaction commits. A crash between commit and recalc leaves `cachedPaymentStatus` stale relative to the posted/voided payment rows.

## Severity counts
- Critical: 0
- High: 2
- Medium: 3
- Low: 3
- Total: 8
