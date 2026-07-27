# P5 Aggregate Review â€” arm-05 (blind)

Reviewer: Aggregate (blind â€” no model names).
Inputs: P5-security, P5-quality, P5-rules, P5-clean-code (arm-05).
Method: Union + dedupe by location+claim. Security blockers survive. No new findings.
Severity map: security/quality Critical â†’ blocker; High â†’ major; Medium/Low â†’ minor/major by impact; clean-code Major â†’ major; Minor â†’ minor; Nit â†’ nit.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 13 |
| Minor | 14 |
| Nit | 3 |
| Informational | 2 |
| **Total** | **35** |

Raw input total: 10 (sec) + 15 (qual) + 16 (rules) + 17 (clean) = 58. Deduped: 35 (23 merges).

## Blockers

### B1 â€” Safety-refund path never issues a refund
- Location: `lib/checkout.ts:235-238`; `app/api/stripe/webhook/route.ts`
- Claim: `completeCheckout` sets `SAFETY_REFUND_REQUIRED` and returns `{ refundNeeded: true, paymentIntentId }`, but no code calls `stripe.refunds.create`, no outbox row, no sweeper/cron. Customer charged with no order/refund.
- Sources: S-C1, Q-H2. Plan ref: R-126/R-169, EXPECTED item 4.

### B2 â€” `charge.refunded` webhook looks up wrong ID; refund sync silently no-ops
- Location: `app/api/stripe/webhook/route.ts:11-20` (`markRefunded`)
- Claim: For `charge.refunded`, `data.object` is a Charge (`ch_...`), not a PaymentIntent. Code uses `event.data.object.id` to look up `stripePaymentIntent.findUnique({ stripeIntentId })` which is stored under `pi_...`. Lookup misses; payment/order never marked REFUNDED. Smoke masks it by faking the id. Correct field is `data.object.payment_intent`.
- Sources: S-C2. Plan ref: R-168, EXPECTED item 4.

### B3 â€” `completeCheckout` does not verify season is OPEN before finalizing
- Location: `lib/checkout.ts:250-267`; contrast `lib/orders.ts:22-29`
- Claim: Hosted-Stripe completion path locks season row, increments `nextOrderNumber`, but never checks `status === "OPEN"`. Webhook after manager closes season still finalizes and claims an order number. Violates R-002 / EXPECTED item 7.
- Sources: Q-C1.

## Majors

### M1 — Rate limiter trusts spoofable `x-forwarded-for[0]`
- Location: `app/api/checkout/[draftId]/route.ts:9-19`; `app/api/newsletter/route.ts:33-45`
- Claim: Both limiters key on `x-forwarded-for[0]`. Attacker sets own XFF; on platforms that append real IP, attacker value wins at `[0]`. Rotating it gives unbounded distinct keys, defeating per-IP limit. Newsletter also falls back to `"unknown"` (shared bucket).
- Sources: S-H1. Plan ref: R-122.

### M2 — `markRefunded` runs before idempotency recording; refund events have no replay guard
- Location: `app/api/stripe/webhook/route.ts:35-41`
- Claim: For `charge.refunded`/`payment_intent.canceled`, `markRefunded` awaited before `webhookEvent.upsert`. Partial success + upsert throw ? Stripe retries ? `markRefunded` re-runs. Upsert has empty `update: {}` so replay always "succeeds". No transactional coupling between side effect and idempotency record. Inconsistent with `completeCheckout` (idempotency first).
- Sources: S-H2, Q-L3. Plan ref: R-167.

### M3 — POS cash/check flow creates a real Stripe Checkout session in production
- Location: `lib/checkout.ts:287-308` (`createPosOrder`); `:146-174` (`createProviderCheckout`)
- Claim: When `STRIPE_SECRET_KEY` set, POS cash/check still POSTs to `/v1/checkout/sessions`, creates orphaned real Stripe session, then completes locally with synthetic `evt_pos_...` and rewrites payment to CASH/CHECK. Smoke only exercises dev path (`delete process.env.STRIPE_SECRET_KEY`). Leaks abandoned sessions into Stripe dashboard; Stripe secret reachable from POS path unnecessarily.
- Sources: S-L3, Q-H1. Plan ref: UR-011, R-170.

