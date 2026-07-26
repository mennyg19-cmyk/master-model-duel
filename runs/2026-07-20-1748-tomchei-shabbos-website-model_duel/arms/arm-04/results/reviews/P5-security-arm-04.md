# P5 Security Review — arm-04 (blind)

**Reviewer:** External security specialist
**Scope:** P5 delta only — hosted Stripe checkout, webhook authenticity/idempotency, charged-amount safety, refunds, guest checkout tokens, public endpoint guards, POS staff-only cash/check, price/stock tamper, order lifecycle.
**Source:** `arms/arm-04/workspace/` (P1–P5 reviewed; P5 delta in focus, P4 findings checked for regression).
**Method:** Static review of the webhook path, payment services, checkout service, fee/validation engines, public route guards, and POS money desk. No fixes proposed.

## Summary

| Severity | Count |
|---|---|
| blocker | 1 |
| major | 3 |
| minor | 4 |

The P5 payment surface is mostly well-built: signature verification is constant-time with timestamp tolerance and rotation support, the body is read raw before parsing, the webhook refuses any `Origin` header, the event id is the idempotency lock, charged-amount mismatches are recorded then refunded in full, refunds are capped at the remaining refundable, guest tokens are 32-byte random hashed at rest, draft ownership anti-enumeration holds, and POS functions re-check `orders.manage` from a `StaffContext` so no storefront path reaches them. The blocker is a real money-loss path in the idempotency design; the majors are consistency gaps in the same neighborhood.

## Findings

### 1. blocker — A transient failure during webhook processing permanently drops the event, and every retry with it
**File:** `src/lib/payments/webhook-service.ts:61-86`

`applyStripeEvent` claims the event in `StripeWebhookEvent` (unique index on `eventId`) **before** routing it, then calls `route(event)`, then updates the row with `processedAt`/`outcome`. The route handler comment (`route.ts:52-54`) correctly notes that a throw past this point becomes a 500, which makes Stripe retry. But the retry carries the same `event.id`, so `claimEvent` hits the unique index, returns `false`, and `applyStripeEvent` returns `'replay'` — **doing nothing**. The row stays with `processedAt = null` and `outcome = null`, and every retry for the next several days is silently dropped.

The failure mode is a customer who paid: `postStripePayment` throws (DB blip, a `recomputeOrderPaymentStatus` error, a connection drop), the route returns 500, Stripe retries, and the retry is classified as a replay. The charge exists at Stripe, the order stays `PLACED` + `UNPAID`, the stock stays reserved, and no human is alerted. The inner idempotency on `Payment.reference` (unique on the intent id) already prevents a duplicate payment row, so re-running `route` on a retry is safe — the outer claim-before-work is the only thing standing between a transient fault and a lost payment. Either delete the claim row on throw, mark it `failed` so retries re-run `route`, or claim after success.

### 2. major — `handBackUnsafeCharge` can refund successfully and then fail to cancel the order / release stock
**File:** `src/lib/payments/webhook-service.ts:190-235`

`handBackUnsafeCharge` calls `getPaymentGateway().refund(...)` (a real Stripe call) **outside** any transaction, then opens a transaction to write the `PaymentRefund` and recompute payment status, then — after that transaction commits — calls `transitionOrder(orderId, 'CANCELLED', null)` to release stock. If `transitionOrder` loses a race (the order was moved by a concurrent staff action between the refund and the transition; `claimOrderStatus` would abort with `CONCURRENT_CHANGE`), the customer is refunded in full but the order is not cancelled and the stock stays reserved. The audit row says `auto_refunded`, the ledger says refunded, but the order is still `PLACED` with held inventory. Conversely, if the gateway call succeeds but the `PaymentRefund` insert transaction fails, the refund happened at Stripe and is missing from the ledger. The refund idempotency key (`auto-refund-${eventId}`) only protects against a re-run of the same event, which (per finding 1) never happens. Order the work so the state change and the refund cannot diverge, or compensate on the transition failure.

### 3. major — `postOfflinePayment` accepts cash/check against a CANCELLED (or COMPLETED) order
**File:** `src/lib/payments/offline-payments.ts:52-88`

