# Reviewer specialist — Quality

**Arm:** `arm-03`
**Tree / phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Output:** `results/reviews/P5-quality-arm-03.md`
**EXPECTED:** `shared/phases/PHASE-P5-EXPECTED.md`
**Smoke:** `arms/arm-03/workspace/.scratch/PHASE-P5-SMOKE.md` — PASS 5/5

Focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

---

## Summary

Smoke is green (S1–S5 all PASS) and all eight EXPECTED items are demonstrably implemented. The implementation is the most complete P5 of the three arms I have evidence for: hosted Stripe with mock + live paths, idempotency ledger, charged-amount safety refund, refund sync, staff-only POS with void, anti-enumeration draft access, public guards, sequential numbering under `FOR UPDATE`, cached payment status, placeholder rate rules. No regressions vs P1–P4 surfaces are visible.

That said, the phase ships with several real correctness gaps that the smoke does not exercise: a webhook idempotency ordering bug that swallows Stripe retries after transient failures, a stale-price resolution path with no server-side refresh, a weak `tampered_price` check, a dead `REFUNDED` cached status, and a public guard that soft-fails open when browser headers are absent. Findings only below — no score.

---

## EXPECTED item coverage

| # | EXPECTED | Status | Evidence |
|---|---|---|---|
| 1 | Per-recipient fulfillment; bulk = one fee per destination; per-package = fee per recipient + hard zip block | Met | `src/lib/checkout/delivery.ts` — bulk uses `addressOnlyKey` (destination only), per-package uses `destinationKey` (recipient+address); `assertPerPackageZipsAllowed` throws with no manager override. Smoke S2: bulk 2 dest → 1000¢, per-pkg 3 recipients → 2400¢, out-of-zone 12207 blocked. |
| 2 | Greeting: order default + per-recipient override; remembered per recipient for next season | Met | `src/lib/checkout/greetings.ts` — `resolveLineGreeting` precedence override→default→remembered; `rememberRecipientGreeting` upserts `RecipientGreetingMemory` with `lastSeasonId`; lookup is season-agnostic so memories survive across seasons. |
| 3 | Stock + price validation at checkout; conflict/price UI for stale totals | Partial | `src/lib/checkout/validation.ts` detects `stale_price`, `stale_addon_price`, `stock`, `stale_total`, `tampered_price`. Smoke S3 hits 409 with `stale_price` + `stale_total`. **But:** no server-side line-price refresh path exists (see F3), and `tampered_price` is a stub (see F4). |
| 4 | Hosted Stripe Checkout, immediate capture; webhook authenticity + idempotency; charged-amount safety + auto-refund of stale/failed; refund sync | Met with bug | `src/lib/payments/webhook.ts` + `src/lib/stripe/client.ts`: hosted Checkout `mode: "payment"`, signature verify with `timingSafeEqual`, `claimWebhookEvent` idempotency ledger, charged≠expected → `safetyRefund`, finalize-fail → `safetyRefund`, `charge.refunded`/`refund.created` → `recalcOrderPaymentStatus`. Smoke S1 replay=true, S5 safety refund audit≥1. **But:** claim-before-process ordering swallows retries (F1). |
| 5 | Guest checkout tokens + draft ownership anti-enumeration; public endpoint guards (same-origin, rate limit, Zod) | Met with weakness | `src/lib/orders/guest-token.ts` (httpOnly, `timingSafeEqual`, versioned hash), `src/lib/orders/draft-access.ts` (uniform 404 for missing/wrong-principal/discarded/cleared-guest), `src/lib/http/public-guard.ts` (origin + IP rate limit + Zod). **But:** origin guard fails open when `Sec-Fetch-Site` is null (F5). |
| 6 | Staff-only cash/check POS posting + voiding with audit; fulfillment price snapshots preserved | Met | `src/lib/payments/offline.ts` + `src/app/api/checkout/offline/route.ts`: `requirePermission("admin.access")` gates POST+PATCH, `OFFLINE_METHODS` whitelist, `voidPayment` rejects non-cash/check, audit on post+void, `recalcOrderPaymentStatus` after each. Line `unitPriceCents`/`optionAdjustCents`/addOn `unitPriceCents` are snapshots preserved through finalize. Smoke S4: public 401, cash+check ok, void ok, audits≥3. |
| 7 | Order lifecycle: finalize, discard, transitions, sequential numbering, cached payment status | Met | `src/lib/orders/finalize.ts` — `claimNextOrderNumber` uses `SELECT ... FOR UPDATE` then increments; `lockOrderForUpdate` + optimistic `version` guard; `materializePackages` + `reserveOrderInventory` in-tx; `discardDraft` and `transitionOrder` share `runOrderMutation`. `state-machine.ts` is the single source of allowed transitions. Smoke S5: orderNumber set, PAID cached, bad transition 409, discard ok, recalc ok. |
| 8 | Placeholder rate-resolution rules (live Shippo rates deferred to P8) | Met | `delivery.ts` — `placeholderShipRateCents` per SHIP line; comment notes Shippo deferred to P8. `resolveDeliveryFees` returns `shipLineCount`/`shipFeeCents` separately so P8 can swap the formula. |

