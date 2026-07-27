# P5 Quality Review — arm-05

Reviewer: Quality specialist (blind — no model names).
Scope: P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments.
Plan ref: `shared/MERGED-BUILD-PLAN.md` § P5; `shared/phases/PHASE-P5-EXPECTED.md`.

Format: severity · location · claim · evidence. Findings only — no fixes.

---

## Summary counts

- Critical: 1
- High: 3
- Medium: 5
- Low: 4
- Informational: 2
- Total: 15

---

## Critical

### C1 — `completeCheckout` does not verify the season is OPEN before finalizing

- **Severity:** Critical
- **Location:** `lib/checkout.ts:250-267` (the `completeCheckout` transaction); contrast `lib/orders.ts:22-29`
- **Claim:** The production checkout-completion path locks the season row and increments `nextOrderNumber` but never checks `status = "OPEN"`. A webhook arriving after a manager closes the season (or a POS order posted after close) still finalizes and claims an order number. `finalizeOrder` enforces the OPEN gate, but the hosted-Stripe path that the storefront actually uses does not. This violates the P3 season gate (R-002) and EXPECTED item 7 (lifecycle/numbering must respect season state).
- **Evidence:** Lines 250-254 run `SELECT "nextOrderNumber" FROM "Season" WHERE "id" = ${session.order.seasonId} FOR UPDATE` and only fail if the season row is missing. Lines 263-267 update the order to FINALIZED and increment `nextOrderNumber` unconditionally. `lib/orders.ts:27-29` shows the gate exists for the manual `finalizeOrder` path (`if (season.status !== "OPEN") throw`). No equivalent guard in `completeCheckout`.

---

## High

### H1 — POS cash/check flow creates a real Stripe Checkout session in production

- **Severity:** High
- **Location:** `lib/checkout.ts:287-308` (`createPosOrder`); `lib/checkout.ts:146-174` (`createProviderCheckout`)
- **Claim:** `createPosOrder` calls `startCheckout`, which calls `createProviderCheckout`. When `STRIPE_SECRET_KEY` is set (production), this creates a real hosted Stripe Checkout session for a cash/check POS order. The flow then immediately calls `completeCheckout` with a synthetic `evt_pos_${sessionId}` event id, marking that Stripe session COMPLETED without any Stripe payment. The POS order thus bypasses Stripe entirely while leaving an orphaned session on Stripe's side, and the smoke test only exercises the dev/local branch (`delete process.env.STRIPE_SECRET_KEY`).
- **Evidence:** `createPosOrder` (line 294) calls `await startCheckout(orderId, input, requestUrl)`; `startCheckout` (line 180) calls `createProviderCheckout`; `createProviderCheckout` (lines 147-173) issues `POST https://api.stripe.com/v1/checkout/sessions` whenever `STRIPE_SECRET_KEY` is set. `smoke-p5.ts:60` does `delete process.env.STRIPE_SECRET_KEY`, so the smoke never hits this branch. There is no POS-specific path that skips Stripe.
- **Evidence:** After completion, `createPosOrder` (lines 296-307) deletes the `stripePaymentIntent` and rewrites the STRIPE payment row to CASH/CHECK, but the Stripe session created at line 166 still exists upstream.

### H2 — Auto-refund of stale/failed is marked but never executed

- **Severity:** High
- **Location:** `lib/checkout.ts:235-238` (safety branch); `app/api/stripe/webhook/route.ts:29-34`
- **Claim:** When `completeCheckout` detects a charged-amount mismatch or non-DRAFT order, it sets the CheckoutSession to `SAFETY_REFUND_REQUIRED` and returns `{ refundNeeded: true, paymentIntentId }`. No code path actually issues a Stripe refund. The webhook route returns that object straight to the Stripe caller. EXPECTED item 4 requires "charged-amount safety checks with auto-refund of stale/failed" — the detection is present, the auto-refund is not.
- **Evidence:** `completeCheckout` lines 235-238 set `status: "SAFETY_REFUND_REQUIRED"` and return `refundNeeded: true`; there is no `stripe.refunds.create` or equivalent call anywhere in `lib/checkout.ts` or the webhook route. The webhook handler (lines 32-33) returns `NextResponse.json(completed)` with no follow-up. No sweeper or cron picks up `SAFETY_REFUND_REQUIRED` sessions.

