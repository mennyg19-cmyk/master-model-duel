# P5 Rules Review — arm-05

Reviewer: Rules specialist (blind — no model names).
Scope: P5 checkout/payments code in `arms/arm-05/workspace/`.
Rules graded: arm-05 always-on catalog (`clean-code.mdc`, `vocabulary.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`).
Method: Read-only findings. No fixes.

## Summary counts

- Critical: 0
- High: 5
- Medium: 7
- Low: 4
- Total: 16

## Findings

### H1 — High — Duplicated inventory-availability logic, two patterns per concern

- **Location:** `lib/checkout.ts:86`, `lib/checkout.ts:95`; vs. `lib/order-builder.ts:251`, `lib/order-builder.ts:261` via `lib/inventory.ts:9`.
- **Claim:** `assertLiveOrder` recomputes availability with an inline `reduce((sum, item) => sum + item.quantityOnHand - item.quantityReserved, 0) < line.quantity`, while `saveDraft` uses the `getAvailableQuantity()` helper for the same calculation. One project, two patterns for one concern.
- **Rule:** `clean-code.mdc` Consistency (one pattern per concern); Duplicated logic category.
- **Evidence:** `lib/inventory.ts:9-14` exports `getAvailableQuantity`; `lib/checkout.ts:86` and `:95` do not call it.

### H2 — High — Duplicated order-finalization path bypasses the state-machine helper

- **Location:** `lib/checkout.ts:235-267`; vs. `lib/orders.ts:10-48`.
- **Claim:** `completeCheckout` finalizes the order (sets `status: "FINALIZED"`, assigns `orderNumber`, increments season counter) without calling `assertOrderTransition` or `finalizeOrder`. Two finalization code paths exist for one state transition.
- **Rule:** `clean-code.mdc` Consistency; Duplicated logic.
- **Evidence:** `lib/orders.ts:4-14` defines `allowedTransitions` + `assertOrderTransition`; `lib/checkout.ts:263-267` updates status directly with an inline `status !== "DRAFT"` check instead of the helper.

### H3 — High — Duplicated inventory-reservation logic

- **Location:** `lib/checkout.ts:193-208` (`reserveLineInventory`); vs. `lib/inventory.ts:20-47` (`reserveInventory`).
- **Claim:** Both implement the same atomic `UPDATE ... WHERE available >= qty RETURNING` + `inventoryReservation.create` pattern. The checkout copy is private and does not return a boolean like the shared one.
- **Rule:** `clean-code.mdc` Duplicated logic; Rule of 2 (2+ call sites, should be one helper).
- **Evidence:** Same SQL shape, same table, same reservation row creation; `lib/inventory.ts:30-44` and `lib/checkout.ts:199-207`.

### H4 — High — Duplicated allowed-ZIP source of truth

- **Location:** `lib/checkout.ts:26-30` (`defaultDeliveryRules.allowedZipCodes` = `["11201","11205","11211"]`); `lib/order-builder.ts:80-84` (`coordinatesForPostalCode` keys = same three zips).
- **Claim:** Two hardcoded copies of the allowed-ZIP list. Adding a zip requires editing two files; drift is silent.
- **Rule:** `clean-code.mdc` Magic values; Type/schema drift (single source of truth).
- **Evidence:** Identical three-zip literal in two modules; no shared constant.

### H5 — High — N+1 settings read inside checkout loop

- **Location:** `lib/checkout.ts:108-114`.
- **Claim:** `saveCheckoutDetails` calls `getDeliveryRules()` once per recipient inside the loop (line 111) and again outside (line 116). Each call issues up to two `AppSetting.findUnique` queries.
- **Rule:** `ponytail.mdc` ladder (minimum code, no waste); `clean-code.mdc` Anti-AI-tics ("just in case" code).
- **Evidence:** `getDeliveryRules()` at `lib/checkout.ts:41-51` runs `prisma.appSetting.findUnique`; called in loop body at `:111` and again at `:116`.

### M1 — Medium — Magic numbers not named

- **Location:** `app/api/checkout/[draftId]/route.ts:14` (`60_000`), `:18` (`12`); `lib/order-builder.ts:149` (`1000*60*60*24*30`), `:194` and `:196` (`1000*60*60*24*90`); `lib/checkout.ts:8` (`100_000`), `:14` (`100`).
- **Claim:** Rate-limit window, attempt cap, guest-token TTL, geocode TTL, donation cap, recipient cap are inline literals.
- **Rule:** `clean-code.mdc` Magic values.
- **Evidence:** No `const` aliases at module scope for any of these values.

### M2 — Medium — Vague standalone name `data` used

- **Location:** `lib/checkout.ts:179` (`parsed.data`), `app/api/stripe/webhook/route.ts:27` (`event` is fine, but `data` field accessed); `lib/checkout.ts:171` (`body`).
- **Claim:** `parsed.data` is a Zod output property (not a local), so borderline; the route's `body` is acceptable. Flagging only as a reminder that `data`/`result`/`info` are banned as standalone names — none of the locals here cross that line, but the `as { id?: string; ... }` at `lib/checkout.ts:171` and `as StripeEvent` at `webhook/route.ts:27` lean on unverified casts.
- **Rule:** `clean-code.mdc` Naming Conventions; Anti-AI-tics (redundant type assertions).
- **Evidence:** `parsed.data` is a property access; the `as` casts at `:171` and `webhook/route.ts:27` are not runtime-validated. Severity capped because the names themselves are not standalone locals.