---

## Findings

### F1 — Webhook idempotency claims the event before processing, swallowing Stripe retries (High)

`src/lib/payments/webhook.ts:282-287` — `claimWebhookEvent` inserts the row and returns `true`/`false` *before* `handleCheckoutSessionCompleted` runs. If processing throws (DB blip, transient Prisma error), the event is already claimed, so the function returns `err`. Stripe retries the same `event.id`; the retry hits `claimWebhookEvent` → duplicate → `false` → `processStripeWebhook` returns `ok({ replay: true })` without reprocessing. The order stays unfinalized and unpaid forever, and Stripe sees a 200 so it stops retrying.

The safety-refund branches mitigate the worst case (charged mismatch and finalize-failure both refund before returning), but any *other* throw (e.g. `db.stripePaymentIntent.upsert` failing mid-transaction, or `recalcOrderPaymentStatus` throwing) leaves the order stuck with no retry path.

Fix: claim only after successful processing, or track a `processing`/`processed` state per event and re-run on retry. At minimum, do not return `replay: true` for an event that was claimed but never successfully processed.

### F2 — `claimWebhookEvent` treats all DB errors as duplicates (Med)

`webhook.ts:47-49` — the `catch {}` returns `false` for any Prisma error, not just `P2002` unique-constraint. A connection drop or deadlocked transaction would be silently reported as `replay: true`, hiding real failures from the caller and from Stripe. Catch should inspect `error.code === "P2002"` and re-throw everything else.

### F3 — Stale-price conflict has no server-side resolution path (Med)

`validation.ts:67-86` flags `stale_price` when `line.unitPriceCents !== line.currentProductPriceCents`, and the conflict message says "Refresh to continue." But nothing in the codebase updates `orderLine.unitPriceCents` after creation — there is no refresh/reprice endpoint and `prepareCheckout` does not re-snapshot. A customer whose product price changed after they added the line is permanently blocked from checkout unless they delete and re-add the line. The smoke only proves the conflict is *detected*, not that it's *resolvable*. Either the UI needs a re-add flow that's documented, or `prepareCheckout` should offer a reprice action when the customer confirms.

### F4 — `tampered_price` check is a stub (Med)

`validation.ts:169-175` — the "tamper" loop only rejects `lineSubtotalCents(line) < 0`. It never compares a client-claimed line total against a server-recomputed one; the `tampered_price` conflict kind is effectively unreachable except for negative totals (which `draftSubtotalCents` already implies). EXPECTED item 3 says "tampered price fails validation" — the S3 smoke does not test tamper, so this passes by not being exercised. Either implement a client-claimed-line-total field + comparison, or drop the conflict kind to avoid implying protection that isn't there.