The guard is `if (order.status === 'DRAFT' || order.status === 'DISCARDED') return ORDER_NOT_PAYABLE`. Every other status — `PLACED`, `IN_FULFILLMENT`, `COMPLETED`, `CANCELLED` — is accepted. Posting cash against a `CANCELLED` order is wrong: the order's stock was released at cancel, the cached `paymentStatus` is stale, and `recomputeOrderPaymentStatus` will flip a cancelled order to `PARTIALLY_PAID`/`PAID` with no stock behind it. Posting against `COMPLETED` is similarly meaningless. The state machine allows `PLACED → CANCELLED` and `IN_FULFILLMENT → CANCELLED` regardless of payment status (see finding 5), so a cancelled-but-previously-paid order is a normal state, and a staff member can then "take" cash against it. Restrict the gate to `PLACED` and `IN_FULFILLMENT` (the payable statuses), or check `paymentStatus !== 'PAID'` as well.

### 4. major — `postOfflinePayment` has no upper bound against the outstanding balance; overpayment via POS cash is unguarded
**File:** `src/lib/payments/offline-payments.ts:42-87`

`refundPayment` carefully caps the amount at `payment.amountCents - alreadyRefunded` and rejects overpayments. `postOfflinePayment` does not bound the amount against the order's outstanding balance at all — only `MAX_PAYMENT_CENTS = 5_000_000` ($50,000) and `positive`. A staff member can post $5,000 cash against a $50 order; `recomputeOrderPaymentStatus` will mark it `OVERPAID`, the audit row records the amount, and nothing reconciles it back. For a charity money desk this is a real fat-finger risk with no server-side guardrail, and it is asymmetric with the refund path. Cap `amountCents` at `order.totalCents - order.amountPaidCents` (or explicitly allow overpayment as a decision and document it).

### 5. minor — `changeOrderStatusAction` lets staff cancel a PAID order without a refund
**File:** `src/app/(admin)/admin/orders/actions.ts:88-101`, `src/lib/orders/state-machine.ts:14-21`

The state machine allows `PLACED → CANCELLED` and `IN_FULFILLMENT → CANCELLED` with no payment-status check. `transitionOrder` releases stock on cancel but does not touch payments. A staff member with `orders.manage` can cancel a fully-paid order; the customer is left paid with no order and no refund, and the audit shows `order.status_changed` but no `payment.refunded`. This may be intended (the office refunds separately through `refundPaymentAction`), but the cancellation and the refund are decoupled, and nothing in P5 prevents the cancellation from running first and the refund from being forgotten. Either gate cancel-on-paid behind an explicit "refund first" step or surface the outstanding paid amount on the cancel confirmation.

### 6. minor — In-memory rate limiter is per-process and effectively absent on serverless
**File:** `src/lib/http/public-guards.ts:19-47`

`withinRateLimit` keeps a `Map` in module scope. The author is honest about this ("a limiter that pretends to be global while it is not is worse than one that says what it is"), and for a single long-running process it is fine. But the deployment target is Vercel (per the merged plan), where a serverless function cold-starts per invocation — the map is empty on every cold start, so the webhook's 240/min and the client-error endpoint's 60/min limits do not actually bind in production. The webhook's signature check is the real authenticity gate so this is not a hole, but the rate limit is decorative in the target runtime. Flagged as minor because it is acknowledged in code; a shared store (Upstash/edge config) is a P12 concern per the plan.

### 7. minor — `refundThroughGateway` idempotency key collides on two same-amount refunds of one payment
**File:** `src/lib/payments/offline-payments.ts:200-215`

The idempotency key is `staff-refund-${payment.id}-${amountCents}`. Two staff refunds of the same amount against the same payment share a key, so Stripe returns the first refund's receipt. The subsequent `PaymentRefund.create` then tries to insert with `reference = receipt.refundId` (the same refund id), which collides on the unique index `PaymentRefund_reference_key` and throws a raw `P2002`. The money is not doubled (Stripe's idempotency held), but the staff member sees an unhandled Prisma error instead of "this refund was already recorded," and the second refund's `reason` is lost. Make the key unique per call (include a request id or timestamp) or detect the duplicate and return a user-facing message.

### 8. minor — `attachGuestCustomer` lets a guest attach an order to any email they can type
**File:** `src/lib/checkout/checkout-service.ts:162-198`

A guest who types a victim's email at checkout links the order to that customer row (`db.customer.findUnique({ where: { normalizedEmail } })` then `order.update({ customerId })`). The victim, on signing in, sees the order in their history. The guest never sees the victim's saved addresses/greetings (those are read under the guest owner until the attach), and the order still has to be paid through Stripe to be placed, so this is not free ordering. But it is an attribution/UX surface: a malicious guest can pollute a victim's order history with unpaid or paid-but-the-guest's-recipient orders. Documented as decision 8 ("a guest becomes a customer at the moment they pay"), so this is accepted design — flagged only because the security review asked. If unwanted, require email verification before linking to an existing account, or create a new unverified customer row and merge later.