### H3 — Guest draft clear-on-success still not implemented (carried from P4 I1)

- **Severity:** High
- **Location:** `app/components/checkout-flow.tsx:56-72`; `app/components/order-builder.tsx:101`; (no `app/checkout/success/` route)
- **Claim:** R-022 / P4 EXPECTED item 5 require "guest draft cleared only after success". P4 deferred this to P5 (P4 review I1). P5 still does not implement it: there is no `/checkout/success` page, and `sessionStorage.removeItem(storageKey)` only fires when a draft fails to load — never on checkout success. The Stripe `success_url` points to `/checkout/success?session_id={CHECKOUT_SESSION_ID}` but no such route exists, so a returning customer sees a 404 and their draft token stays in `sessionStorage`.
- **Evidence:** `createProviderCheckout` line 152 sets `success_url` to `/checkout/success?session_id={CHECKOUT_SESSION_ID}`. Glob of `app/checkout/success/**` returns zero files. Grep for `removeItem` finds only `order-builder.tsx:101`, which is the restore-failure path. `checkout-flow.tsx` never clears `sessionStorage` on redirect.

---

## Medium

### M1 — Order default greeting is missing

- **Severity:** Medium
- **Location:** `lib/checkout.ts:7-15` (checkout schema); `app/components/checkout-flow.tsx:41-45`
- **Claim:** EXPECTED item 2 requires "Greeting: order default + per-recipient override; remembered per recipient for next season". The schema makes `greeting` a required per-recipient field with no order-level default. The UI defaults each recipient to `address.greetingPreference ?? "Happy Purim!"`, so the saved preference is reused, but there is no order-level default that a customer can set once and override per recipient. The "remembered per recipient" half is satisfied via `Address.greetingPreference` (written at `checkout.ts:138-141`); the "order default" half is not.
- **Evidence:** `checkoutSchema` (lines 9-14) defines `recipients` as an array where each entry has `greeting: z.string().trim().min(1).max(280)` — required, no default. There is no sibling `greeting` field on the order or outside the recipients array. `checkout-flow.tsx:44` sets `greeting: address.greetingPreference ?? "Happy Purim!"` per recipient, with no order-level control.

### M2 — `voidOfflinePayment` payment-status recalc ignores REFUNDED

- **Severity:** Medium
- **Location:** `lib/checkout.ts:310-318`
- **Claim:** After voiding a cash/check payment, the order's `paymentStatus` is recomputed as `POSTED` if any POSTED payment remains, else `VOIDED`. If the order also has a REFUNDED Stripe payment, voiding the last POSTED cash payment overwrites `paymentStatus` with `VOIDED`, hiding the prior refund. The recalc should treat REFUNDED as a terminal state that wins over VOIDED.
- **Evidence:** Lines 315-316: `const activePayments = await transaction.payment.count({ where: { orderId: payment.orderId, status: "POSTED" } }); await transaction.order.update({ ... data: { paymentStatus: activePayments ? "POSTED" : "VOIDED" } })`. No query for REFUNDED payments on the order.

### M3 — Delivery fees are not manager-editable

- **Severity:** Medium
- **Location:** `app/api/admin/settings/route.ts:40-65`; `app/admin/settings/page.tsx:39`
- **Claim:** EXPECTED item 8 / plan R-032 describe placeholder rate-resolution rules. The settings PUT hardcodes `bulkDeliveryFeeCents: 1200` and `perPackageDeliveryFeeCents: 700` on every write; the settings UI exposes only ZIP codes and delivery dates. A manager cannot change the two fee values without editing the database directly. The placeholder is correct for P5; the lack of any manager surface for the fees is the gap.
- **Evidence:** `settings/route.ts:52-53` and `60-61` write literal `1200` and `700` for both the create and update branches. The `settingsSchema` (lines 7-11) has no field for the fees. `settings/page.tsx:39` renders only ZIP and date inputs.