### F5 — Public guard fails open when `Sec-Fetch-Site` is null (Med)

`src/lib/http/public-guard.ts:55-57` — when `Origin` and `Referer` are both absent, the guard allows the request if `Sec-Fetch-Site` is `same-origin`, `none`, or `null`. The `null` branch means any non-browser client (curl, a CSRF script that strips headers via a redirected POST, some proxies) bypasses the same-origin check entirely. The comment justifies this for "server-to-server smoke," but the guard is applied to customer-facing checkout endpoints. CSRF defense should fail closed: require `Origin` or `Referer` to be present and match, and only relax for an explicit allow-list of internal callers. Combined with F6, this is exploitable in test/staging deployments.

### F6 — `/api/checkout/mock-complete` is a public backdoor in non-mock, non-production envs (Med)

`src/app/api/checkout/mock-complete/route.ts:19-21` gates only on `getStripeMode() !== "mock" && NODE_ENV === "production"`. In `test`/`live` mode with `NODE_ENV !== "production"` (e.g. staging, preview deploys, CI), the route is open: it builds a signed mock `checkout.session.completed` event using `signWebhookPayload` and feeds it to `processStripeWebhook`. Anyone who can guess/obtain a `sessionId` and `orderId` can finalize an order and post a Stripe payment without paying. The route should be disabled unless `getStripeMode() === "mock"` (drop the `NODE_ENV` clause), or moved behind a staff/dev permission.

### F7 — `prepareCheckout` and `createHostedCheckoutSession` are not transactional (Med)

`session.ts:221-281` and `session.ts:399-454` — both functions do a sequence of `db.orderLine.update` (one per recipient line), `db.order.update`, `db.stripeCheckoutSession.create`, `db.auditLog.create`, and (live mode) a Stripe API call, all outside any transaction. A failure midway leaves:
- some lines with the new fulfillment method and some without,
- `order.expectedTotalCents` written but no `StripeCheckoutSession` row (or the reverse — a live Stripe session orphaned with no DB row),
- `version` incremented multiple times for one logical op.

The smoke passes because each step succeeds in isolation, but partial-failure states are untested and will be hard to reconcile. Wrap the DB writes in `db.$transaction` and only call Stripe after the order row is committed; record the Stripe session in a follow-up transaction.

### F8 — `CachedPaymentStatus.REFUNDED` is dead code (Low)

`offline.ts:18-27` — `computeCachedPaymentStatus` never returns `REFUNDED` even though the enum value exists. A fully refunded order (posted net ≤ 0) reports `UNPAID`, which is misleading to staff dashboards and to the lifecycle route's `recalc_payment` consumer. Either compute `REFUNDED` when `postedNet < 0` and there is at least one non-zero historical posting, or remove the enum value to avoid implying the state is reachable.

### F9 — `assertOfflinePaymentStaffOnly(true)` is dead code (Low)

`offline/route.ts:42` and `:141` call `assertOfflinePaymentStaffOnly(true)` with a hardcoded `true` after `requirePermission("admin.access")` has already gated. The function is a no-op there and the public-reject path (`isStaff === false` branch) is unreachable from this route — public callers are rejected by `requirePermission` returning 401 first (smoke S4 `publicStatus: 401`). Either remove the calls, or wire the function to the actual staff boolean so it documents intent. As written it reads like defense-in-depth but does nothing.

### F10 — `safetyRefund` on charged-mismatch leaves a recoverable-but-inconsistent state (Low)

