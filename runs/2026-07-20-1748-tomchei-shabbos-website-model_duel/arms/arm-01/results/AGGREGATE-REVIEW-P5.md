# Aggregate Review — P5 — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Output:** `arms/arm-01/results/AGGREGATE-REVIEW-P5.md`

**Inputs aggregated:**
- `results/reviews/P5-security-arm-01.md` (8 findings: 0 Critical, 2 High, 3 Med, 3 Low)
- `results/reviews/P5-quality-arm-01.md` (9 findings: 2 High, 5 Med, 2 Low-Med, 1 Low)
- `results/reviews/P5-rules-arm-01.md` (10 findings: latent bug + trust-boundary + concurrency + clean-code/vocabulary)
- `results/reviews/P5-clean-code-arm-01.md` (15 findings: dead branch, duplication, god file, naming, magic-value, drift)

**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings introduced during aggregation.

**Severity mapping:** security High + quality High = **blocker**; security Med + quality Med + rules Violation (latent bug / trust-boundary / concurrency) + clean-code Rule-of-2/god-file = **major**; security Low + quality Low + rules Minor + clean-code magic-value/naming/drift = **minor**; borderline extraction = **minor (info)**.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 4 |
| Major | 9 |
| Minor | 16 |
| **Total** | **29** |

---

## Blockers (4)

### B1 — Stripe `success_url`/`cancel_url` derived from client `Host` header (open redirect / phishing)
**Sources:** SEC HIGH-1
**Locations:** `src/app/api/checkout/stripe/route.ts:145-166`
**Claim:** `requestUrl.origin` is built from `request.url`, whose host is the client-sent `Host` header. `guardPublicWrite` only checks `originHost === host` — both attacker-controlled on a direct connection. An attacker setting `Host: evil.com` + `Origin: https://evil.com` passes the guard and has Stripe redirect paying customers to `https://evil.com/account/orders/...?paid=1` after capture. No server-trusted base URL is used.

### B2 — Public rate limit keyed on spoofable `x-forwarded-for` / `x-real-ip`
**Sources:** SEC HIGH-2, Q F8, RULES F4
**Locations:** `src/lib/public-request.ts:29-33`, `src/app/api/order/drafts/route.ts:17-19`
**Claim:** The throttle key derives from `x-forwarded-for` (first entry) or `x-real-ip`, falling back to `"unknown"`. Without a trusted-proxy contract, an attacker rotates `X-Forwarded-For` per request to bypass the 30/min checkout limit and 10/min guest-draft limit. The same-origin check is fine; the rate-limit axis is not. Pin to a configured trusted proxy prefix or prefer `x-real-ip` only.

### B3 — `getFeeGroup` is a no-op ternary; per-package fee undercharged when recipients share an address
**Sources:** Q F1, RULES F1 + F2, CC F1
**Locations:** `src/domain/checkout.ts:33-37`, mirrored `src/components/checkout-form.tsx:75-86`
**Claim:** Both ternary arms return the identical `${fulfillmentCode}:${addressId}`, so the function always groups by address. EXPECTED §1 contrasts "bulk delivery (one fee per destination)" with "per-package delivery (fee per recipient)". For an order with two PACKAGE_DELIVERY lines to the same recipient address, the server charges one fee instead of two. Smoke passes only because `packageOrder` uses three distinct addresses (S2), so the bug is never exercised. The client repeats the same grouping, so the summary the customer sees also undercounts.

### B4 — Stuck idempotency key blocks checkout retry after Stripe session-create failure
**Sources:** Q F2
**Locations:** `src/app/api/checkout/stripe/route.ts:124-139, 183-192`
**Claim:** `existingIntent` is only reused when `stripeCheckoutSessionId` is truthy. If the `StripePaymentIntent` row was created but `stripe.checkout.sessions.create` threw before `stripeCheckoutSessionId` was persisted, the next POST skips the reuse branch and falls through to `stripePaymentIntent.create` with the same `idempotencyKey` → unique-constraint violation. The customer cannot retry checkout without a manual DB cleanup; no recovery path exists.

---

## Majors (9)

