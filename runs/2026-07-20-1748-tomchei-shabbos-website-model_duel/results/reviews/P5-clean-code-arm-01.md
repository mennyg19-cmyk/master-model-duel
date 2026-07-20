# P5 Clean-code Review — arm-01

**Reviewer:** clean-code specialist
**Phase:** P5 (Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments)
**Rules:** `arms/arm-01/rules/clean-code.md`
**Scope:** P5 touch-set — `src/domain/checkout.ts`, `src/lib/stripe.ts`, `src/lib/public-request.ts`, `src/app/api/checkout/stripe/route.ts`, `src/app/api/checkout/test-complete/route.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/admin/orders/[orderId]/payments/route.ts`, `src/app/checkout/[draftId]/page.tsx`, `src/app/checkout/test/page.tsx`, `src/components/checkout-form.tsx`, `src/components/order-builder.tsx` (P5-relevant parts).

Findings only. No pass/fail verdict.

---

## Findings

### F1 — Dead/duplicate branch in `getFeeGroup` (duplicated logic)
`src/domain/checkout.ts:33-37`

```33:37:src/domain/checkout.ts
function getFeeGroup(choice: CheckoutLineChoice, addressId: string) {
  return choice.fulfillmentCode === "PACKAGE_DELIVERY"
    ? `${choice.fulfillmentCode}:${addressId}`
    : `${choice.fulfillmentCode}:${addressId}`;
}
```

Both ternary arms return the identical string. The conditional is meaningless — either the bulk-vs-per-package grouping logic is wrong (bulk should group by method only, ignoring address, so one fee per destination is charged once per method), or the ternary should be deleted. As written, BULK_DELIVERY with two lines on the same address charges the fee twice (group key differs only by `fulfillmentCode`, which is constant per line). This is both dead code and a likely logic bug; the S2 smoke check ("bulk 2 destinations = 2 fees") would not catch the same-destination bulk case.

### F2 — Duplicated fee-group logic across server and client (duplicated logic)
Server: `src/domain/checkout.ts:43-58` (`calculateFulfillmentFees`, `chargedGroups` Set + `${code}:${addressId}` key).
Client: `src/components/checkout-form.tsx:75-86` (`fulfillmentCents` useMemo, same `chargedGroups` Set + same `${choice.fulfillmentCode}:${line.recipientAddress.id}` key).

The group-key construction is copy-pasted. The client cannot import the server function, but the key shape (`${code}:${addressId}`) is a shared contract that should live in one constant/helper (e.g. exported `fulfillmentFeeGroup(code, addressId)` from `src/domain/checkout.ts`) and be reused by the client. Drift here silently breaks price parity between preview and charge.

### F3 — Type/schema drift: fulfillment code union redeclared on client
`src/components/checkout-form.tsx:29,41` redeclares `"BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP"` instead of deriving from `keyof typeof fulfillmentFees` (already exported from `src/domain/checkout.ts:9-14`). Adding a new method requires edits in two places; the client union can silently desync from the server's source of truth.

### F4 — Magic string prefixes scattered across files (magic values)
`"checkout.session.completed"` is hardcoded three times (`checkout.ts:228`, `checkout.ts:321`, `webhook/route.ts:46`) and compared once (`webhook/route.ts:118`). `"pi_local_"`, `"cs_test_local_"`, `"evt_local_"`, `"pending:"` are sprinkled across `checkout/stripe/route.ts`, `checkout/test-complete/route.ts`, and `webhook/route.ts:19`. Per the rules, magic values should be named constants. A single `const STRIPE_CHECKOUT_COMPLETED = "checkout.session.completed"` and a `localStripePrefixes` map would centralize them.

### F5 — `constructStripeEvent` fallback to a fake Stripe key is "just-in-case" code that cannot work
`src/lib/stripe.ts:20-27`

```20:27:src/lib/stripe.ts
export function constructStripeEvent(payload: string, signature: string) {
  const stripe = getStripe() ?? new Stripe("sk_test_local_webhook_verification");
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    requireStripeWebhookSecret(),
  );
}
```

