# P5 Clean-code Review — arm-05

**Scope:** Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments — `shared/MERGED-BUILD-PLAN.md` § P5.
**Rule source:** `arms/arm-05/.cursor/rules/clean-code.mdc`.
**Method:** findings only — no fixes. Severity: `critical` / `major` / `minor` / `nit`.

## Summary

- Critical: 0
- Major: 5
- Minor: 9
- Nit: 3
- Total: 17

---

## Findings

### 1. Major — `lib/checkout.ts` is a god file with mixed concerns

**Location:** `lib/checkout.ts:1-329`.

**Claim:** A single 329-line module owns eight distinct P5 concerns: delivery-rules settings access (`getDeliveryRules`, `isDeliveryRules`, `defaultDeliveryRules`), fee calculation (`totalDeliveryFees`), order staleness validation (`assertLiveOrder`), checkout-detail persistence (`saveCheckoutDetails`), Stripe session creation (`createProviderCheckout`, including the dev-only local harness), inventory reservation (`reserveLineInventory`), checkout completion with idempotency and safety-refund guard (`completeCheckout`), offline payment posting/voiding (`postOfflinePayment`, `voidOfflinePayment`), POS order creation (`createPosOrder`), and Stripe webhook signature verification (`isValidStripeSignature`). The clean-code rule "split when >500 lines, mixed concerns, or a refactor command" triggers on the mixed-concerns clause. Even though the file is under the 500-line soft cap, it bundles delivery rules, payments, POS, and webhook crypto in one module.

**Evidence:** Exports span four unrelated domains: delivery settings (`getDeliveryRules`), checkout orchestration (`startCheckout`, `completeCheckout`), offline/POS payments (`postOfflinePayment`, `createPosOrder`, `voidOfflinePayment`), and webhook signature crypto (`isValidStripeSignature`). A split along concern lines (e.g. `lib/checkout/delivery-rules.ts`, `lib/checkout/stripe-session.ts`, `lib/payments/offline.ts`, `lib/payments/webhook.ts`) would localize each domain and keep each file under the soft cap without changing behavior.

---

### 2. Major — Inventory reservation logic duplicated between `lib/checkout.ts` and `lib/inventory.ts`

**Location:** `lib/checkout.ts:193-208` (`reserveLineInventory`) vs `lib/inventory.ts:20-47` (`reserveInventory`).

**Claim:** Two implementations of the same atomic reserve-and-record operation coexist. `reserveInventory` already exists, is exported, and is the canonical path. `completeCheckout` reimplements the same `UPDATE "InventoryItem" SET "quantityReserved" = ... WHERE ... "quantityOnHand" - "quantityReserved" >= ... RETURNING "id"` plus an `inventoryReservation.create` row. Violates "duplicated logic — pull into `lib/` helpers" and Rule of 2 (2 real call sites now).

**Evidence:** Both functions run the identical SQL with the identical guard (`isActive = true` and `quantityOnHand - quantityReserved >= quantity`), then create the same `InventoryReservation` row. The only differences are: `reserveLineInventory` throws on miss (`if (!updated[0]) throw`), while `reserveInventory` returns `false`; and `reserveInventory` validates `Number.isInteger(quantity)` up front. A single helper with a `throwOnMiss` flag (or two thin wrappers over one SQL helper) would remove the duplicate.

---

### 3. Major — Public checkout endpoint leaks raw internal error messages; bypasses `maskError`

**Location:** `app/api/checkout/[draftId]/route.ts:31` vs `app/api/order/drafts/route.ts:23` and `app/api/order/drafts/[draftId]/route.ts:24`.

**Claim:** The public checkout route returns `error instanceof Error ? error.message : "Checkout could not start."` directly to the client, while the sibling public draft routes route all errors through `maskError(error)`, which redacts internal text in production. Same concern (public-facing order endpoints), two error-handling patterns. The clean-code rules require "one error-handling approach per project" and "Error messages say what went wrong AND what the expected state was" — the raw path leaks internal messages such as "Stock changed while payment was being confirmed." to public callers.

**Evidence:** `lib/foundation.ts:28-31` defines `maskError` for production-safe error masking. `app/api/order/drafts/route.ts:23` and `app/api/order/drafts/[draftId]/route.ts:24` use it. `app/api/checkout/[draftId]/route.ts:31` and `app/api/checkout/local/route.ts:13` do not. The checkout route is the most exposed P5 surface (it accepts recipient/donation input from any same-origin caller) and is the one that should mask hardest.

