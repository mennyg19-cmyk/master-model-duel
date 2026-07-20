# P5 Quality review — arm-02

**Reviewer specialist:** Quality
**Phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Tree:** `arms/arm-02/workspace/`
**Expected ref:** `shared/phases/PHASE-P5-EXPECTED.md`
**Smoke evidence:** `arms/arm-02/workspace/.scratch/PHASE-P5-SMOKE.md` (42/42 PASS) + `.scratch/p5-smoke-output.log`
**Mode:** blind to model name. Findings only, no fixes.

## Coverage summary

All 8 EXPECTED must-be-true items and S1–S5 smoke are implemented and exercised; CI green (`npm run ci`, 41 unit tests). Fee engine, webhook signature/idempotency, charged-amount safety + auto-refund, POS cash/check + void, order lifecycle transitions, sequential numbering, and cached payment status are all present and unit/smoke-tested. Findings below are correctness/edge concerns the smoke did not reach.

## Findings

### H1 — Webhook idempotency ledger commits before the money work (HIGH, correctness)

`app/api/webhooks/stripe/route.ts:45-52` inserts the `StripeWebhookEvent` row in its own auto-commit transaction, then runs `handleSessionCompleted` / `handleRefund` afterward. If the work throws (DB blip, OOM, anything) the route returns 5xx and Stripe retries — but the retry hits the already-committed event id, gets `P2002`, and returns `{replay:true}` as a no-op. The original event is then permanently lost: no payment, no finalize, no stock commit, no refund. For a payment webhook the idempotency record must be written in the same transaction as the work (or marked pending→done), not before it in a separate one.

### M1 — Charge double-counted when finalize fails after payment (MEDIUM, correctness)

`app/api/webhooks/stripe/route.ts:113-134`: on the happy path `postPayment` already records a positive STRIPE row for `session.amount_total`. If `finalizeOrder` then throws (stock ran out between checkout-open and webhook), the catch calls `autoRefund`, which at `lib/payments/post-payment.ts:174-192` records *another* positive `amountCents` row ("Charge received then auto-refunded") plus the negative refund row. Net effect on the books: two charge rows and one refund row for a single Stripe charge → `recalcPaymentStatus` sums to `+total` (PAID) on an order that was just discarded, and the ledger disagrees with Stripe's net 0. The `safe===false` path is correct (no prior `postPayment`); only the finalize-failure path double-books. Not covered by smoke (S5 only exercises the stale-session `safe===false` branch).

### M2 — Session marked `auto_refunded` even when the refund API call failed (MEDIUM, correctness)

`lib/payments/stripe.ts:169-197` `autoRefund` swallows `gateway.createRefund` failures with a `console.error` and returns. Both callers (`handleSessionCompleted` safe-false branch and finalize-failure branch) then unconditionally `db.stripeCheckoutSession.update({ status: "auto_refunded" })` and discard the order. The session row therefore claims a refund that never reached Stripe; the customer is charged with no refund and the only signal is a log line. Status should reflect "refund failed / needs manual" so ops can reconcile.

### M3 — `voidPayment` helper is dead code and diverges from the route (MEDIUM, dead code / drift)

`lib/payments/post-payment.ts:63-74` exports `voidPayment(paymentId, staffId)`, but no caller uses it — the admin void route (`app/api/admin/orders/[id]/payments/[paymentId]/void/route.ts:27-43`) does the void inline. The inline route also guards `payment.method === "STRIPE"` (refuse) and "already voided"; the unused helper does neither. Either route the handler through the helper (and add the guards there) or delete the helper — two void implementations will drift further.

### L1 — Out-of-zone recipient can default to a blocked delivery method (LOW, UX)

`components/checkout/checkout-form.tsx:49` picks `defaultMethodId` as the first PICKUP method, else `methods[0]`. If the first method by `sortOrder` is `PER_PACKAGE_DELIVERY` and a recipient is out-of-zone, that recipient initializes to a method whose radio is `disabled` (`checkout-form.tsx:199`). The customer sees a pre-checked-but-disabled choice and a fee error and must manually pick another method for each such recipient. Default selection should skip methods blocked for that recipient's ZIP.

### L2 — `lines[].recipientKey` is dead, mismatched data (LOW, dead data)

`app/(storefront)/checkout/page.tsx:60-66` maps a `newRecipient` line to `recipientKey: "new"`, but `lib/checkout/recipients.ts:33` produces keys of the form `new:${recipient|line1|zip}`. The two never line up for new-recipient lines, and `CheckoutForm` never reads `lines[].recipientKey` anyway (only `productName`/`quantity`/`lineTotalCents` are rendered). The field is dead, misleading, and the value is wrong — drop it from the prop or compute the real key.

### L3 — Cart line `greeting` is dead schema carried through checkout (LOW, dead data)

`lib/order-builder/cart.ts:25` defines a per-line `greeting` field, threaded into `PricedLine.greeting` (`cart.ts:48,105,164`), but the builder only ever sets it to `""` (`components/builder/order-builder.tsx:132`) and `lib/checkout/create-order.ts:177` overwrites it with `greetingFor(recipient)` (from `greetingDefault`/`greetingOverrides`). The cart field is never user-settable and never read at checkout. Either wire it through or remove it.

### L4 — TOCTOU between quote and order commit (LOW, correctness)

`lib/checkout/create-order.ts:51-84` runs `buildCheckoutQuote` (which calls `priceCart`) outside the create transaction, then creates the order inside `db.$transaction` using the pre-computed totals. Prices/stock are not re-read inside the transaction, so a change in the small window between quote and commit can land on a stale-priced order. The `expectedTotalCents` check only proves the client agreed with the *server's* quote; it does not prove the order matches the DB at commit time. Narrow race, but real for a money path.

### L5 — `checkout.session.expired` leaves DRAFT orders behind (LOW, lifecycle)

`app/api/webhooks/stripe/route.ts:57-64` flips the session to `expired` but never touches the DRAFT order. Re-checkout handles it (the next `createOrderFromCart` discards the stale DRAFT and marks the old session `replaced`), but until then DRAFT orders for abandoned sessions accumulate. No stock leak (reservation is at finalize), so impact is limited to clutter / stale rows.

### L6 — Season re-queried per checkout (LOW, efficiency)

`app/api/checkout/route.ts:40` calls `getOpenSeason()`, then `createOrderFromCart` immediately re-queries the open season again (`lib/checkout/create-order.ts:48`). Two season lookups per checkout; harmless but unnecessary.

## Severity counts

- **High:** 1 (H1)
- **Medium:** 3 (M1, M2, M3)
- **Low:** 6 (L1–L6)
- **Total:** 10 findings

## Notes on what is solid

Fee engine is a pure function with a focused unit suite (`tests/checkout-fees.test.ts`, 6 tests) covering bulk/per-package/zip-block/day/pickup/shipping. Webhook signature verification (`tests/webhook-signature.test.ts`, 3 tests) covers tamper/wrong-secret/missing/stale. Charged-amount safety, idempotent refund sync on `stripeRefundId`, sequential per-season numbering via atomic `UPDATE "Season"`, guarded finalize/discard transitions, and audited staff POS post+void are all in place and smoke-verified. No stubs or missing smoke observed against EXPECTED.