### M4 — Guest draft clear-on-success still not implemented (carried from P4 I1)
- Location: `app/components/checkout-flow.tsx:56-72`; `app/components/order-builder.tsx:101`; no `app/checkout/success/` route
- Claim: R-022 / P4 EXPECTED item 5 require guest draft cleared only after success. P5 deferred to it; still missing. `success_url` points to `/checkout/success?session_id=...` but no such route ? returning customer sees 404, draft token stays in `sessionStorage`. `removeItem` only fires on restore-failure.
- Sources: Q-H3.

### M5 — `lib/checkout.ts` is a god file with mixed concerns
- Location: `lib/checkout.ts:1-329`
- Claim: One 329-line module owns delivery-rules settings, fee calc, staleness validation, checkout-detail persistence, Stripe session creation (incl. dev harness), inventory reservation, checkout completion with idempotency/safety-refund, offline payment post/void, POS order creation, webhook signature verification. Mixed-concerns clause triggers split.
- Sources: CC-1.

### M6 — Duplicated inventory-reservation logic
- Location: `lib/checkout.ts:193-208` (`reserveLineInventory`) vs `lib/inventory.ts:20-47` (`reserveInventory`)
- Claim: Two implementations of same atomic `UPDATE ... WHERE available >= qty RETURNING` + `inventoryReservation.create`. Rule of 2 satisfied. Differences: checkout copy throws on miss, shared returns false.
- Sources: R-H3, CC-2.

### M7 — Duplicated order-finalization path bypasses state-machine helper
- Location: `lib/checkout.ts:235-267` vs `lib/orders.ts:10-48`
- Claim: `completeCheckout` finalizes (sets FINALIZED, assigns orderNumber, increments season counter) without `assertOrderTransition`/`finalizeOrder`. Two finalization paths for one state transition.
- Sources: R-H2, CC-5.

### M8 — Duplicated inventory-availability logic, two patterns per concern
- Location: `lib/checkout.ts:86,95` (inline reduce) vs `lib/order-builder.ts:251,261` via `lib/inventory.ts:9` (`getAvailableQuantity`)
- Claim: `assertLiveOrder` recomputes availability inline while `saveDraft` uses the helper. One project, two patterns.
- Sources: R-H1.

### M9 — Duplicated allowed-ZIP source of truth
- Location: `lib/checkout.ts:26-30` (`defaultDeliveryRules.allowedZipCodes = ["11201","11205","11211"]`); `lib/order-builder.ts:80-84`; `lib/storefront.ts:4` (`defaultDeliveryZipCodes`)
- Claim: Three hardcoded copies of Brooklyn ZIP list. Adding a zip requires editing multiple files; drift is silent.
- Sources: R-H4, CC-6.

### M10 — N+1 settings read inside checkout loop / `getDeliveryRules()` called per-recipient and again outside
- Location: `lib/checkout.ts:108-114,111,116`
- Claim: `saveCheckoutDetails` calls `getDeliveryRules()` once per recipient in loop (line 111) and again after (line 116). Each call issues up to two `AppSetting.findUnique` queries. Race window if admin changes setting between reads.
- Sources: R-H5, CC-12.

### M11 — Public checkout endpoint leaks raw internal error messages; bypasses `maskError`
- Location: `app/api/checkout/[draftId]/route.ts:31`; `app/api/checkout/local/route.ts:13` vs `app/api/order/drafts/route.ts:23`, `app/api/order/drafts/[draftId]/route.ts:24`
- Claim: Public checkout route returns `error.message` directly; sibling draft routes use `maskError`. Most exposed P5 surface should mask hardest. Leaks e.g. "Stock changed while payment was being confirmed."
- Sources: CC-3.

### M12 — `CheckoutSession.status` and `StripePaymentIntent.status` are `String` instead of enums
- Location: `prisma/schema.prisma:412,426`
- Claim: `PaymentMethod`/`PaymentStatus` are enums but two P5 status columns are untyped String. Code compares bare literals (`"OPEN"`, `"COMPLETED"`, `"SAFETY_REFUND_REQUIRED"`, `"succeeded"`). Typo compiles silently; safety-refund path especially fragile.
- Sources: CC-4.

### M13 — In-memory rate-limit maps unbounded and per-instance
- Location: `app/api/checkout/[draftId]/route.ts:7`; `app/api/newsletter/route.ts:29`
- Claim: Module-level `Map` with no eviction; grows with each distinct (spoofable) XFF value. Serverless multi-instance ? effective limit = `instances × threshold`; attacker shards across instances. Resets per cold start.
- Sources: S-M2, R-M3, CC-16. Plan ref: R-122, G-024.

