# P5 quality review — arm-04 (blind)

Reviewer: quality specialist. Scope: P5 delta + regressions vs `shared/phases/PHASE-P5-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P5. Findings only — no fixes. No new scope beyond P5.

## Summary

- Blocker: 0
- Major: 0
- Minor: 4

All 8 EXPECTED items are delivered and the 29/29 smoke checks are real HTTP/DB assertions, not stubs. Fees, greetings, hosted Stripe + local stand-in, webhook authenticity/idempotency, charged-amount safety + auto-refund, refund sync, POS cash/check + void + audit, draft-ownership anti-enumeration, public endpoint guards, order lifecycle, sequential numbering, cached payment status, and placeholder rate rules all match the spec. No stubs, no missing smoke, no P1–P4 regressions observed in the touched files. Four minor notes below.

## Minor

1. **`postStripePayment` catches P2002 on a `Payment.reference` unique index that does not exist.** `webhook-service.ts:178-181` documents the catch as "the unique index on the intent id refused a second row for the same charge," but `Payment.reference` is `String?` with no `@unique` (`prisma/schema/orders.prisma:182`). The actual idempotency guard is `claimEvent` on `StripeWebhookEvent.eventId`, which is correct and sufficient; the P2002 catch is dead code and the comment mis-describes the schema. If a second `checkout.session.completed` for the same intent ever raced past `claimEvent` (it cannot today), a duplicate `Payment` row would be inserted silently rather than refused.

2. **Price conflicts are not re-checked inside `finalizeOrder`.** `findCheckoutConflicts` runs in `readCheckoutSummary` and sets `isPayable=false` on any price/stock/unavailable drift, which blocks `payAction`. But `finalizeOrder` (`src/lib/orders/order-service.ts:39-113`) only checks season-open, non-empty, and fully-assigned; it does not re-read the catalog against the snapshots. The total-mismatch guard in `startCheckout` compares `placed.value.totalCents` (snapshot-derived) to `expectedTotalCents` (also snapshot-derived from the same summary), so the two always agree even if a price moved in the render→pay window. Stock IS re-checked at finalize via `reserveInventoryFor`, so only the price-conflict path has this narrow race. EXPECTED item 3 is satisfied by the render-time check; this is a defense-in-depth gap, not a spec violation.

3. **Offline (cash/check) refunds have no idempotency guard.** `refundPayment` (`src/lib/payments/offline-payments.ts:137-198`) reads `payment.refunds` and computes `refundable` outside the transaction, then opens the transaction, creates the `PaymentRefund` row, and calls `recomputeOrderPaymentStatus` (which locks the Order row). Two concurrent staff refunds on the same payment could both read the same `alreadyRefunded`, both pass `amountCents > refundable`, and both insert before the order lock serializes them — over-refunding a cash/check payment. Stripe refunds are protected by the gateway idempotency key (`staff-refund-${payment.id}-${amountCents}`); offline refunds have none. Requires two staff refunding the same payment simultaneously, so low-impact, but the ledger would be wrong if it happened.

4. **`localPaymentIntentId()` is exported and unused.** `src/lib/payments/local-gateway.ts:53-55` exports a helper that generates `pi_local_…` ids, but `payLocalHostedSession` in `local-hosted.ts:80` derives the intent id inline via `sessionId.replace(LOCAL_SESSION_PREFIX, 'pi_local_')`. Dead code; no functional impact.

## What was verified and looks correct

- **Fees (EXPECTED 1):** `resolveFulfillmentFees` is pure and called twice — once for the quote in `readCheckoutSummary`, once inside `finalizeOrder`'s `chargeFulfillment` — so quote and charge cannot diverge. `FeeBasis` enum drives NONE/PER_PACKAGE/PER_DESTINATION; bulk destination dedupe uses `deliveryDestinationKey` (ignores recipient name, correct for "one fee per door"); per-package bills every box. Smoke S2a/S2b confirms hard ZIP block (no override anywhere) and the 3×$5 vs 2×$8 split.
- **Greetings (EXPECTED 2):** `setDefaultGreeting` fills only null cards; `setRecipientGreeting` writes to every box for a recipient and to `CustomerAddress.lastGreeting` for next season; guests skip the remember step. Suggested greeting offered from `lastGreeting`. Smoke S1c + unit tests cover default-fill, override-preserve, and remember.
- **Stock + price validation (EXPECTED 3):** `findCheckoutConflicts` re-reads catalog + shelf on every render; price/stock/unavailable conflicts set `data-payable="false"` and the pay button refuses. `expectedTotalCents` is submitted with the form and refused if it differs from the summary. Smoke S3a/S3b confirms re-price refusal and tampered-total refusal.
- **Hosted Stripe + webhook (EXPECTED 4):** `stripe-api.ts` uses `capture_method=automatic` (immediate capture), REST over `fetch` with idempotency-key, no SDK. Webhook route reads raw body, verifies signature (constant-time compare, 5-min tolerance, multi-v1 rotation support), bounds body to 64 KB, rate-limits, refuses any `Origin` header. `claimEvent` inserts into `StripeWebhookEvent` before acting; replay returns `'replay'`. Amount-safety: `unsafe = order.status !== 'PLACED' || chargedCents !== order.totalCents` → records payment, refunds in full, cancels order, releases stock. `syncRefund` records only the delta. Smoke S1f–S1j, S5d, S5e all pass.
- **Guest + public guards (EXPECTED 5):** Guest checkout creates/links customer before finalize; confirmation reads via owner filter (404 for non-owner, same as invented id — anti-enumeration). `/api/client-error` is same-origin + rate-limited + Zod + body-bounded; webhook is the mirror image (refuses `Origin`). Env schema refuses `PAYMENT_PROVIDER=local` off-loopback.
- **POS (EXPECTED 6):** `postOfflinePayment`/`voidPayment`/`refundPayment` all take `StaffContext` and re-check `orders.manage` themselves, so no storefront path reaches them. Drafts and discarded orders are refused. Void keeps the row + reason; recount treats voided as unposted. Fulfillment fee frozen on `Package.fulfillmentFeeCents` at finalize and shown in the admin detail. Smoke S4a–S4c confirms staff post/void + buyer/driver/sign-out rejection.
- **Lifecycle (EXPECTED 7):** `claimOrderStatus` is a conditional `updateMany` on `status` (optimistic lock); `claimOrderNumber` increments `Season.nextOrderNumber` under row lock → gapless. State machine refuses illegal transitions; cancel releases stock; draft→discarded for customer cancel (no number burned). `recomputeOrderPaymentStatus` is the sole writer of `amountPaidCents`/`paymentStatus`, always recounts from posted payments minus refunds, locks Order `FOR UPDATE`. Smoke S5a–S5e confirms.
- **Placeholder rates (EXPECTED 8):** `shippingFee` reads `shipping.baseRateCents` + `freeShippingThresholdCents` from Settings; free-shipping short-circuits; the P8 seam is that one function. Unit test covers it.
- **No regressions in touched files:** `grouping.ts` package key now includes `deliveryDay` (correct — two boxes going on different days are two boxes); `payment-status.ts` recount is unchanged in shape, still the sole writer; `client-error/route.ts` now uses shared `withinRateLimit` + `isSameOrigin` (was a local copy); `order/page.tsx` and `account/orders/[orderId]/page.tsx` edits are minimal and consistent with P4 behavior; migration is additive and ordered; `npm run ci` exits 0 per status.

## Reproduce

```bash
npm run db:deploy && npm run seed
npm run dev          # port 3104
npm run smoke:p5     # writes .scratch/PHASE-P5-SMOKE.md
npm run ci           # 140 tests
```