### A1 — `charge.refunded` / `payment_intent.payment_failed` lack in-transaction idempotency
**Sources:** SEC MEDIUM-1
**Locations:** `src/app/api/stripe/webhook/route.ts:103-139`
**Claim:** `priorEvent` is checked once at the top, then refund/failed/unknown branches insert `stripeWebhookEvent` in a separate transaction with no atomic dedup. Two concurrent deliveries of the same `event.id` both pass the prior-event check; the second insert fails on PK and returns 500 to Stripe (retry), or — for refunds — both proceed to void the payment before the insert, double-processing. Only `commitStripePayment` re-checks inside its serializable transaction; the refund/failed paths do not.

### A2 — Admin cash/check POS finalizes DRAFT without inventory reservation, snapshot preservation, or conflict check
**Sources:** SEC MEDIUM-2, Q F5
**Locations:** `src/app/api/admin/orders/[orderId]/payments/route.ts:36-80`
**Claim:** The `payments:manage` staff path finalizes a DRAFT and assigns `orderNumber` with no `SELECT ... FOR UPDATE`, no inventory reservation, no `fulfillmentFeeCentsSnapshot` / `unitPriceCentsSnapshot` preservation, and no `prepareCheckout` / `findCheckoutConflicts` check. The Stripe path runs conflict detection (stale price, stale stock, amount mismatch); the POS path bypasses both stock-safety and price-snapshot invariants. Staff-trusted, but it breaks the invariant the Stripe path enforces. Smoke only exercises POS after an explicit `prepareCheckout`, so the gap is hidden.

### A3 — Partial Stripe refund marks whole payment VOIDED and mis-derives order status (refund modeled as VOIDED)
**Sources:** SEC MEDIUM-3, RULES F6
**Locations:** `src/app/api/stripe/webhook/route.ts:87-100`, `src/domain/checkout.ts:329-352`
**Claim:** Any `charge.refunded` event voids the entire `payment` row regardless of refund amount. `recalculatePaymentStatus` then recomputes from POSTED payments only and flags the order REFUNDED only if every intent is REFUNDED. A partial refund zeroes the payment, drops it from `postedCents`, and can flip a partially-refunded order to UNPAID/PARTIALLY_PAID incorrectly. `VOIDED` is the staff-void semantic; a refund is a different lifecycle event and should use a `REFUNDED` status (or dedicated field). Refund amount is never compared to the captured amount.

### A4 — Triple-duplicated order finalization logic, two paths bypass the order-engine
**Sources:** Q F4
**Locations:** `src/domain/checkout.ts:273-288`, `src/app/api/admin/orders/[orderId]/payments/route.ts:42-55`, `src/domain/order-engine.ts:36-50`
**Claim:** "Increment `season.nextOrderNumber`, set `orderNumber = next-1`, flip status to FINALIZED" is copy-pasted in three places. `commitStripePayment` and the POS payment route bypass `assertOrderTransition` and the serializable-retry wrapper `finalizeOrder`. The order-engine's `claimOrderNumber` is left unused by both payment paths. Drift risk is high: any change to numbering or transition rules must be applied in three places, and the two payment paths have no guard against forbidden transitions.

### A5 — `stripePaymentIntent.updateMany({ where: { orderId } })` clobbers prior failed intents / duplicates ids
**Sources:** Q F6, RULES F5
**Locations:** `src/domain/checkout.ts:304-311`
**Claim:** On success, every `StripePaymentIntent` row for the order is set to `SUCCEEDED` with the new `stripePaymentIntentId`, including any prior `FAILED` intent. The failed-attempt audit trail is overwritten and the ledger no longer reflects that a prior attempt failed. Worse, multiple rows now share one id; later `processRefund` does `findUnique({ where: { stripePaymentIntentId } })` (`webhook/route.ts:84`) which throws on duplicates. Scope the update to the specific intent id (or `where: { orderId, status: { in: [CREATED, PROCESSING] } }`).

### A6 — `markSafetyRefund` runs in a non-serializable array transaction and hardcodes the event type
**Sources:** Q F7, RULES F10
**Locations:** `src/app/api/stripe/webhook/route.ts:25-49`
**Claim:** The safety-refund path uses `db.$transaction([...])` (array form, default isolation) and writes `stripeWebhookEvent.create({ id: eventId, type: "checkout.session.completed" })` regardless of the actual event type. The outer `priorEvent` check (`route.ts:115`) is outside any transaction, so two concurrent replays of the same event can both pass it, both throw `CheckoutConflictError`, and both call `markSafetyRefund` — the second throws on the `StripeWebhookEvent` PK and surfaces as an unhandled 500. `commitStripePayment` uses Serializable; the safety path should match. The hardcoded type also mislabels the event in the ledger.