---

### 4. Major — `CheckoutSession.status` and `StripePaymentIntent.status` are `String` instead of enums

**Location:** `prisma/schema.prisma:412` (`StripePaymentIntent.status String`), `prisma/schema.prisma:426` (`CheckoutSession.status String`).

**Claim:** `PaymentMethod` and `PaymentStatus` are Prisma enums (schema lines 46, 53), but the two P5-introduced status columns are untyped `String`. Code compares against string literals (`"OPEN"`, `"COMPLETED"`, `"SAFETY_REFUND_REQUIRED"` in `checkout.ts:187,234,236,268`; `"succeeded"` in `checkout.ts:260,261`) with no compile-time safety. Violates "type/schema drift — centralize types, single source of truth."

**Evidence:** `completeCheckout` writes `status: "OPEN"` then `status: "COMPLETED"` and `status: "SAFETY_REFUND_REQUIRED"` as bare strings; the safety-refund branch is gated on `session.status === "COMPLETED"` (line 234). A typo like `"SAFETY_REFUND_REQUIRD"` would compile and silently break the safety-refund path. An enum (`CheckoutSessionStatus { OPEN COMPLETED SAFETY_REFUND_REQUIRED }`) would catch this at compile time, matching the existing pattern for `PaymentStatus`.

---

### 5. Major — Season order-number claim duplicated between `completeCheckout` and `finalizeOrder`

**Location:** `lib/checkout.ts:250-267` vs `lib/orders.ts:22-44`.

**Claim:** Two implementations of the same "claim the next sequential per-season order number" operation exist. Both do `SELECT "nextOrderNumber" FROM "Season" WHERE id = ... FOR UPDATE`, then `order.update { orderNumber: season.nextOrderNumber }`, then `season.update { nextOrderNumber: { increment: 1 } }`. Violates "duplicated logic — pull into `lib/` helpers" and Rule of 2 (2 real call sites now: web checkout completion and standalone finalization).

**Evidence:** `completeCheckout` (checkout.ts:250-267) and `finalizeOrder` (orders.ts:22-44) perform the same `FOR UPDATE` lock, the same `orderNumber` assignment, and the same `season.nextOrderNumber` increment. `completeCheckout` additionally writes `paymentStatus: "POSTED"` and a `Payment` row, but the sequence-claim core is identical. A shared `claimSeasonOrderNumber(transaction, orderId)` helper would remove the duplicate and guarantee both paths use the same locking discipline.

---

### 6. Minor — Delivery ZIP list duplicated across `lib/storefront.ts` and `lib/checkout.ts`

**Location:** `lib/storefront.ts:4` (`defaultDeliveryZipCodes = ["11201","11205","11211"]`) vs `lib/checkout.ts:26` (`defaultDeliveryRules.allowedZipCodes = ["11201","11205","11211"]`).

**Claim:** The same hardcoded Brooklyn ZIP list appears in two modules with no shared constant. Violates "magic values — named constants / enums" and "duplicated logic — pull into `lib/` helpers." Drift risk: if the service area changes, both must be edited in lockstep.

**Evidence:** `storefront.ts:4` exports `defaultDeliveryZipCodes`; `checkout.ts:26` embeds the same array inside `defaultDeliveryRules`. Neither imports the other. The two arrays are byte-identical today but have no enforced relationship.

---

### 7. Minor — Two readers of the same `delivery.zipCodes` setting with different fallback semantics

**Location:** `lib/storefront.ts:42-46` (`getDeliveryZipCodes`) vs `lib/checkout.ts:41-51` (`getDeliveryRules`).

**Claim:** Both functions read the `delivery.zipCodes` `AppSetting`, but with different fallback behavior. `getDeliveryZipCodes` returns `defaultDeliveryZipCodes` if the setting is missing or non-array. `getDeliveryRules` reads `checkout.deliveryRules` first, then falls back to `delivery.zipCodes` only for the `allowedZipCodes` field while keeping the default fees. Two code paths for the same setting, no shared reader. Violates "one pattern per concern."