## Minors

### m1 — `GET /api/order/drafts/[draftId]` skips same-origin guard
- Location: `app/api/order/drafts/[draftId]/route.ts:8-13`
- Claim: `PUT` checks `hasSameOrigin`, `GET` does not. Inconsistent with rest of route; weakens defense-in-depth (CORS blocks body read in browsers, but gap is inconsistent).
- Sources: S-M1. Plan ref: R-122.

### m2 — Local checkout harness completes sessions without verifying caller ownership
- Location: `app/api/checkout/local/route.ts:5-15`
- Claim: Dev-only harness accepts any `cs_local_*` session id and calls `completeCheckout` with no draft-access token check. Mitigations: NODE_ENV=development, same-origin, random UUID. Still trusts caller's stated session id.
- Sources: S-M3. Plan ref: R-121.

### m3 — `hasSameOrigin` is CSRF-only, not an auth boundary
- Location: `lib/route-auth.ts:56-59`
- Claim: Compares `Origin` to request URL origin. Blocks browser CSRF but not non-browser clients (can set `Origin` freely). Several routes rely on it as the only public-endpoint guard. Not a substitute for auth on state-mutating actions.
- Sources: S-L1.

### m4 — `JSON.parse(body)` in webhook handler is unguarded
- Location: `app/api/stripe/webhook/route.ts:27`
- Claim: After signature validation, `JSON.parse(body)` has no try/catch. Signature-valid malformed JSON (only reachable by secret holder or local harness) throws unhandled ? 500 instead of clean 400.
- Sources: S-L2. Plan ref: R-167.

### m5 — Order default greeting is missing
- Location: `lib/checkout.ts:7-15`; `app/components/checkout-flow.tsx:41-45`
- Claim: EXPECTED item 2 requires "order default + per-recipient override; remembered per recipient". Per-recipient override + remembered preference satisfied via `Address.greetingPreference`; order-level default is not.
- Sources: Q-M1.

### m6 — `voidOfflinePayment` payment-status recalc ignores REFUNDED
- Location: `lib/checkout.ts:310-318`
- Claim: After voiding cash/check payment, `paymentStatus` recomputed as POSTED if any POSTED remains else VOIDED. If order also has REFUNDED Stripe payment, voiding last POSTED cash overwrites paymentStatus with VOIDED, hiding prior refund. REFUNDED should win as terminal state.
- Sources: Q-M2.

### m7 — Delivery fees are not manager-editable
- Location: `app/api/admin/settings/route.ts:40-65`; `app/admin/settings/page.tsx:39`
- Claim: Settings PUT hardcodes `bulkDeliveryFeeCents: 1200` and `perPackageDeliveryFeeCents: 700` on every write; UI exposes only ZIP codes and dates. Manager cannot change fees without DB edit. Placeholder correct for P5; manager surface is the gap.
- Sources: Q-M3. Plan ref: R-032.

### m8 — Checkout UI has no delivery-date picker
- Location: `app/components/checkout-flow.tsx:80-98`
- Claim: Server requires `deliveryDate` on every DELIVERY recipient when `rules.deliveryDates.length > 0` (`lib/checkout.ts:118-124`). Seeded `deliveryDates` is non-empty. UI renders only method + greeting, no date input. Customer using UI with seeded config cannot complete checkout — API rejects "Choose an available Purim-week delivery date."
- Sources: Q-M4.

### m9 — Fulfillment summary and conflict/price UI are incomplete
- Location: `app/components/checkout-flow.tsx:100-112`
- Claim: EXPECTED item 3 / R-037 require checkout summary + conflict/price UI for stale totals. Sidebar `estimatedTotal = draft.totalCents + donationCents` excludes fulfillment fees. Stale-total/price-change errors come back as flat `message` string, no structured conflict UI or refresh-draft affordance.
- Sources: Q-M5.

### m10 — POS flow writes phantom `checkout.completed` audit event
- Location: `lib/checkout.ts:269`; `:296-307`
- Claim: Every POS cash/check order produces two audit rows: `checkout.completed` (no actorId, from `completeCheckout`) and `payment.offline_posted` (staff actorId). First is phantom — misleads audit trail implying customer checkout preceded cash posting.
- Sources: Q-L2.