### A7 — `recalculatePaymentStatus` runs outside the payment transaction
**Sources:** SEC LOW-3, RULES F7
**Locations:** `src/app/api/admin/orders/[orderId]/payments/route.ts:36-81, 131`
**Claim:** The route posts/voids the payment inside `db.$transaction`, then calls `recalculatePaymentStatus(db, orderId)` after commit. A crash between commit and recalc leaves `cachedPaymentStatus` stale relative to the posted/voided payment rows; concurrent posts can compute a stale cached value. Fold the recalculation into the same transaction, or re-lock the order row.

### A8 — Missing P5 smoke evidence file
**Sources:** Q F3
**Locations:** `arms/arm-01/workspace/.scratch/PHASE-P5-SMOKE.md`
**Claim:** EXPECTED requires evidence at `arms/{id}/workspace/.scratch/PHASE-P5-SMOKE.md`. The `.scratch` directory does not exist and no P5 smoke markdown is present anywhere in the arm tree. The smoke script exists but its recorded results were not archived; the gate cannot be audited from the run folder.

### A9 — `src/domain/checkout.ts` is a god file by concern (mixed concerns)
**Sources:** CC F8
**Locations:** `src/domain/checkout.ts` (353 lines)
**Claim:** One file, seven concerns: fee constants + fee calc, conflict detection, checkout preparation, inventory reservation, order finalization + sequential numbering, Stripe payment commit + idempotency, payment-status recalculation, remembered-greeting persistence. The rule says split when mixed concerns (not just >500 lines). Candidates: `fulfillment-fees.ts`, `checkout-conflicts.ts`, `checkout-prepare.ts`, `payment-commit.ts`, `payment-status.ts`. Each has a single clear concern and would shrink the surface reviewers must hold in head.

---

## Minors (16)

### m1 — `constructStripeEvent` falls back to a hardcoded placeholder Stripe key
**Sources:** SEC LOW-1, Q F9, CC F5
**Locations:** `src/lib/stripe.ts:20-27`
**Claim:** `getStripe() ?? new Stripe("sk_test_local_webhook_verification")` constructs a client with a bogus key when `STRIPE_SECRET_KEY` is unset. `webhooks.constructEvent` only uses the webhook secret, so this is functionally harmless, but the dummy key is committed stub code that masks a missing production config and will confuse operators who grep for secret keys. Either hard-fail when `STRIPE_SECRET_KEY` is unset in production, or drop the fallback and construct the client solely for verification.

### m2 — `publicRequestErrorResponse` re-throws non-`PublicRequestError`
**Sources:** SEC LOW-2
**Locations:** `src/lib/public-request.ts:56-61`
**Claim:** Re-throws unexpected errors instead of returning a sanitized 500. In dev this surfaces stack traces to the client; in any environment it lets unexpected errors propagate unhandled from the checkout/test-complete routes.

### m3 — Duplicated "instanceof X ? json : rethrow" error helper
**Sources:** CC F9
**Locations:** `src/lib/public-request.ts:56-61`, `src/app/api/admin/orders/[orderId]/payments/route.ts:15-20`
**Claim:** Identical shape (`if (error instanceof X) return Response.json({error: error.message}, {status}); throw error;`) in two call sites. Extract a generic `typedErrorResponse<T extends Error>(error, Type, status)` helper into `src/lib/http.ts`. Currently every new guarded route reinvents this.

### m4 — Safety-refund reason is semantically wrong
**Sources:** RULES F8
**Locations:** `src/app/api/stripe/webhook/route.ts:21`
**Claim:** Uses `reason: "requested_by_customer"` for a stale-order safety refund. That reason is for customer-initiated refunds; a stale-total auto-refund is closer to `duplicate` / `fraudulent`. Mislabels the audit trail.

