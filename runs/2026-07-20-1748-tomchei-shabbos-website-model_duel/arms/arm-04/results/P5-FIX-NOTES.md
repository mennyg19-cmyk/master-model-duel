# P5 review fix pass — arm-04

**Source:** `results/AGGREGATE-REVIEW-P5.md` (1 blocker, 7 majors, 19 minors)
**Scope:** one pass. The blocker, all 7 majors, 12 minors. 7 minors deferred. No new features, no P6.
**Ports:** web 3104 · db 4104

## Fixed

### Blocker

**B1 — a webhook that failed part way was answered `replay` forever.** The claim row on
`StripeWebhookEvent.eventId` was inserted before the work and never handed back, so the first
throw inside `route` turned every one of Stripe's retries into a no-op while the money sat at the
provider. `routeOrReleaseClaim` now wraps the routing: on the way out of a failure it deletes the
claim and rethrows, so the retry runs the work again and the caller still gets its 500.

A retry only helps if the steps it re-runs are safe to re-run, so both money-writing steps now
check for their own leftovers first: `recordStripePayment` (renamed from `postStripePayment`)
looks for an existing STRIPE payment on the same `payment_intent` and returns it instead of
writing a second one, and `handBackUnsafeCharge` returns early when the charge is already fully
refunded. That is also minor **m5** — the dead `P2002` catch on a `Payment.reference` index that
does not exist is gone, replaced by a check against the column that actually identifies the money.
`src/lib/payments/webhook-service.ts`

### Majors

**M1 — refund-then-cancel could diverge.** `handBackUnsafeCharge` refunded first and transitioned
after, so a transition that lost a race left the customer refunded against a `PLACED` order still
holding stock, under an audit row claiming otherwise. The cancel runs first now; if it fails the
function throws before any money moves, which is the recoverable order of the two. The
`isFullyRefunded` check above is what keeps the provider's retry from handing the same charge back
twice.
`src/lib/payments/webhook-service.ts`

**M2 — cash accepted against closed orders.** `postOfflinePayment` only refused `DRAFT` and
`DISCARDED`. Posting against a `CANCELLED` or `COMPLETED` order flipped `paymentStatus` back to
paid with no stock behind it. The gate is now positive — `PLACED` or `IN_FULFILLMENT` — so a status
added later is refused until somebody decides it can take money.
`src/lib/payments/offline-payments.ts`

**M3 — no upper bound on an offline payment.** Only `MAX_PAYMENT_CENTS` and `positive` bound it, so
$5,000 could be booked against a $50 order and left `OVERPAID` with nothing to reconcile it. The
amount is now capped at `totalCents - amountPaidCents`, and the refusal says what is still owed
(`Only $12.00 is still owed on this order.`) rather than a bare rejection. This makes the payment
path symmetric with the refund path, which already capped at `refundable`.
`src/lib/payments/offline-payments.ts`

**M4 — the line-total formula lived in four places.** `lineTotalWithAddOns(line)` in
`src/lib/orders/lines.ts`; all four sites call it, and the checkout summary's five inline copies
of the same sum went with it.
`src/lib/orders/lines.ts` · `checkout-summary.ts` · `order-service.ts` · `customer-orders.ts`

**M5 — fulfillment-method fetch and `FeeSubject` build duplicated.** `feeSubjectsFrom(client,
packages)` in `src/lib/checkout/fee-subjects.ts` does the `findMany`, the id map, the subject
assembly and the one "method missing" throw. Checkout summary and order service pass the same
shape and differ only in where their packages came from; `methodOf` is gone.
`src/lib/checkout/fee-subjects.ts` · `checkout-summary.ts` · `order-service.ts`

**M6 — `INVALID_GREETING` returned for delivery days and missing recipients.** Three outcomes now
have three codes: `INVALID_GREETING` for a card message, `INVALID_DELIVERY_DAY` for a day outside
the ones the manager opened, `RECIPIENT_NOT_ON_ORDER` for a recipient key that matches no line. A
caller switching on the code can now tell which field to point at.
`src/lib/checkout/greetings.ts`

**M7 — two destination adapters with divergent defaults.** `asDestination` in `greetings.ts`
substituted `''` for a missing recipient or method; `pickPackageDestination` substituted `null`.
The `''` branch was defensive for a case the caller already filters out, so the drift was silent.
`greetings.ts` now filters with the shared `isLineAssigned` guard and reads the key directly, its
local `LineDestination`/`asDestination` pair is deleted, and the one remaining adapter is named
`toPackageDestination`.
`src/lib/checkout/greetings.ts` · `src/lib/orders/grouping.ts` · `src/lib/orders/lines.ts`

### Minors