If `STRIPE_SECRET_KEY` is unset, `getStripe()` returns null and this constructs a real `Stripe` client with a bogus key solely to call `webhooks.constructEvent` — a method that does not need a secret key. If the webhook secret is also unset, `requireStripeWebhookSecret()` throws. The fallback is defensive code for a condition that cannot yield a valid result; either require the secret key and throw early (mirroring `requireStripeWebhookSecret`), or use Stripe's standalone `constructEvent` without instantiating a client. As written it is a "just-in-case" line with no reason.

### F6 — Inconsistent null-handling for `getStripe()` across call sites (inconsistent patterns)
Three different strategies for the same null return:
- `webhook/route.ts:18-24` (`markSafetyRefund`): `const stripe = getStripe(); if (stripe && !paymentIntentId.startsWith("pi_local_"))` — skip refund when null.
- `checkout/stripe/route.ts:128-141`: branch on `if (stripe)` to pick real vs. local session, with a production 503 fallback.
- `stripe.ts:21`: silently substitute a fake-key client.

One null source, three policies. Pick one (e.g. "no Stripe in non-production → local mode; production without key → 503") and route every call site through it.

### F7 — Vague standalone names on the banned list
- `state` in `src/components/checkout-form.tsx:52` and `src/app/checkout/test/page.tsx:8` — `state` is used as a free-form string that holds loading text, error messages, and `"Ready"`/`"Saved"`/`"paying"` labels. It conflates a UI status enum with a user-facing message. Split into `status: "loading" | "ready" | "redirecting" | "error"` and `statusMessage: string`.
- `message` in `src/app/checkout/test/page.tsx:9` — standalone `message` is vague; `resultMessage` or `payMessage`.
- `rows` in `src/lib/public-request.ts:35` — `rows[0]?.attempts`; name the row (`throttleRows`).
- `intent` in `webhook/route.ts:83,86` (DB record) and `webhook/route.ts:127` (Stripe `event.data.object`) — same name, two different shapes in one file. Rename the DB one to `storedIntent` and the Stripe one to `stripeIntent`.
- `outcome` in `webhook/route.ts:119` and `test-complete/route.ts:34` — vague; `commitResult` / `captureResult`.
- `payload` in `checkout-form.tsx:57,121`, `order-builder.tsx:133,145,172,199,207`, `test/page.tsx:18` — borderline but pervasive; `checkoutPayload`, `draftPayload`, `capturePayload` would read clearer.

### F8 — Mixed concerns in `src/domain/checkout.ts` (god file by concern)
353 lines, one file, seven concerns: fee constants + fee calc, conflict detection, checkout preparation, inventory reservation, order finalization + sequential numbering, Stripe payment commit + idempotency, payment-status recalculation, and remembered-greeting persistence. The rule says split when mixed concerns (not just >500 lines). Candidates: `fulfillment-fees.ts`, `checkout-conflicts.ts`, `checkout-prepare.ts`, `payment-commit.ts`, `payment-status.ts`. Each has a single clear concern and would shrink the surface reviewers must hold in head.

### F9 — Duplicated "instanceof X ? json : rethrow" error helper (duplicated logic)
- `src/lib/public-request.ts:56-61` `publicRequestErrorResponse`
- `src/app/api/admin/orders/[orderId]/payments/route.ts:15-20` `paymentError`

Identical shape: `if (error instanceof X) return Response.json({error: error.message}, {status}); throw error;`. Two call sites, one pattern — extract a generic `typedErrorResponse<T extends Error>(error, Type, status)` helper into `src/lib/http.ts` (or similar). Currently every new guarded route reinvents this.

### F10 — Inconsistent error handling in `payments/route.ts` POST/PATCH
`src/app/api/admin/orders/[orderId]/payments/route.ts:39` throws a bare `new Error("Payment requires an active draft or finalized order.")` inside the transaction. `paymentError` only maps `AccessDeniedError` to a 403; everything else re-throws to the framework as a 500 with no JSON body. Zod failures and DB errors get a structured 400/500 via `NextResponse.json`, but this business-rule error does not. Either throw a typed `PaymentError` that `paymentError` maps to 409/422, or return a `NextResponse.json(..., {status: 409})` directly. One error-handling approach per project.