### m11 — Two readers of same `delivery.zipCodes` setting with different fallback semantics
- Location: `lib/storefront.ts:42-46` (`getDeliveryZipCodes`) vs `lib/checkout.ts:41-51` (`getDeliveryRules`)
- Claim: Both read `delivery.zipCodes` AppSetting with different fallback. `getDeliveryRules` also reads `checkout.deliveryRules` first then falls back to legacy key. Two paths for same setting, no shared reader; `Array.isArray` filter duplicated.
- Sources: CC-7.

### m12 — `completeCheckout` is a god function with eight steps in one transaction
- Location: `lib/checkout.ts:210-272`
- Claim: 62-line transaction function performs session lookup, idempotency guard, replay short-circuit, safety-refund guard, inventory reservation loop, season order-number claim, Payment creation, StripePaymentIntent upsert, Order update, Season increment, CheckoutSession update, AuditEvent. Extracting `assertSessionReplayable`, `reserveCheckoutInventory`, `claimSeasonOrderNumber`, `recordCheckoutPayment` would keep transaction boundary intact.
- Sources: CC-8.

### m13 — `assertLiveOrder` error message conflates two conditions
- Location: `lib/checkout.ts:79`
- Claim: `if (!order || order.status !== "DRAFT") throw new Error("This checkout is no longer available.")` — one message for not-found and for non-DRAFT. Should split to surface expected state.
- Sources: CC-9.

### m14 — Loose Zod at staff POS boundary
- Location: `app/api/admin/orders/[orderId]/offline-payment/route.ts:9` (`checkout: z.unknown()`)
- Claim: Route validates `method` but passes `checkout` as `unknown`; validation deferred to `startCheckout`'s inner schema. Staff endpoint, lower severity, but boundary schema does not enforce shape.
- Sources: R-M4.

## Nits

### n1 — Magic values throughout P5 code
- Location: `lib/checkout.ts:8,14,12,18,27-28,325`; `app/api/checkout/[draftId]/route.ts:14,18`; `lib/order-builder.ts:149,194,196,80-85`
- Claim: Rate-limit window (`60_000`), attempt cap (`12`), guest-token TTL, geocode TTL, donation cap (`100_000`), recipient cap (`100`), webhook tolerance (`300`), fee defaults, ZIP coordinate table — inline literals, no named constants. Webhook tolerance and rate-limit window most consequential.
- Sources: R-M1, CC-10.

### n2 — Vague names in P5 code
- Location: `lib/checkout.ts:150,173,190,171,126,143`; `app/api/checkout/[draftId]/route.ts:7,11`
- Claim: `local` boolean (means "is dev-only local harness" ? `isLocalHarness`); `attempts` Map (? `checkoutRateLimits`); `current` bucket (? `bucket`/`limit`); `body` reused for request and Stripe response (? `stripeResponse`); `checkout` stored wire-format fragment (? `checkoutSnapshot`). `parsed.data`/`event.data` are property accesses, not locals — borderline, not standalone.
- Sources: R-M2, CC-14.

### n3 — `prisma.$transaction` array form and interactive form mixed for similar work
- Location: Array: `app/api/stripe/webhook/route.ts:16-19`, `lib/checkout.ts:128-142`. Interactive: `lib/checkout.ts:211,275,296,311`, `lib/orders.ts:17,51`.
- Claim: Both forms used for similar P5 write work. `markRefunded` (array) mirrors `voidOfflinePayment` (interactive) two-step update. Minor consistency drift.
- Sources: CC-15.

## Informational

### i1 — Live Stripe path is unexercised
- Location: `arms/arm-05/workspace/.scratch/PHASE-P5-STATUS.md:20-22`; `scripts/smoke-p5.ts:60`
- Claim: EXPECTED smoke S1 requires hosted Stripe test checkout. No Stripe test keys available; smoke substitutes local HMAC harness. Real Stripe redirect, real webhook signature verification, `payment_intent.canceled` path not exercised.
- Sources: Q-I1.

### i2 — `completeCheckout` reads only `inventoryItems[0]` per product/add-on
- Location: `lib/checkout.ts:241-247`
- Claim: Reservation picks `inventoryItems[0]`. Safe today only because schema constrains `InventoryItem` to one row per product/add-on (`@@unique([productId])`, `@@unique([productAddOnId])`). Tightly coupled; relaxing constraint later ? silent skip.
- Sources: Q-I2.