**Evidence:** `getDeliveryZipCodes` (storefront.ts:42) is the P3-era reader. `getDeliveryRules` (checkout.ts:41) is the P5 reader that also reads the legacy key. A caller who wants "the current delivery ZIPs" can hit either function and get a different shape (bare array vs `{ allowedZipCodes, bulkDeliveryFeeCents, ... }`). The legacy fallback inside `getDeliveryRules` (lines 44-50) duplicates the `Array.isArray` + `typeof string` filter already present in `getDeliveryZipCodes`.

---

### 8. Minor — `completeCheckout` is a god function with eight steps in one transaction

**Location:** `lib/checkout.ts:210-272`.

**Claim:** A single 62-line transaction function performs: session lookup, idempotency guard via `webhookEvent.create` + P2002 catch, replay short-circuit, safety-refund guard (amount/status mismatch), inventory reservation loop over lines and add-ons, season order-number claim, `Payment` creation, `StripePaymentIntent` upsert, `Order` status/version update, `Season` increment, `CheckoutSession` status update, and `AuditEvent` creation. The clean-code rule "If a function has more than 3 levels of nesting, refactor it" is borderline (the inventory loop nests 3 deep), but the larger issue is mixed concerns in one body.

**Evidence:** Lines 240-269 chain eight `await transaction.*` calls with no named helpers. The inventory reservation loop (240-249) re-reads `line.product.inventoryItems[0]` and `addOn.productAddOn.addOnProduct.inventoryItems[0]` inline. Extracting `assertSessionReplayable`, `reserveCheckoutInventory`, `claimSeasonOrderNumber`, and `recordCheckoutPayment` would keep the transaction boundary intact while making each step readable.

---

### 9. Minor — `assertLiveOrder` error message conflates two distinct conditions

**Location:** `lib/checkout.ts:79`.

**Claim:** `if (!order || order.status !== "DRAFT") throw new Error("This checkout is no longer available.");` uses one message for two conditions: order not found, and order exists but is not in DRAFT status. The clean-code rule "Error messages say what went wrong AND what the expected state was" is partially met for the second case but not the first.

**Evidence:** A not-found order and an already-finalized order both surface as "This checkout is no longer available." to the caller (and, via finding 3, as a raw leak to public callers). Splitting into `if (!order) throw new Error("This checkout could not be found."); if (order.status !== "DRAFT") throw new Error("This checkout is no longer available because the order is " + order.status + ".");` would distinguish the two and surface the expected state.

---

### 10. Minor — Magic values throughout P5 code

**Location:** `lib/checkout.ts:8` (`100_000`), `:14` (`100` recipients), `:12` (`280` greeting), `:18` (`300` second webhook tolerance), `:27-28` (`1200`/`700` fee defaults), `app/api/checkout/[draftId]/route.ts:14,18` (`12` attempts, `60_000` ms), `lib/order-builder.ts:149,194,196` (`1000*60*60*24*30` and `*90` TTLs), `lib/order-builder.ts:80-85` (hardcoded coordinate table for three ZIPs).

**Claim:** P5 introduces numeric caps, durations, and a coordinate lookup table as inline literals with no named constants. Violates "magic values — named constants / enums." The webhook tolerance (`300`) and the rate-limit window (`60_000`) are the most consequential: they encode Stripe's documented 5-minute tolerance and a 1-minute rate-limit window with no comment or constant.

**Evidence:** `isValidStripeSignature` (checkout.ts:325) compares `Math.abs(Date.now() / 1000 - Number(timestamp)) > 300` — the `300` is Stripe's documented tolerance but is unnamed. `allowPublicAttempt` (route.ts:14,18) uses `60_000` and `12` inline. `coordinatesForPostalCode` (order-builder.ts:80-85) embeds a `Record<string, [number, number]>` for three ZIPs with no comment explaining the source (postal-centroid approximation) or why only three ZIPs.

---

### 11. Minor — Idempotency pattern split across two mechanisms for the same webhook stream

**Location:** `lib/checkout.ts:229-233` (`webhookEvent.create` + P2002 catch) vs `app/api/stripe/webhook/route.ts:36-40` (`webhookEvent.upsert` with empty update).