## Trust-boundary checklist (what passed)

- **Webhook authenticity** (`stripe-signature.ts`, `route.ts`): raw body read before any parsing; HMAC-SHA256 over `timestamp.body`; 300s tolerance; multiple `v1` values supported for rotation; `timingSafeEqual` for the comparison; no `Origin` header accepted (403); 64 KB body cap; Zod on the parsed event. R-125 satisfied.
- **Webhook idempotency** (`webhook-service.ts:78-86`): unique index on `StripeWebhookEvent.eventId` is the lock; the loser of the insert does nothing and returns 200. R-167 satisfied for the *duplicate-delivery* case (the failure case is finding 1).
- **Charged-amount safety** (`webhook-service.ts:94-135`): `chargedCents !== order.totalCents || order.status !== 'PLACED'` triggers `handBackUnsafeCharge`; the wrong charge is recorded as a `Payment` first, then refunded in full, then the order is cancelled. R-126/R-169 satisfied for the happy path (the divergence is finding 2).
- **Refund cap** (`offline-payments.ts:137-167`): `refundable = payment.amountCents - alreadyRefunded`; amount must be a positive integer `<= refundable`; voided payments are not refundable. R-054 staff path satisfied.
- **Refund sync** (`webhook-service.ts:242-282`): only the difference between Stripe's cumulative `amount_refunded` and the DB's recorded refunds is inserted; `outstanding <= 0` returns `ignored`. R-168 satisfied.
- **Guest checkout tokens** (`draft-access.ts`): 32-byte `randomBytes` base64url, SHA-256 hashed at rest, httpOnly cookie, 30-day max-age. R-023 satisfied (carried from P4, no P5 regression).
- **Draft ownership anti-enumeration** (`checkout-service.ts`, `confirmation/page.tsx`, `confirmation/actions.ts`): every read goes through `resolveDraftOwner` → `findOwnedOrder`/`findOwnedDraft`; a miss returns the same answer as "not found"; the confirmation page reads payment status from the order, never the query string. R-121 satisfied.
- **Public endpoint guards** (`public-guards.ts`, `client-error/route.ts`, `webhooks/stripe/route.ts`): same-origin for browser-facing routes, origin-reject for the provider-facing route, body caps, Zod schemas, rate limits. R-122 satisfied modulo finding 6.
- **POS staff-only** (`offline-payments.ts:42-50,94-106,137-145`): every money function takes a `StaffContext` and re-checks `orders.manage` itself; the storefront has no `StaffContext` to pass; the admin actions call `requirePermission` and then pass the context. R-127 satisfied (the payable-status gate is finding 3).
- **Price/stock tamper** (`checkout-service.ts:62-87`, `validation.ts`, `order-service.ts:255-266`, `reserve.ts:22-36`): `expectedTotalCents` is checked against the re-read summary, then again against the finalized order's total (mismatch cancels the order); `finalizeOrder` reserves stock with an atomic `UPDATE ... WHERE onHand - reserved >= quantity` so two concurrent finalizes for the last unit cannot both win; `findCheckoutConflicts` re-reads catalog prices and stock on every render. R-034 satisfied.
- **Fulfillment fee snapshot** (`order-service.ts:366-399`): fees are recomputed inside the finalize transaction with the same pure function that quoted them, then frozen on each `Package.fulfillmentFeeCents`; a later method change cannot re-price a box. G-028 satisfied.
- **Lazy Stripe singleton / no client SDK** (`gateway.ts:43-53`, `stripe-api.ts`): gateway built on first use, not at module load; no client Stripe package; the card number never reaches the app. Resolution 8b satisfied.
- **Local provider loopback lock** (`env-spec.ts:192-200`, `local-gateway.ts`, `local-hosted.ts`): `PAYMENT_PROVIDER=local` is rejected unless `APP_URL` is loopback; the hosted page 404s off-loopback. The dev stand-in cannot reach a real customer.

## Out of scope

Live Shippo rates and the margin engine (P8); package board, printing, labels, routes (P7–P9); the full admin operations hub, search, bulk actions (P6); email/SMS notifications (P11); reporting and reconciliation (P12). P4 findings 2–5 were re-checked and not regressed by P5.