### i3 — `codegraph` not used for structural review (process note)
- Location: This review.
- Claim: `codegraph.mdc` requires structural lookups via CodeGraph when index healthy. Subagent (no MCP) used Read/grep. Process gap, not contestant code.
- Sources: R-L4.

### i4 — Purim-week date validation branches not exercised by smoke
- Location: `scripts/smoke-p5.ts:48,113`; `lib/checkout.ts:118-124`
- Claim: Smoke always supplies `deliveryDate: "2026-03-02"` (in seeded list). "Missing deliveryDate" and "invalid deliveryDate" rejection branches never hit. Hard-zip block exercised; date-rule half of EXPECTED item 1/UR-009 not.
- Sources: Q-L1.

### i5 — Redundant manual `origin` header in client fetch
- Location: `app/checkout/local/page.tsx:14`; `app/components/checkout-flow.tsx:62`
- Claim: Browsers set `origin` automatically on same-origin POST; setting it manually is redundant and can mask bugs.
- Sources: R-L2.

### i6 — Convoluted `useState` initializer
- Location: `app/components/checkout-flow.tsx:22-24`
- Claim: Initializer chains `typeof window !== "undefined" && !sessionStorage.getItem(...)` into ternary. Dense; named function would read clearer.
- Sources: R-L3.

### i7 — `as object` cast on `wireFormat`
- Location: `lib/checkout.ts:135`
- Claim: `wireFormat` typed `JsonValue`; `as object` widening cast loses type info without runtime validation.
- Sources: R-L1.

### i8 — `filter(Boolean)` does not narrow Set element type
- Location: `app/components/checkout-flow.tsx:38-39`
- Claim: `new Set(...filter(Boolean))` yields `Set<string | undefined>` because `filter(Boolean)` does not narrow in TS. Type guard `.filter((id): id is string => Boolean(id))` would yield `Set<string>`.
- Sources: CC-17.

### i9 — Idempotency pattern split across two mechanisms for same webhook stream
- Location: `lib/checkout.ts:229-233` vs `app/api/stripe/webhook/route.ts:36-40`
- Claim: `checkout.session.completed` uses `webhookEvent.create` + P2002 catch inside transaction; other events use `webhookEvent.upsert` with empty `update: {}` after side effect. Both achieve idempotency via different primitives; upsert path records event type less consistently.
- Sources: R-M5, CC-11.

