# Reviewer specialist — Quality

**Arm:** arm-06 (blind)
**Tree / phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Output:** `results/reviews/P5-quality-arm-06.md`

Focus: correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P5-EXPECTED.md`.

## Verdict

All 8 EXPECTED items are implemented and the 38-check smoke (S1–S5) passes against the real webhook route with fixture-signed payloads. No Blockers. One Major race between POS finalize and the Stripe webhook leaves a captured card charge with no `Payment` row and no auto-refund. Three Minor issues.

## Findings

### Major

**M1 — POS finalize / Stripe webhook race loses the card payment record**
`lib/checkout/checkout.ts:407` (`finalizePosOrder`) does not check `order.stripeSessionId` before finalizing. A draft that the customer already submitted AND clicked Pay on (so `payCheckout` wrote `stripeSessionId` and a hosted Stripe session exists) is still DRAFT, so a staff member can POS-finalize it at the counter. The POS path commits stock and flips DRAFT → FINALIZED without posting any payment. When the real `checkout.session.completed` webhook then lands, `completeCheckoutSession` (`lib/checkout/checkout.ts:308`) sees `order.status === "FINALIZED"` and returns `{ outcome: "duplicate" }` — it posts no `Payment` and triggers no `safetyRefund`. Result: Stripe captured the card, the order has zero payments, `paymentStatus` stays UNPAID, and no audit records the captured charge. The existing test (`scripts/test-checkout.mts:388-403`) never creates a Stripe session before POS-finalizing, so the gap is uncovered. EXPECTED #6 (POS) and #4 (charged-amount safety + auto-refund) both assume the two paths never collide on the same submitted draft; nothing enforces that.

### Minor

**m1 — Client bulk-dedupe key diverges from the server**
`lib/checkout/fulfillment.ts:84` (`bulkAddressKey`) builds the dedupe key from `line1|city|region|postalCode|country` (lowercased, whitespace-normalized). `app/(storefront)/checkout/checkout-form.tsx:94` builds its display-only dedupe key from `normalizePostalCode(postalCode) + addressLine.toLowerCase()`. Two recipients sharing `line1`+`postalCode` but differing in `city`/`region` dedupe as the same destination on the client but as different destinations on the server (or vice versa). The server is authoritative and a mismatch surfaces as a 409 conflict, so this is display-only — but the customer can be shown a fee total that the server then refuses, with no indication why.

**m2 — Status doc misstates the test counts**
`arms/arm-06/workspace/.scratch/PHASE-P5-STATUS.md:24` claims "46 unit checks" in `scripts/test-p5.mts` and "44 DB checks" in `scripts/test-checkout.mts`. Actual counts are 38 `check(...)` calls in `test-p5.mts` and 50 in `test-checkout.mts`. Cosmetic, but it overstates unit coverage and understates DB coverage.

**m3 — Safety-refund audit row is conditional on the Stripe refund call succeeding**
`lib/checkout/checkout.ts:272` (`safetyRefund`) commits `releaseOrderReservation` in its own transaction, then calls `createRefund` (only when a secret key exists), then commits the `payment_auto_refund` audit row. If `createRefund` throws (Stripe API error / network), the audit is skipped and the reservation is already released. The webhook route's catch block deletes the idempotency row and returns 500 so Stripe retries, and the retry is idempotent on Stripe's side (`refund-${paymentIntent}`), so the audit eventually lands — but during a prolonged Stripe outage the safety event has no durable record while the reservation is already gone. Keyless deployments are unaffected (the audit is written immediately with a null refund id).

## Coverage vs EXPECTED

| # | Must be true | Verdict |
|---|---|---|
| 1 | Per-recipient fulfillment; bulk per-destination; per-package per-recipient + hard zip block | Met — `validateFulfillmentChoice` hard-blocks out-of-zone per-package only; bulk dedupe via `bulkAddressKey`; smoke S2a–S2d green |
| 2 | Greeting default + override + remembered per recipient | Met — `effectiveGreeting`/`normalizeGreeting`; `Address.lastGreeting` written at finalize (webhook + POS); smoke S1j green |
| 3 | Stock + price validation; conflict UI for stale totals | Met — `repriceAndCheckStock` returns 409 with fresh totals; conflict panel in `checkout-form.tsx`; smoke S3a–S3d green |
| 4 | Hosted Stripe Checkout; webhook authenticity + idempotency; charged-amount safety + auto-refund; refund sync | Met with M1 gap — HMAC verify + 5-min window + `StripeWebhookEvent` idempotency; `safetyRefund` on amount/session/reservation mismatch; `syncChargeRefunded` voids + recomputes; smoke S1g/S1k/S5c/S5d/S5e green |
| 5 | Guest tokens + draft ownership anti-enumeration; public guards | Met — `canAccess` 404-on-miss; `assertSameOrigin`, `checkoutRateLimit` (20/min), zod schemas; smoke S1l/S1n/S5f green |
| 6 | Staff-only cash/check POS posting + voiding with audit; snapshots preserved | Met with M1 gap — `payments.manage` gate; offline-only enum on POS; `order_finalize`/`payment_post`/`payment_void` audits; totals frozen at submit; smoke S4a–S4g green |
| 7 | Order lifecycle: finalize, discard, transitions, numbering, cached payment status | Met — conditional UPDATE + `claimOrderNumber` in-tx; `discardOrder` releases centrally; `recomputePaymentStatus` on every post/void/refund; smoke S5a/S5b green |
| 8 | Placeholder rate-resolution (live Shippo deferred to P8) | Met — `resolveDeliveryFeeCents` reads typed `delivery.fees`/`delivery.days`; settings Shipping tab edits them live; smoke S2e green |

## Severity summary

- **Blocker:** 0
- **Major:** 1
- **Minor:** 3