`webhook.ts:117-132` — on charged≠expected, the code refunds, marks the `StripeCheckoutSession` `safety_refunded`, and returns `ok` leaving the order in `DRAFT`. A later legitimate `checkout.session.completed` for the same `session.id` with the correct amount would find the session row, skip the charged-mismatch branch (now matching), and proceed to finalize + post a second payment. The first refund payment row (amount 0, refunded = charged) remains in `order.payments`, so `recalcOrderPaymentStatus` nets it as negative and the order could flip to `UNPAID`/`PARTIAL` despite the second successful charge. Consider marking the session as terminal (`safety_refunded` should block reprocessing) or clearing the orphan refund row when a valid retry lands.

### F11 — `transitionOrder` allows cancellation of PAID orders with no inventory release (Low, likely deferred)

`state-machine.ts` allows `PAID → CANCELLED` and `PLACED → CANCELLED`, and `transitionOrder` performs no inventory release or refund on cancel. For P5 this is arguably fine (admin ops hub is P6, package lifecycle P7–P9), but a staff member cancelling a PAID order via `/api/orders/lifecycle` right now will leave stock reserved and the customer charged. Worth a guardrail ("cancel PAID requires refund + release") or an explicit deferral note in the route.

### F12 — `originAllowed` rate-limit key uses spoofable `x-forwarded-for` (Low)

`public-guard.ts:13-17` — `clientIp` trusts `x-forwarded-for` verbatim. An attacker who controls the header (no trusted proxy hop list) can rotate IPs to defeat the per-IP rate limit on `checkout-prepare` / `checkout-start`. Acceptable for smoke; for production, derive the client IP from the last trusted proxy hop only.

### F13 — `prepareCheckout` writes `expectedTotalCents` from stale line snapshots (Low)

`session.ts:320-339` — when `validation` reports `stale_price` conflicts, `prepareCheckout` still writes `order.expectedTotalCents = validation.subtotalCents + fees + donation`, where `subtotalCents` is computed from the stale `line.unitPriceCents`. The route returns the conflicts (so checkout is blocked), but the order row now carries a stale expected total. A subsequent `createHostedCheckoutSession` re-validates and recomputes, so this is self-correcting on the happy path, but any code that reads `order.expectedTotalCents` between the two calls (e.g. POS, lifecycle recalc) sees a wrong number. Skip the `expectedTotalCents` write when `validation.ok === false`.

---

## Smoke coverage gaps (not failures, but untested by S1–S5)

- **Webhook retry after transient failure** — F1 is not exercised. S1 only replays a *successful* event.
- **Tampered line total** — S3 checks `stale_price`/`stale_total`/`stock`, never `tampered_price` (F4).
- **Refund sync** — `charge.refunded` handler is implemented but no smoke sends a refund event and asserts `refundedCents` increments and cached status updates.
- **Guest checkout end-to-end** — all S1–S5 use `dev_customer_1` (authed). No smoke exercises the guest cookie token, `guestClearedAt` clearing, or anti-enumeration 404 for a wrong-principal draft.
- **POS without prior prepare** — S4 always prepares before posting; the `fresh.expectedTotalCents == null` fallback branch in `offline/route.ts:65-99` is not exercised.
- **Hosted Stripe live mode** — only mock mode runs; the `stripe.checkout.sessions.create` branch is unreachable in smoke.
- **Per-package fee for same recipient at two addresses** — S2 only tests 3 distinct recipients. The `destinationKey` (recipient+address) semantics aren't pinned by a smoke case.

---

## Residual vs plan fidelity

No scope creep observed. Live Shippo (P8), package board/printing/routes (P7–P9), and admin ops hub (P6) are correctly deferred. `placeholderShipRateCents` is the only P8 stub and it's labeled. The mock-complete route (F6) is the one piece of dev scaffolding that leaks into the public surface; everything else stays inside `lib/` or behind staff permissions.

---

## Bottom line

P5 arm-03 is functionally complete against EXPECTED and passes its own smoke. The findings above are correctness/robustness gaps — F1, F3, F5, F6 are the ones I'd want fixed before this arm is allowed into a Test 4 fix pass or a real Stripe live key. The rest are quality nits and dead-code cleanup. Findings only; no score assigned.