### M3 — Medium — In-memory rate limiter not shared across instances

- **Location:** `app/api/checkout/[draftId]/route.ts:7-19`.
- **Claim:** `attempts` is a module-level `Map` keyed by `x-forwarded-for`. On Vercel serverless each instance keeps its own map, so the 12-per-minute cap is per-instance, not per-IP. The plan cites `R-122` (IP rate limit).
- **Rule:** `workflow.mdc` Security Basics (least privilege by default); `clean-code.mdc` Anti-Hallucination (don't claim a guard that doesn't hold at the deploy target).
- **Evidence:** No persistence, no shared store; `Map` resets per cold start.

### M4 — Medium — Loose Zod at staff POS boundary

- **Location:** `app/api/admin/orders/[orderId]/offline-payment/route.ts:9` (`checkout: z.unknown()`).
- **Claim:** The route validates `method` but passes `checkout` through as `unknown`; validation is deferred to `startCheckout`'s inner schema. Staff endpoint, so lower severity, but the boundary schema does not enforce shape.
- **Rule:** `clean-code.mdc` Consistency (one validation pattern per boundary); `workflow.mdc` Security Basics.
- **Evidence:** `paymentSchema` only constrains `method`; `checkout` is `z.unknown()`.

### M5 — Medium — Dual webhook-event write

- **Location:** `lib/checkout.ts:228-233` (creates `webhookEvent` inside the finalize transaction); `app/api/stripe/webhook/route.ts:36-40` (upserts the same event after `completeCheckout` returns).
- **Claim:** For `checkout.session.completed`, the event is recorded twice: once inside `completeCheckout` (used for idempotency) and again by the route handler. The second upsert is a no-op on replays but is a redundant write on first delivery.
- **Rule:** `clean-code.mdc` Duplicated logic; `ponytail.mdc` (no "just in case" code).
- **Evidence:** `webhookEvent.create` at `lib/checkout.ts:229`; `webhookEvent.upsert` at `webhook/route.ts:36-40` with empty `update: {}`.

### M6 — Medium — `createPosOrder` reuses the Stripe-session path then overwrites it

- **Location:** `lib/checkout.ts:287-308`.
- **Claim:** POS cash/check orders call `startCheckout` (creates a `CheckoutSession` with `providerSessionId=cs_local_...`) and `completeCheckout` (creates a `STRIPE` payment + `StripePaymentIntent`), then in a third transaction delete the intent and rewrite the payment to `CASH`/`CHECK`. The intermediate Stripe rows are created only to be rewritten.
- **Rule:** `clean-code.mdc` Anti-AI-tics (no "just in case" code, no over-verbose round-trips); `ponytail.mdc` (shortest diff, YAGNI).
- **Evidence:** `createPosOrder` calls `startCheckout` + `completeCheckout` then `stripePaymentIntent.deleteMany` + `payment.update` at `:298-302`.

### M7 — Medium — Hardcoded US 5-digit zip slicing

- **Location:** `lib/checkout.ts:111` (`address.postalCode.slice(0, 5)`); `lib/order-builder.ts:19`, `:30` (regex `/^\d{5}(?:-\d{4})?$/`).
- **Claim:** ZIP handling assumes US format in both the validator and the delivery-rule check. The `Address` schema has a `country` field defaulting to `"US"` but no branch for non-US.
- **Rule:** `clean-code.mdc` Magic values; Consistency.
- **Evidence:** `slice(0, 5)` and the ZIP regex are duplicated assumptions with no shared constant.

### L1 — Low — `as object` cast on `wireFormat`

- **Location:** `lib/checkout.ts:135` (`{ ...(order.wireFormat as object), checkout }`).
- **Claim:** `wireFormat` is typed `JsonValue` by Prisma; the `as object` cast loses type info without runtime validation.
- **Rule:** `clean-code.mdc` Anti-AI-tics (redundant type assertions).
- **Evidence:** `as object` is a widening cast, not a guard.

### L2 — Low — Redundant manual `origin` header in client fetch

- **Location:** `app/checkout/local/page.tsx:14`; `app/components/checkout-flow.tsx:62`.
- **Claim:** Browsers set the `origin` header automatically on same-origin POST; setting it manually is redundant and can mask bugs.
- **Rule:** `clean-code.mdc` Anti-AI-tics (no "just in case" code).
- **Evidence:** `headers: { ..., origin: window.location.origin }` in both client fetches.

### L3 — Low — Convoluted `useState` initializer

- **Location:** `app/components/checkout-flow.tsx:22-24`.
- **Claim:** The initializer chains `typeof window !== "undefined" && !sessionStorage.getItem(...)` into a ternary. The `&&` returns a boolean, then the ternary picks the message. Logic is correct but dense; a named function would read clearer.
- **Rule:** `clean-code.mdc` Anti-AI-tics (no over-verbose code that does in 3 lines what could be clearer); Naming.
- **Evidence:** One expression doing environment check + storage check + message pick.

### L4 — Low — `codegraph` not used for structural review (reviewer-process note)

- **Location:** This review.
- **Claim:** `codegraph.mdc` requires structural lookups via CodeGraph when the index is healthy. This reviewer (subagent, no MCP) used Read/grep for literal and code review. Per the rule, subagents without MCP should rely on the parent to run `codegraph` CLI; that did not happen here. Flagging the process gap, not the contestant code.
- **Rule:** `codegraph.mdc` Hard rule (structural lookups).
- **Evidence:** No `codegraph` invocation in this review's transcript; findings derived from direct Read of P5 files.