### M4 — Checkout UI has no delivery-date picker

- **Severity:** Medium
- **Location:** `app/components/checkout-flow.tsx:80-98`
- **Claim:** The server requires `deliveryDate` on every DELIVERY recipient when `rules.deliveryDates.length > 0` (`lib/checkout.ts:118-124`). The seeded `checkout.deliveryRules` sets `deliveryDates: ["2026-03-02","2026-03-03"]` (`prisma/seed.ts:147`). The checkout UI renders a method `<select>` and a greeting `<textarea>` per recipient but no date input. A customer using the UI with the seeded config cannot complete checkout — the API will reject with "Choose an available Purim-week delivery date."
- **Evidence:** `checkout-flow.tsx:86-96` renders only method and greeting controls. `RecipientChoice` type (line 15) has no `deliveryDate` field; `beginCheckout` (line 63) sends `{ recipients: choices, donationCents }` with no date. `lib/checkout.ts:118-120` throws when a DELIVERY recipient lacks a date and the rules list is non-empty.

### M5 — Fulfillment summary and conflict/price UI are incomplete

- **Severity:** Medium
- **Location:** `app/components/checkout-flow.tsx:100-112`
- **Claim:** EXPECTED item 3 / R-037 require "checkout recipient/donation/fulfillment summary + conflict/price UI for stale totals". The sidebar shows an `estimatedTotal = draft.totalCents + donationCents` that excludes fulfillment fees ("Delivery fees are calculated when checkout begins"), so the customer does not see the real total before paying. Stale-total and price-change errors come back as a flat string in `message` with no structured conflict UI (no line-by-line breakdown, no "refresh draft" affordance beyond re-fetching).
- **Evidence:** `checkout-flow.tsx:50` computes `estimatedTotal` from `draft.totalCents + donationCents` only. Line 102 states fees are calculated only when checkout begins. Lines 66-69 set `setMessage(body.error ?? "Checkout could not start.")` — a single string, no conflict structure.

---

## Low

### L1 — Purim-week date validation branches are not exercised by smoke

- **Severity:** Low
- **Location:** `scripts/smoke-p5.ts:48,113`; `lib/checkout.ts:118-124`
- **Claim:** The smoke always supplies `deliveryDate: "2026-03-02"` (line 48), which happens to be in the seeded `deliveryDates` list, so the "missing deliveryDate" rejection (line 118) and the "invalid deliveryDate" rejection (line 121) are never hit. The hard-zip block is exercised (line 113), but the date-rule half of EXPECTED item 1/UR-009 is not.
- **Evidence:** `smoke-p5.ts:48` sets `deliveryDate: "2026-03-02"` unconditionally for every checkout call. No smoke case omits the date or supplies a wrong date. `lib/checkout.ts:118-124` has two distinct error branches that have no test coverage.

### L2 — POS flow writes a phantom `checkout.completed` audit event

- **Severity:** Low
- **Location:** `lib/checkout.ts:269` (inside `completeCheckout`); `lib/checkout.ts:296-307` (the POS rewrite)
- **Claim:** Every POS cash/check order produces two audit rows: `checkout.completed` (no actorId, from `completeCheckout`) and `payment.offline_posted` (with staff actorId, from `createPosOrder`). The first row is a phantom — no real checkout happened — and misleads the audit trail by implying a customer checkout preceded the cash posting.
- **Evidence:** `completeCheckout` line 269 unconditionally creates `auditEvent { action: "checkout.completed", subjectId: session.orderId, details: { sessionId, paymentId } }` with no `actorId`. `createPosOrder` line 303 then creates `payment.offline_posted` with `actorId`. There is no flag to skip the checkout-completed audit for POS-originated flows.

### L3 — `markRefunded` runs before webhook idempotency for refund events