### i10 — `createPosOrder` reuses web checkout session then rewrites payment without explaining why
- Location: `lib/checkout.ts:287-308`
- Claim: Three-step dance (startCheckout ? completeCheckout ? rewrite payment to CASH/CHECK) is non-obvious; only signal is `notes: "Posted through staff POS."`. Intent (borrow web checkout's validation/finality, then swap payment method) is hidden. Same location as M3 but distinct claim (code clarity vs functional/security).
- Sources: R-M6, CC-13.

## Prioritized fix list (ONE fix pass)

Order = blocker impact first, then majors that block correctness, then cleanup. Tackle in this order; each item is one focused change.

1. **B1 + B2 (refund system):** Implement actual `stripe.refunds.create` for `SAFETY_REFUND_REQUIRED` sessions (in `completeCheckout` or a sweeper), and fix `markRefunded` to read `data.object.payment_intent` for `charge.refunded`. These two together close the auto-refund requirement (R-126/R-169/R-168, EXPECTED item 4).
2. **B3 (season OPEN gate):** Add `if (season.status !== "OPEN") throw` to `completeCheckout` before claiming order number, mirroring `finalizeOrder` (R-002, EXPECTED item 7).
3. **M3 (POS Stripe leak):** Skip `createProviderCheckout` when `method !== "STRIPE"` in POS path; create a local-only `CheckoutSession` for cash/check (UR-011, R-170).
4. **M4 (guest draft clear):** Add `app/checkout/success/page.tsx` that clears `sessionStorage` draft token on load (R-022, P4 EXPECTED item 5).
5. **M1 + M13 (rate limiter):** Key on platform-trusted IP (last XFF entry or `x-vercel-forwarded-for`), centralize in `lib/route-auth.ts`, add eviction/max-size cap (R-122).
6. **M2 (webhook idempotency ordering):** Move `webhookEvent.upsert` before `markRefunded`, or wrap both in one interactive transaction with the event record as replay guard (R-167).
7. **M11 (error masking):** Route checkout endpoint errors through `maskError` like sibling draft routes.
8. **M12 (status enums):** Convert `CheckoutSession.status` and `StripePaymentIntent.status` to Prisma enums; replace string literals with enum values.
9. **M6 + M7 + M8 + M9 + M10 (dedupe helpers):** Extract `reserveInventory` (shared), `claimSeasonOrderNumber`, use `getAvailableQuantity` in `assertLiveOrder`, single allowed-ZIP constant, single `getDeliveryRules` call hoisted out of loop. One cleanup pass over `lib/checkout.ts`.
10. **M5 + m12 (god file/function split):** Split `lib/checkout.ts` by concern (`lib/checkout/delivery-rules.ts`, `lib/checkout/stripe-session.ts`, `lib/payments/offline.ts`, `lib/payments/webhook.ts`); extract named steps inside `completeCheckout` keeping the transaction boundary.
11. **m8 (delivery-date picker):** Add date `<select>` populated from `rules.deliveryDates` to `checkout-flow.tsx` per recipient.
12. **m6 + m10 (payment-status / audit correctness):** Treat REFUNDED as terminal in `voidOfflinePayment` recalc; skip phantom `checkout.completed` audit for POS-origin flows.
13. **Remaining minors/nits (m5, m7, m9, m11, m13, m14, n1–n3, i1–i10):** Batch as time permits — greeting default, manager fee surface, conflict UI, shared settings reader, error-message split, POS Zod, named constants, vague names, transaction-form consistency, smoke coverage gaps.

## Source tags

- S = P5-security-arm-05.md
- Q = P5-quality-arm-05.md
- R = P5-rules-arm-05.md
- CC = P5-clean-code-arm-05.md

## Dedupe map (merged ? sources)

| Aggregate | Sources merged |
|---|---|
| B1 | S-C1, Q-H2 |
| B2 | S-C2 |
| B3 | Q-C1 |
| M1 | S-H1 |
| M2 | S-H2, Q-L3 |
| M3 | S-L3, Q-H1 |
| M4 | Q-H3 |
| M5 | CC-1 |
| M6 | R-H3, CC-2 |
| M7 | R-H2, CC-5 |
| M8 | R-H1 |
| M9 | R-H4, CC-6 |
| M10 | R-H5, CC-12 |
| M11 | CC-3 |
| M12 | CC-4 |
| M13 | S-M2, R-M3, CC-16 |
| m1 | S-M1 |
| m2 | S-M3 |
| m3 | S-L1 |
| m4 | S-L2 |
| m5 | Q-M1 |
| m6 | Q-M2 |
| m7 | Q-M3 |
| m8 | Q-M4 |
| m9 | Q-M5 |
| m10 | Q-L2 |
| m11 | CC-7 |
| m12 | CC-8 |
| m13 | CC-9 |
| m14 | R-M4 |
| n1 | R-M1, CC-10 |
| n2 | R-M2, CC-14 |
| n3 | CC-15 |
| i1 | Q-I1 |
| i2 | Q-I2 |
| i3 | R-L4 |
| i4 | Q-L1 |
| i5 | R-L2 |
| i6 | R-L3 |
| i7 | R-L1 |
| i8 | CC-17 |
| i9 | R-M5, CC-11 |
| i10 | R-M6, CC-13 |

## Smoke reconciliation (from quality review)

- S1 (Stripe web checkout): PASS via local harness only (i1). Real Stripe redirect unexercised.
- S2 (Delivery fees + zip block): PASS. Date-rule branches not covered (i4).
- S3 (Stale price/stock): PASS.
- S4 (POS cash/check): PASS for dev/local path. Production path creates real Stripe session (M3).
- S5 (Lifecycle): PASS for discard/forbidden transitions/refund sync flag/safety-refund flag. Auto-refund not executed (B1); season-OPEN gate not enforced on checkout path (B3).

## Out of scope (noted, not scored)

- `lib/dev-auth.ts` dev session tokens — P1 identity surface.
- `app/api/setup/route.ts` bootstrap lockout — P1.
- `app/api/admin/security/route.ts`, `app/api/audit/route.ts` — admin surface, not P5-specific.
- Live Shippo rate margin — deferred to P8.
- Package board, printing, routes — deferred to P7/P9.
- Full admin ops hub, POS builder shell — deferred to P6.
