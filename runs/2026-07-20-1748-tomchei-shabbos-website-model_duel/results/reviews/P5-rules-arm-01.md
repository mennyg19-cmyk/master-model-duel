# P5 Rules Review — arm-01

Reviewer: Rules specialist. Scope: P5 (Checkout) additions in `arms/arm-01/workspace/`.
Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol.

## Findings

### F1 — Pointless ternary / dead branch (clean-code §Anti-AI-Tics, ponytail §Code rules)
`src/domain/checkout.ts:33-37` — `getFeeGroup` returns the same string on both branches:
```ts
return choice.fulfillmentCode === "PACKAGE_DELIVERY"
  ? `${choice.fulfillmentCode}:${addressId}`
  : `${choice.fulfillmentCode}:${addressId}`;
```
The conditional does nothing. Either the branch was meant to differentiate (e.g. per-package groups by `lineId`, bulk by `addressId`) and was collapsed by mistake, or the function should be a one-liner with no ternary. Anti-fluff: every line must have a reason.

### F2 — Per-package fee grouping is wrong (latent bug from F1)
Spec (PHASE-P5-EXPECTED §1): "per-package delivery (fee per recipient)". `calculateFulfillmentFees` groups every fulfillment code by `addressId`, so per-package recipients sharing an address collapse to one fee. Smoke passes only because each P5 package recipient has a distinct address. The dead ternary in F1 hides the missing `lineId` grouping for `PACKAGE_DELIVERY`. Domain logic silently wrong — flag for fix, not just style.

### F3 — Vague state variable name (clean-code §Naming)
`src/components/checkout-form.tsx:52` `state`/`setState` holds a status string ("Loading checkout…", "Ready", "Redirecting to Stripe…"). `state` is a banned-ish vague name; `status`/`setStatus` reads as the yes/no it is. Same in `src/app/checkout/test/page.tsx` (`state` already enum-typed there, less severe).

### F4 — Trust `x-forwarded-for` for rate-limit key (ponytail §Never cut: trust-boundary)
`src/lib/public-request.ts:29-30` uses `x-forwarded-for` first, then `x-real-ip`, falling back to `"unknown"`. A client can spoof `x-forwarded-for` to rotate keys and dodge the per-minute cap. Origin/host check is the real guard, but the throttle key trusts a client-set header without verifying the proxy chain. Either pin to a configured trusted proxy prefix or prefer `x-real-ip` only.

### F5 — `stripePaymentIntent.updateMany` by `orderId` can duplicate ids (clean-code §Consistency)
`src/domain/checkout.ts:304-311` updates every intent row for the order to the same `stripePaymentIntentId`. If a prior cancelled/failed intent exists, multiple rows now share one id; later `processRefund` does `findUnique({ where: { stripePaymentIntentId } })` (`webhook/route.ts:84`) which throws on duplicates. Either scope the update to the checkout session id or guard the refund lookup.

### F6 — Refund modeled as `VOIDED` (vocabulary / domain drift)
`src/app/api/stripe/webhook/route.ts:92-95` sets `payment.status = "VOIDED"` and `voidedAt` on a Stripe refund. `VOIDED` is the staff-void semantic from `payments/route.ts`; a refund is a different lifecycle event. Conflates two concepts; refund sync should use a `REFUNDED` status (or a dedicated field). Schema/migration only adds `FAILED` to `PaymentIntentStatus`, not a refund Payment status — drift.

### F7 — `recalculatePaymentStatus` runs outside the payment transaction (clean-code §Consistency)
`src/app/api/admin/orders/[orderId]/payments/route.ts:36-81` posts/voids the payment inside `db.$transaction`, then calls `recalculatePaymentStatus(db, orderId)` after commit. Concurrent posts can compute a stale `cachedPaymentStatus`. Fold the recalculation into the same transaction, or re-lock the order row.

### F8 — Safety-refund reason is semantically wrong
`src/app/api/stripe/webhook/route.ts:21` uses `reason: "requested_by_customer"` for a stale-order safety refund. That reason is for customer-initiated refunds; a stale-total auto-refund is closer to `duplicate`/`fraudulent`. Mislabels the audit trail.

### F9 — Convoluted Zod enum cast (clean-code §Anti-AI-Tics over-verbose)
`src/app/api/checkout/stripe/route.ts:28-31` casts `Object.keys(fulfillmentFees)` to a tuple type to satisfy `z.enum`. A literal `z.enum(["BULK_DELIVERY","PACKAGE_DELIVERY","SHIPPING","PICKUP"])` (or a derived const tuple) is clearer and type-safe. Minor.

### F10 — `markSafetyRefund` not serializable / no idempotency lock
`src/app/api/stripe/webhook/route.ts:25-48` uses `db.$transaction([...])` (batch form, not serializable) and relies on `stripeWebhookEvent.create` to fail on duplicate PK for replay safety. The top-of-POST `findUnique` check is a TOCTOU window; two concurrent webhooks for the same event could both pass the check and both attempt the refund. `commitStripePayment` uses Serializable — the safety path should match.

## Count
10 findings (1 latent bug F2, 1 trust-boundary F4, 1 concurrency F7/F10, rest clean-code/vocabulary).