### m5 — Convoluted `z.enum` cast from `Object.keys`
**Sources:** RULES F9, CC F14
**Locations:** `src/app/api/checkout/stripe/route.ts:28-31`
**Claim:** `z.enum(Object.keys(fulfillmentFees) as [keyof typeof fulfillmentFees, ...(keyof typeof fulfillmentFees)[]])` works around `z.enum` requiring a non-empty tuple. Define `const FULFILLMENT_CODES = Object.keys(fulfillmentFees) as FulfillmentCode[]` once and reuse, or use a literal `z.enum(["BULK_DELIVERY","PACKAGE_DELIVERY","SHIPPING","PICKUP"] as const)` derived from a single tuple constant shared with the client type.

### m6 — Vague `state` variable name conflates UI status with user-facing message
**Sources:** RULES F3, CC F7 (state)
**Locations:** `src/components/checkout-form.tsx:52`, `src/app/checkout/test/page.tsx:8`
**Claim:** `state`/`setState` holds a free-form string ("Loading checkout…", "Ready", "Redirecting to Stripe…", "Saved", "paying"). It conflates a UI status enum with a user-facing message. Split into `status: "loading" | "ready" | "redirecting" | "error"` and `statusMessage: string`.

### m7 — Duplicated fee-group logic across server and client
**Sources:** CC F2
**Locations:** `src/domain/checkout.ts:43-58`, `src/components/checkout-form.tsx:75-86`
**Claim:** The `chargedGroups` Set + `${code}:${addressId}` key construction is copy-pasted. The client cannot import the server function, but the key shape is a shared contract that should live in one exported helper (`fulfillmentFeeGroup(code, addressId)`) and be reused by the client. Drift here silently breaks price parity between preview and charge. (Distinct from B3, which is the dead ternary inside that key.)

### m8 — Type/schema drift: fulfillment code union redeclared on client
**Sources:** CC F3
**Locations:** `src/components/checkout-form.tsx:29,41`
**Claim:** Redeclares `"BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP"` instead of deriving from `keyof typeof fulfillmentFees` (already exported from `src/domain/checkout.ts:9-14`). Adding a new method requires edits in two places; the client union can silently desync from the server's source of truth.

### m9 — Magic string prefixes scattered across files
**Sources:** CC F4
**Locations:** `src/domain/checkout.ts:228,321`, `src/app/api/stripe/webhook/route.ts:46,118`, plus `"pi_local_"`, `"cs_test_local_"`, `"evt_local_"`, `"pending:"` across `checkout/stripe/route.ts`, `checkout/test-complete/route.ts`, `webhook/route.ts:19`
**Claim:** `"checkout.session.completed"` is hardcoded three times and compared once; local Stripe prefixes are sprinkled across files. Centralize as named constants (`STRIPE_CHECKOUT_COMPLETED`, a `localStripePrefixes` map).

### m10 — Inconsistent null-handling for `getStripe()` across call sites
**Sources:** CC F6
**Locations:** `src/app/api/stripe/webhook/route.ts:18-24`, `src/app/api/checkout/stripe/route.ts:128-141`, `src/lib/stripe.ts:21`
**Claim:** Three different strategies for the same null return: skip refund when null; branch on `if (stripe)` with a production 503 fallback; silently substitute a fake-key client. One null source, three policies. Pick one (e.g. "no Stripe in non-production → local mode; production without key → 503") and route every call site through it.

### m11 — Vague standalone names on the banned list
**Sources:** CC F7 (rest)
**Locations:** `src/app/checkout/test/page.tsx:9` (`message`), `src/lib/public-request.ts:35` (`rows`), `src/app/api/stripe/webhook/route.ts:83,86,127` (`intent` — DB record vs Stripe object), `webhook/route.ts:119` and `test-complete/route.ts:34` (`outcome`), `checkout-form.tsx:57,121` / `order-builder.tsx:133,145,172,199,207` / `test/page.tsx:18` (`payload`)
**Claim:** Rename `message` → `resultMessage`/`payMessage`; `rows` → `throttleRows`; the DB `intent` → `storedIntent` and the Stripe one → `stripeIntent`; `outcome` → `commitResult`/`captureResult`; `payload` → `checkoutPayload`/`draftPayload`/`capturePayload`.