**Claim:** The Stripe webhook handler uses two different idempotency strategies for the same `WebhookEvent` table. For `checkout.session.completed`, `completeCheckout` inserts via `webhookEvent.create` and catches `P2002` to short-circuit replays. For all other event types, the route does `webhookEvent.upsert` with an empty `update: {}` (insert-or-noop). Both achieve idempotency but via different primitives, and the `upsert` path does not record the event type for replay diagnostics the same way. Violates "one pattern per concern."

**Evidence:** `completeCheckout` (checkout.ts:229-233) creates the `WebhookEvent` inside the same transaction as the order state change, so the P2002 catch doubles as the replay guard. The route handler (webhook route:36-40) calls `upsert` after the `markRefunded` side effect, so a replay of `charge.refunded` would re-run `markRefunded` (which is itself idempotent by `findUnique` + conditional update) and then no-op the `upsert`. Two layers of idempotency for non-checkout events, one layer for checkout events.

---

### 12. Minor — `saveCheckoutDetails` calls `getDeliveryRules()` twice

**Location:** `lib/checkout.ts:111` and `:116`.

**Claim:** The function reads the delivery rules once inside the recipient loop (line 111, inside the `if (recipient.method === "LOCAL_DELIVERY")` branch) and again after the loop (line 116) for the fee calculation and date validation. Two reads of the same setting in one function call. Minor inefficiency and a race window if an admin changes the setting between the two reads.

**Evidence:** Line 111: `if (recipient.method === "LOCAL_DELIVERY" && !((await getDeliveryRules()).allowedZipCodes.includes(address.postalCode.slice(0, 5))))`. Line 116: `const rules = await getDeliveryRules();`. A single `const rules = await getDeliveryRules();` at the top of the function, reused for both the ZIP check and the fee calculation, would remove the double read and the race.

---

### 13. Minor — `createPosOrder` reuses the web checkout session then rewrites the payment to offline without explaining why

**Location:** `lib/checkout.ts:287-308`.

