# P5 Quality Review — arm-01

**Reviewer specialist:** Quality
**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-01
**Phase:** P5 (Checkout: delivery rules, fees, Stripe hosted, order lifecycle, POS payments)
**EXPECTED ref:** `shared/phases/PHASE-P5-EXPECTED.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

`scripts/p5-smoke.ts` exercises S1–S5 and the build emits checkout routes, webhook, POS payments, and the P5 migration. Findings below are quality defects surfaced by reading the implementation, not by smoke failure.

## Findings

### F1 — `getFeeGroup` is a no-op ternary; per-package fee undercharged when packages share an address
`src/domain/checkout.ts:33-37`, mirrored `src/components/checkout-form.tsx:75-86`
Both branches return the identical string `${fulfillmentCode}:${addressId}`, so the function always groups by address. EXPECTED §1 contrasts "bulk delivery (one fee per destination)" with "per-package delivery (fee per recipient)". For an order with two PACKAGE_DELIVERY lines to the same recipient address, the server charges one fee instead of two. The smoke passes only because `packageOrder` uses three distinct addresses (S2), so the bug is never exercised. The client repeats the same grouping, so the summary the customer sees also undercounts.

### F2 — Stuck idempotency key blocks checkout retry after a Stripe session-create failure
`src/app/api/checkout/stripe/route.ts:124-139, 183-192`
`existingIntent` is only reused when `existingIntent.stripeCheckoutSessionId` is truthy. If the `StripePaymentIntent` row was created but `stripe.checkout.sessions.create` threw before `stripeCheckoutSessionId` was persisted (or the row was created with a `pending:` placeholder), the next POST skips the reuse branch and falls through to `stripePaymentIntent.create` with the same `idempotencyKey` → unique-constraint violation. The customer cannot retry checkout without a manual DB cleanup; no recovery path exists.

### F3 — Missing smoke evidence file
`arms/arm-01/workspace/.scratch/PHASE-P5-SMOKE.md`
EXPECTED requires evidence at `arms/{id}/workspace/.scratch/PHASE-P5-SMOKE.md`. The `.scratch` directory does not exist and no P5 smoke markdown is present anywhere in the arm tree. The smoke script exists but its recorded results were not archived; the gate cannot be audited from the run folder.

### F4 — Triple-duplicated order finalization logic, two paths bypass the order-engine
`src/domain/checkout.ts:273-288`, `src/app/api/admin/orders/[orderId]/payments/route.ts:42-55`, `src/domain/order-engine.ts:36-50`
"Increment `season.nextOrderNumber`, set `orderNumber = next-1`, flip status to FINALIZED" is copy-pasted in three places. `commitStripePayment` and the POS payment route bypass `assertOrderTransition` and the serializable-retry wrapper `finalizeOrder`. The order-engine's `claimOrderNumber` is left unused by both payment paths. Drift risk is high: any change to numbering or transition rules must be applied in three places, and the two payment paths have no guard against forbidden transitions.

### F5 — POS cash/check finalizes a DRAFT without stock or price conflict validation
`src/app/api/admin/orders/[orderId]/payments/route.ts:36-56`
The Stripe path runs `findCheckoutConflicts` (stale price, stale stock, amount mismatch) before finalizing. The POS cash/check path finalizes a DRAFT straight away — no `prepareCheckout`, no conflict check. A staff member can post cash for a draft whose prices changed or whose items are out of stock, finalizing it with stale snapshots. EXPECTED §3 ("Stock + price validation at checkout") is enforced on the public flow but not the staff flow; the smoke only exercises POS after an explicit `prepareCheckout` call, so the gap is hidden.

### F6 — `stripePaymentIntent.updateMany({ where: { orderId } })` clobbers prior failed intents
`src/domain/checkout.ts:304-311`
On success, every `StripePaymentIntent` row for the order is set to `SUCCEEDED` with the new `stripePaymentIntentId`, including any prior `FAILED` intent from an earlier attempt. The failed-attempt audit trail is overwritten and the ledger no longer reflects that a prior payment attempt failed. Scope the update to the specific intent id (or `where: { orderId, status: { in: [CREATED, PROCESSING] } }`).

### F7 — `markSafetyRefund` runs in a non-serializable array transaction and hardcodes the event type
`src/app/api/stripe/webhook/route.ts:25-49`
The safety-refund path uses `db.$transaction([...])` (array form, default isolation) and writes `stripeWebhookEvent.create({ id: eventId, type: "checkout.session.completed" })` regardless of the actual event type. The outer priorEvent check (`route.ts:115`) is outside any transaction, so two concurrent replays of the same event can both pass it, both throw `CheckoutConflictError`, and both call `markSafetyRefund` — the second throws on the `StripeWebhookEvent` PK and surfaces as an unhandled 500. The hardcoded type also mislabels the event in the ledger.

### F8 — `guardPublicWrite` rate limiter trusts a spoofable `x-forwarded-for`
`src/lib/public-request.ts:29-30`
The throttle key is derived from `x-forwarded-for` (first hop) with fallback to `x-real-ip`. Without a trusted-proxy contract, an attacker rotating `X-Forwarded-For` gets a fresh throttle key per request and bypasses the 30/min checkout limit entirely. The same-origin check is fine; the rate-limit axis is not.

### F9 — `constructStripeEvent` falls back to a dummy Stripe client
`src/lib/stripe.ts:20-27`
`getStripe() ?? new Stripe("sk_test_local_webhook_verification")` constructs a client with a fake secret key when `STRIPE_SECRET_KEY` is unset. `webhooks.constructEvent` only uses the webhook secret, so this is functionally harmless, but the dummy key is a stub that masks a missing production config and will confuse operators who grep for secret keys. Either hard-fail when `STRIPE_SECRET_KEY` is unset in production, or drop the fallback and construct the client solely for verification.

## Severity summary

| ID | Severity | Area |
|---|---|---|
| F1 | High | Fee correctness — per-package undercharge |
| F2 | High | Checkout retry blocked by stuck idempotency key |
| F3 | Medium | Missing smoke evidence |
| F4 | Medium | Finalization logic triplicated, transitions bypassed |
| F5 | Medium | POS finalizes stale drafts without conflict check |
| F6 | Medium | Failed intent audit trail clobbered |
| F7 | Low-Med | Safety-refund race + mislabeled event type |
| F8 | Low-Med | Rate limit bypassable via X-Forwarded-For |
| F9 | Low | Dummy Stripe client stub |

**Finding count: 9.**