- **Severity:** Low
- **Location:** `app/api/stripe/webhook/route.ts:35-41`
- **Claim:** For `charge.refunded` / `payment_intent.canceled`, `markRefunded` executes (lines 35) before the `webhookEvent.upsert` idempotency check (lines 36-40). On a replayed refund webhook, `markRefunded` runs again and the upsert then no-ops. The `checkout.session.completed` path checks idempotency first (lines 229-234 in `lib/checkout.ts`). The ordering is inconsistent across event types; refund handling happens to be idempotent because `status: "REFUNDED"` is a fixed value, but the pattern is fragile.
- **Evidence:** Route lines 35-41: `if (event.type === "charge.refunded" || ...) await markRefunded(event); await prisma.webhookEvent.upsert(...)`. Contrast `lib/checkout.ts:228-234` where the unique constraint is caught inside the transaction before any state mutation.

### L4 — Local checkout harness has no rate limit

- **Severity:** Low
- **Location:** `app/api/checkout/local/route.ts:5-15`
- **Claim:** The dev-only local completion endpoint enforces `NODE_ENV === "development"` and same-origin but no IP rate limit, unlike `/api/checkout/[draftId]` which caps at 12 attempts/min. In dev, an attacker on the same origin can brute-force `cs_local_*` session ids without throttling. Dev-only impact, so low.
- **Evidence:** `checkout/local/route.ts` has no `allowPublicAttempt`-style guard. `checkout/[draftId]/route.ts:7-19` defines the rate limiter but it is not shared with the local route.

---

## Informational

### I1 — Live Stripe path is unexercised

- **Severity:** Informational
- **Location:** `arms/arm-05/workspace/.scratch/PHASE-P5-STATUS.md:20-22`; `scripts/smoke-p5.ts:60`
- **Claim:** EXPECTED smoke S1 requires a "multi-recipient order through hosted Stripe test checkout". No Stripe test keys were available, so the smoke substitutes the local HMAC-signed harness. The status file documents this blocker. The live Stripe redirect, real webhook signature verification against Stripe's payload, and the `payment_intent.canceled` path are not exercised.
- **Evidence:** `PHASE-P5-STATUS.md:20-22` states "No Stripe test keys were available, so the real Stripe API redirect and test webhook were not exercised." `smoke-p5.ts:60` deletes `STRIPE_SECRET_KEY`. The signature verifier (`isValidStripeSignature`) is exercised only against locally-signed payloads.

### I2 — `completeCheckout` reads only `inventoryItems[0]` per product/add-on

- **Severity:** Informational
- **Location:** `lib/checkout.ts:241-247`
- **Claim:** Reservation picks `line.product.inventoryItems[0]` and `addOn.productAddOn.addOnProduct.inventoryItems[0]` as the single inventory row to reserve against. This is correct only because the schema constrains `InventoryItem` to one row per product (`@@unique([productId])`) and per add-on (`@@unique([productAddOnId])`). The code is tightly coupled to that constraint; if a later phase relaxes it, reservation will silently skip other rows.
- **Evidence:** Lines 241-247 index `[0]` without checking length or summing across rows. `prisma/schema.prisma:510-511` shows the unique constraints that make this safe today.

---

## Smoke reconciliation

- S1 (Stripe web checkout): PASS via local harness only (I1). Real Stripe redirect unexercised.
- S2 (Delivery fees + zip block): PASS. Bulk 2 destinations = 2 fees; per-package 3 recipients = 3 fees; zip `10001` blocked. Date-rule branches not covered (L1).
- S3 (Stale price/stock): PASS. Price change rejected; client-supplied `totalCents: 1` ignored by server.
- S4 (POS cash/check): PASS for the dev/local path. Production path creates a real Stripe session (H1).
- S5 (Lifecycle): PASS for discard, forbidden transitions, refund sync, safety-refund flag. Auto-refund not executed (H2); season-OPEN gate not enforced on the checkout path (C1).

---

## Out-of-scope confirmation (not flagged)

- Live Shippo rate margin — correctly deferred to P8.
- Package board, printing, routes — correctly deferred to P7/P9.
- Full admin ops hub, POS builder shell — correctly deferred to P6.