**Claim:** `createPosOrder` calls `startCheckout` (which creates a `CheckoutSession` and a `Payment` with `method: "STRIPE"`), then `completeCheckout` (which finalizes the order and creates a `StripePaymentIntent`), then in a second transaction deletes the `StripePaymentIntent` and rewrites the `Payment.method` to `CASH`/`CHECK` with `externalId: null`. The three-step dance is non-obvious; the only signal is the `notes: "Posted through staff POS."` field. The clean-code rule "Comments only for non-obvious intent" applies: the intent (reuse the web checkout's staleness/stock/finality logic for POS, then swap the payment method) is hidden.

**Evidence:** Lines 294-307: `const checkout = await startCheckout(...); await completeCheckout(...); return prisma.$transaction(async (transaction) => { const payment = await transaction.payment.findUniqueOrThrow({ where: { externalId: checkout.sessionId } }); await transaction.stripePaymentIntent.deleteMany(...); const offlinePayment = await transaction.payment.update({ where: { id: payment.id }, data: { method, externalId: null, notes: "Posted through staff POS." } }); ... })`. No comment explains why POS goes through the Stripe session path. A reader has to infer that `startCheckout`+`completeCheckout` is being borrowed for its validation and finalization, not for its payment.

---

### 14. Minor — Vague names in P5 code

**Location:** `lib/checkout.ts:150,173,190` (`local` boolean), `app/api/checkout/[draftId]/route.ts:7` (`attempts`), `:11` (`current`), `lib/checkout.ts:171` (`body` reused for request and response), `lib/checkout.ts:126,143` (`checkout` field name for a stored wire-format fragment).

**Claim:** The naming rule bans vague standalone names and requires names to describe what they do. `local` as a boolean return from `createProviderCheckout` reads as "is local" but means "is the dev-only local payment harness"; `isLocalHarness` would read as a yes/no question. `attempts` is a `Map<string, { count, resetAt }>` — `checkoutRateLimits` describes the contents. `current` (route.ts:11) is the bucket for one IP — `bucket` or `limit` is tighter. `body` (checkout.ts:171) is reused for both the parsed Stripe response and, by shadowing, the request body in the caller — `stripeResponse` would disambiguate. `checkout` (checkout.ts:126,143) is the parsed input augmented with rules and stored in `wireFormat.checkout` — `checkoutSnapshot` or `wireSnapshot` conveys that it is a stored fragment, not the live checkout.

**Evidence:** `createProviderCheckout` returns `{ sessionId, paymentIntentId, url, local: true | false }` (lines 150, 173); `startCheckout` propagates `local` (line 190). `allowPublicAttempt` reads `const current = attempts.get(key)` (route.ts:11). `createProviderCheckout` does `const body = await response.json() as { id?: string; ... }` (line 171) while the caller passes `body: form` (line 169) — same name, two meanings in one function. `saveCheckoutDetails` returns `{ totalCents, fulfillmentCents, checkout }` (line 143) where `checkout` is then stored as `wireFormat.checkout` (line 135).

---

### 15. Minor — `prisma.$transaction` array form and interactive form mixed for similar work

**Location:** Array form: `app/api/stripe/webhook/route.ts:16-19` (`markRefunded`), `lib/checkout.ts:128-142` (`saveCheckoutDetails`). Interactive form: `lib/checkout.ts:211` (`completeCheckout`), `:275` (`postOfflinePayment`), `:296` (`createPosOrder`), `:311` (`voidOfflinePayment`), `lib/orders.ts:17` (`finalizeOrder`), `:51` (`discardOrder`).

**Claim:** Both transaction forms are used for similar P5 write work. The interactive form is required when the transaction body has conditional control flow (idempotency catch, safety-refund branch, reservation loop). The array form is fine for fixed step sequences. Mixing both for write paths that could share a helper (e.g. `markRefunded` could be interactive like the other payment-status mutators) is a minor consistency drift. Violates "inconsistent patterns — pick one, apply everywhere" at the low end.

**Evidence:** `markRefunded` (webhook route:16) uses the array form for a two-step update that mirrors `voidOfflinePayment`'s interactive two-step update. `saveCheckoutDetails` (checkout.ts:128) uses the array form for an order update plus N address updates, where the interactive form would allow the same. The other six P5 transactional writes use the interactive form.

---

### 16. Nit — In-process rate-limit `Map` is module-scoped and not shared across instances

**Location:** `app/api/checkout/[draftId]/route.ts:7`.

**Claim:** The checkout rate limiter is a module-level `Map<string, { count; resetAt }>` keyed by `x-forwarded-for`. In a serverless deployment this resets per cold start and is not shared across concurrent instances, so the `12`-per-minute limit is per-instance, not per-IP. The pattern is also not centralized in `lib/route-auth.ts`, so any future public endpoint that needs rate limiting would reinvent it. Rule of 2 is not yet triggered (only one call site today), so this is a latent concern rather than a current duplication.

**Evidence:** `const attempts = new Map<string, { count: number; resetAt: number }>();` sits at module scope (route.ts:7). `allowPublicAttempt` (route.ts:9-19) reads and mutates it. No other P5 public endpoint (`/api/order/drafts`, `/api/checkout/local`) applies rate limiting, and `lib/route-auth.ts` exports no rate-limit helper.

---

### 17. Nit — `filter(Boolean)` in `checkout-flow.tsx` does not narrow the Set element type

**Location:** `app/components/checkout-flow.tsx:38-39`.

**Claim:** `new Set(body.draft.wireFormat.lines?.map((line) => line.recipient?.addressId).filter(Boolean))` produces `Set<string | undefined>` because `filter(Boolean)` does not narrow in TypeScript. The subsequent `addressIds.has(address.id)` works (string is assignable to `string | undefined`), but the Set may contain `undefined` entries, and the type does not reflect the intent ("a set of address IDs"). Minor type-safety drift.

**Evidence:** Line 38: `const addressIds = new Set(body.draft.wireFormat.lines?.map((line) => line.recipient?.addressId).filter(Boolean));`. A type guard `.filter((id): id is string => Boolean(id))` would yield `Set<string>` and match the rule's "centralize types, single source of truth" at the low end.

---

## Scope notes

- P5-only scope per task. Findings about `lib/order-builder.ts` (P4) and `lib/storefront.ts` (P3) are included only where P5 code reads from them (`getDeliveryZipCodes`, `defaultDeliveryZipCodes`, `coordinatesForPostalCode` TTLs) and the duplication crosses the P5 boundary.
- No fixes were applied. Each finding lists a location, a claim tied to a clean-code rule, and evidence from the file.
- `clean-code.mdc` is present in `arms/arm-05/.cursor/rules/`, so the review is in scope (not N/A).




