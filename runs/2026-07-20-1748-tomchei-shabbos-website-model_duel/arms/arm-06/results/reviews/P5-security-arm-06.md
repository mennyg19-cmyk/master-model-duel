# P5 Security Review — arm-06 (blind)

**Phase:** P5 — checkout, delivery fees, Stripe hosted checkout, POS, order lifecycle
**Scope:** `arms/arm-06/workspace/` (lib/checkout, lib/payments, lib/orders, app/api/checkout, app/api/webhooks/stripe, app/api/admin/orders, app/api/admin/payments)
**Method:** Findings only — no fixes. Blind to model identity.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 4 |

## Major

### M-1 — Stripe capture on an already-finalized order is not auto-refunded (double payment)
`lib/checkout/checkout.ts` `completeCheckoutSession` (lines 308–310):

```308:310:arms/arm-06/workspace/lib/checkout/checkout.ts
  if (order.status === "FINALIZED") {
    return { outcome: "duplicate", orderId: order.id, orderNumber: order.orderNumber ?? undefined };
  }
```

When the POS path finalizes a draft (cash/check) while a customer's hosted Stripe session is still open, the customer can still complete the Stripe checkout. Stripe fires `checkout.session.completed`, the webhook reaches `completeCheckoutSession`, finds `order.status === "FINALIZED"`, and returns `outcome: "duplicate"` — **without** refunding the captured charge. The order is paid twice (POS cash/check + Stripe card), and the Stripe money is stranded with no order movement and no audit row. Compare with the `DISCARDED`/non-DRAFT branch below it, which calls `safetyRefund`. The FINALIZED branch is missing the same safety refund.

### M-2 — POS finalize does not invalidate an active Stripe session (root cause of M-1)
`lib/checkout/checkout.ts` `finalizePosOrder` (lines 407–435) commits stock and finalizes a DRAFT order but never clears `order.stripeSessionId` and never refuses when a hosted Stripe session is live for that draft. A staff member can POS-finalize a draft the customer is mid-checkout on, leaving the Stripe session completable against a now-FINALIZED order (the M-1 race). The web `submitCheckout` path explicitly releases the reservation and clears `stripeSessionId` on edit; the POS path has no equivalent guard.

## Minor

### m-1 — `safetyRefund` releases the reservation before attempting the Stripe refund
`lib/checkout/checkout.ts` (lines 272–297): `releaseOrderReservation` runs first, then `createRefund`. If `createRefund` throws (Stripe API outage, merchant balance insufficient), the catch in `app/api/webhooks/stripe/route.ts` deletes the idempotency row and returns 500 so Stripe retries — and the retry is safe because `releaseOrderReservation` is idempotent and `createRefund` uses an idempotency key. But a *persistent* refund failure (not a transient one) leaves the original charge captured while the order is back in DRAFT with `stripeSessionId` cleared and stock released — the customer can re-submit and re-pay, producing a second captured charge with the first still outstanding. No alerting or dead-letter row exists for a refund that keeps failing.

### m-2 — Audit writes for payment void/refund run outside the engine transaction
`lib/checkout/checkout.ts` `syncChargeRefunded` (lines 392–399) and `safetyRefund` (lines 283–296), and the POS routes (`app/api/admin/payments/[paymentId]/void/route.ts`, `app/api/admin/orders/[orderId]/payments/route.ts`), all call `recordAudit` *after* the `$transaction` that mutated the payment commits. A process crash between commit and audit leaves a voided/refunded payment with no audit trail. For payment mutations the audit row is the durable regulatory record; it should be inside the same transaction (as `finalizePosOrder`'s caller does for `order_finalize`, but not for the payment verbs).

### m-3 — Dev-auth bypass is open on Vercel preview deployments
`lib/env.ts` (lines 31–32): `isDevAuthBypass = env.DEV_AUTH_BYPASS === "true" && !isProductionDeploy`, where `isProductionDeploy = process.env.VERCEL_ENV === "production"`. On a Vercel preview deployment (`VERCEL_ENV === "preview"`) with `DEV_AUTH_BYPASS=true` in the env, `/api/dev-auth` and `/api/dev-auth-customer` are live on a public URL — anyone who knows a `staffUserId` / `customerId` (UUIDs, but static per environment) can mint a session. The guard should additionally require `VERCEL_ENV === "development"` or an explicit non-public allow flag. The `.env` in this workspace ships with `DEV_AUTH_BYPASS="true"`.

### m-4 — `safeEqual` short-circuits on length mismatch (timing length oracle)
`lib/hmac.ts` (lines 32–39): `if (a.length !== b.length) return false;` before the byte-wise constant-time loop. This leaks the expected HMAC length via timing. Practical impact is low because every HMAC consumer here produces a fixed-length base64url output (session codec, guest token, newsletter token, Stripe webhook v1), and the expected length is derivable from the algorithm — so the oracle reveals nothing an attacker doesn't already know. Noted for completeness; the comparison itself is constant-time once lengths match.

## Notes (not findings)

- Webhook authenticity (raw-body HMAC, 5-min replay window, idempotency row, delete-on-fail for Stripe retry) is correct.
- Charged-amount safety check (`session.amount_total !== order.totalCents`) and session-id mismatch refund are correct on the non-FINALIZED paths.
- Anti-enumeration (404 on ownership miss, never 403) is consistently applied across drafts, checkout, and address book.
- Stock reservation uses `SELECT ... FOR UPDATE` row locks; the conditional `updateMany` guards on finalize/discard prevent double-claim of order numbers.
- Same-origin guard, per-IP rate limits, and Zod validation are present on all public mutation endpoints as required by R-122.
- `.env` is gitignored and untracked (confirmed via git status); no secret commit leak.