### m12 — Inconsistent error handling in `payments/route.ts` POST/PATCH
**Sources:** CC F10
**Locations:** `src/app/api/admin/orders/[orderId]/payments/route.ts:39`
**Claim:** Throws a bare `new Error("Payment requires an active draft or finalized order.")` inside the transaction. `paymentError` only maps `AccessDeniedError` to 403; everything else re-throws to the framework as a 500 with no JSON body. Zod failures and DB errors get a structured 400/500 via `NextResponse.json`, but this business-rule error does not. Throw a typed `PaymentError` mapped to 409/422, or return `NextResponse.json(..., {status: 409})` directly.

### m13 — Swallowed no-op paths in `processRefund`
**Sources:** CC F11
**Locations:** `src/app/api/stripe/webhook/route.ts:82,86`
**Claim:** Two silent returns (`if (!paymentIntentId) return;` and `if (!intent) return;`) for malformed/unmapped refund events. Not empty catch blocks, but swallowed paths with no audit log. A refund for an intent we don't track is exactly the case an auditor wants recorded — write an `auditLog` row (or at minimum a `stripeWebhookEvent` row with the raw event) before returning. The route records an event for the success path but not for these no-op paths.

### m14 — Double idempotency layer on `checkout.session.completed`
**Sources:** CC F12
**Locations:** `src/app/api/stripe/webhook/route.ts:115-116` (route-level) and `src/domain/checkout.ts:217-220` (transaction-level)
**Claim:** The webhook route checks `db.stripeWebhookEvent.findUnique` and short-circuits, then `commitStripePayment` checks the same table again inside a serializable transaction. Two layers guarding the same event id. The transaction-level check is the correct one (race-safe); the route-level check is an optimization but creates a second place that decides "replayed". If one is ever changed, the other silently drifts. Keep the route check as a pure early-exit optimization with a comment, or drop it and let the transaction decide.

### m15 — `prepareCheckout` returns pre-transaction `order` (misleading return)
**Sources:** CC F13
**Locations:** `src/domain/checkout.ts:124,205`
**Claim:** `order` is loaded before the `$transaction` that updates `orderLine.fulfillmentMethodId`, `fulfillmentFeeCentsSnapshot`, `greetingSnapshot`, and `order.totalCents`. The returned `{ order, subtotalCents, fulfillmentCents, totalCents }` therefore carries stale line state. The only caller (`checkout/stripe/route.ts`) uses just `prepared.totalCents`, so it's currently harmless, but returning `order` invites a future caller to read stale snapshot fields. Drop `order` from the return or reload it after the transaction.

### m16 — `checkout-form.tsx` line-card render is a borderline extraction candidate (info)
**Sources:** CC F15
**Locations:** `src/components/checkout-form.tsx:157-225`, `src/components/order-builder.tsx:338-481`
**Claim:** The per-line `<article>` (bordered card, product summary, select+label rows) repeats across both files. A shared `<LineCard>` shell would dedupe the card chrome. Rule of 2 is met (2 call sites) but the contents differ enough that extraction may add more lines than it saves; flag for the next refactor pass, not a blocker.

---

## Dedupe map (specialist → aggregate)

| Specialist finding | Aggregate |
|---|---|
| SEC HIGH-1 | B1 |
| SEC HIGH-2, Q F8, RULES F4 | B2 |
| Q F1, RULES F1 + F2, CC F1 | B3 |
| Q F2 | B4 |
| SEC MEDIUM-1 | A1 |
| SEC MEDIUM-2, Q F5 | A2 |
| SEC MEDIUM-3, RULES F6 | A3 |
| Q F4 | A4 |
| Q F6, RULES F5 | A5 |
| Q F7, RULES F10 | A6 |
| SEC LOW-3, RULES F7 | A7 |
| Q F3 | A8 |
| CC F8 | A9 |
| SEC LOW-1, Q F9, CC F5 | m1 |
| SEC LOW-2 | m2 |
| CC F9 | m3 |
| RULES F8 | m4 |
| RULES F9, CC F14 | m5 |
| RULES F3, CC F7 (state) | m6 |
| CC F2 | m7 |
| CC F3 | m8 |
| CC F4 | m9 |
| CC F6 | m10 |
| CC F7 (rest) | m11 |
| CC F10 | m12 |
| CC F11 | m13 |
| CC F12 | m14 |
| CC F13 | m15 |
| CC F15 | m16 |

Every specialist finding maps to exactly one aggregate entry. No new findings introduced.