### F11 — Swallowed no-op paths in `processRefund`
`src/app/api/stripe/webhook/route.ts:82,86`

```82:86:src/app/api/stripe/webhook/route.ts
  if (!paymentIntentId) return;
  const intent = await db.stripePaymentIntent.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
  });
  if (!intent) return;
```

Two silent returns for malformed/unmapped refund events. Not empty catch blocks, but swallowed paths with no audit log. A refund for an intent we don't track is exactly the case an auditor wants recorded — write an `auditLog` row (or at minimum a `stripeWebhookEvent` row with the raw event) before returning. The route does record an event for the *success* path but not for these no-op paths.

### F12 — Double idempotency layer on `checkout.session.completed` (inconsistent pattern)
The webhook route checks `db.stripeWebhookEvent.findUnique` at `webhook/route.ts:115-116` and short-circuits. Then `commitStripePayment` checks the same table again at `checkout.ts:217-220` inside a serializable transaction. Two layers guarding the same event id. The transaction-level check is the correct one (it's race-safe); the route-level check is an optimization but creates a second place that decides "replayed". If one is ever changed, the other silently drifts. Either keep the route check as a pure early-exit optimization with a comment, or drop it and let the transaction decide.

### F13 — `prepareCheckout` returns pre-transaction `order` (misleading return)
`src/domain/checkout.ts:124,205` — `order` is loaded before the `$transaction` that updates `orderLine.fulfillmentMethodId`, `fulfillmentFeeCentsSnapshot`, `greetingSnapshot`, and `order.totalCents`. The returned `{ order, subtotalCents, fulfillmentCents, totalCents }` therefore carries stale line state. The only caller (`checkout/stripe/route.ts`) uses just `prepared.totalCents`, so it's currently harmless, but returning `order` invites a future caller to read stale snapshot fields. Either drop `order` from the return or reload it after the transaction.

### F14 — Awkward `z.enum` cast from `Object.keys` (pattern smell)
`src/app/api/checkout/stripe/route.ts:28-31`

```28:31:src/app/api/checkout/stripe/route.ts
        fulfillmentCode: z.enum(Object.keys(fulfillmentFees) as [
          keyof typeof fulfillmentFees,
          ...(keyof typeof fulfillmentFees)[],
        ]),
```

The `as [T, ...T[]]` cast is a workaround for `z.enum` requiring a non-empty tuple. Define `const FULFILLMENT_CODES = Object.keys(fulfillmentFees) as FulfillmentCode[]` and `z.enum(FULFILLMENT_CODES as [FulfillmentCode, ...FulfillmentCode[]])` once, or use `z.enum(["BULK_DELIVERY","PACKAGE_DELIVERY","SHIPPING","PICKUP"] as const)` derived from a single tuple constant shared with the client type (see F3).

### F15 — `checkout-form.tsx` line-card render is a candidate extraction (duplicated UI shape)
`src/components/checkout-form.tsx:157-225` renders one `<article>` per line with fulfillment select, delivery-day select, and greeting textarea. The same per-line article structure (bordered card, product summary, select+label rows) appears in `order-builder.tsx:338-481`. Not identical, but the "line card with labeled selects" pattern repeats. A shared `<LineCard>` shell would dedupe the card chrome. Borderline — Rule of 2 is met (2 call sites) but the contents differ enough that extraction may add more lines than it saves; flag for the next refactor pass, not a blocker.

---

## Summary

15 findings. Highest-impact: **F1** (likely bug + dead branch), **F5** (unworkable fallback), **F2/F3** (server/client drift on fees + types), **F8** (god file by concern), **F10/F11** (error-handling consistency). The rest are naming, magic-value, and pattern-drift items per the clean-code rubric.