| # | Fix | Where |
|---|---|---|
| m1 | Cancelling an order that still holds money is refused on the staff screen: `changeOrderStatusAction` reads the paid amount and answers `This order still holds $39.00. Refund or void it before cancelling.` The refund is on the same page, so the guard names the next step rather than blocking. | `(admin)/admin/orders/actions.ts` |
| m3 | `refundThroughGateway` keys on `randomUUID()` instead of `staff-refund-${paymentId}-${amount}`. Two deliberate $20 refunds are two acts; the old key handed back the first receipt, whose refund id was already on a row, and the second died on the unique index as a raw `P2002`. | `src/lib/payments/offline-payments.ts` |
| m5 | Dead `P2002` catch removed (with B1 above). | `src/lib/payments/webhook-service.ts` |
| m7 | `refundPayment` runs in a transaction that takes `SELECT … FOR UPDATE` on the payment row and recomputes `refundable` inside it, so two staff refunding at once serialize and the second reads the first one's refund. | `src/lib/payments/offline-payments.ts` |
| m8 | Dead export `localPaymentIntentId` deleted; the one caller uses the shared `LOCAL_INTENT_PREFIX`. | `local-gateway.ts` · `local-hosted.ts` |
| m9 | `payAction` parses the tamper-guard total with `z.coerce.number().int().nonnegative()` instead of leaning on `NaN !== total`. | `(storefront)/order/checkout/actions.ts` |
| m11 | One `isLineAssigned` type guard, generic over the row shape, replaces the two byte-identical local predicates. | `src/lib/orders/lines.ts` + 3 importers |
| m12 | `findOwnedDraftById(owner, id)` exported from `draft-access.ts`; the greetings copy is gone. | `draft-access.ts` · `greetings.ts` |
| m13 | `inventoryDemand(lines)` and `inventoryTargetKey(target)` in `src/lib/inventory/demand.ts`; reservation and conflict-checking read the same map with the same key scheme. | `src/lib/inventory/demand.ts` · `order-service.ts` · `validation.ts` |
| m14 | A transient POST failure answers `LOCAL_PAY_FAILED`; `LOCAL_PAY_UNAVAILABLE` is now only the configuration error. | `src/lib/payments/local-hosted.ts` |
| m15 | "Your order was not found on this browser" is `CHECKOUT_NO_DRAFT`; `CHECKOUT_NOT_READY` keeps the blocked-checkout case. | `src/lib/checkout/checkout-service.ts` |
| m19 | `freePhone` → `phoneFieldsIfFree`: it returns a partial of the customer create input, not a boolean. | `src/lib/checkout/checkout-service.ts` |

### Found while re-smoking (not on the list)

**P5's two new env vars broke the P1 env check, and its new settings field broke the P3 shipping
form.** Neither showed up when P5 was built, because both older smokes had already been run and
their evidence files were on disk.

- `runEnvCheck` in `scripts/smoke.ts` builds a "complete env" by hand. P5 added `PAYMENT_PROVIDER`
  and `STRIPE_WEBHOOK_SECRET` to the spec, so P1-8 — the check that a complete env boots — started
  failing on the two variables the baseline did not know about. Both added to the baseline.
- `scripts/smoke-p3.ts` submits the shipping settings form by re-posting the fields the page
  renders, and the harness reads `<input>` elements only. P5 added a `deliveryDays` `<textarea>` to
  that form, so the P3 post arrived without it, `shippingSchema` refused the whole submission, and
  the ZIP the check was about was never saved. P3 now reads the current `delivery.dayChoices`
  setting and posts it back with the ZIPs.

`scripts/smoke.ts` · `scripts/smoke-p3.ts`

## Deferred

| # | Why |
|---|---|
| m2 | Per-process rate limiter. A shared store (Upstash / edge config) is the fix and it is a deployment decision, not a code edit; the review itself files it under P12. |
| m4 | `attachGuestCustomer` linking an order to a typed email is decision 8, accepted design. Changing it means an email-verification step before checkout can finish, which is a P6 flow, not a fix. |
| m6 | Re-checking prices inside `finalizeOrder`. Defense in depth: the render-time `findCheckoutConflicts` already blocks `payAction`, and stock — the part that can actually run out — is re-checked at finalize. Doing it properly means the price snapshot moves into the reservation transaction, which is the same edit m17 wants and belongs with it. |
| m10 | `rememberGreetings` writes per row. A single `updateMany` cannot write a different greeting to each address; the fix is a `CASE` statement in raw SQL or a `$transaction` batch, and at the order sizes this runs at (recipients per order, not per season) it buys nothing today. Filed against the G-024 crunch target. |
| m16 | Redirect-with-query-param forked three ways. The three shapes genuinely differ (builder params, one notice, notice-or-problem); unifying them means one helper with a union argument, which reads worse than the three call sites. |
| m17 | `order-service.ts` at 414 lines. Splitting the inventory half into `lib/orders/inventory.ts` is right, but it is a move that touches every importer and it wants to happen with m6's price re-check rather than twice. |
| m18 | `transitionOrder` not re-checking staff permission. It takes a nullable `StaffContext` because the webhook path has none, so the check cannot be unconditional; deciding what a null actor may do is a rule question the aggregate itself calls a pattern inconsistency rather than a bug. |

## Verification

- `npm run ci` — lint, typecheck, migration guard, full suite: **exit 0**. Two tests added, both
  for the blocker cluster: *an event that fails part way is retried, not answered as a replay*
  (route throws once, the claim is gone, the retry posts the payment) and *the counter cannot
  overpay an order, or take money for a closed one* (M2 + M3 over HTTP-free service calls).
- `npm run smoke:p5` — **29/29 checks pass** (`.scratch/PHASE-P5-SMOKE.md`).
- All five phases re-run in order against one freshly created database, seeded once between P1 and
  P2: **P1 28/28**, **P2 21/21**, **P3 39/39**, **P4 26/26**, **P5 29/29**. The two harness fixes
  above are why P1 and P3 are green again.
- `.env.example` is generated from `src/lib/env-spec.ts` and carries empty values for every secret
  — no `sk_test_` or `whsec_` shapes.
- No git. No other arm touched. P6 not started.
