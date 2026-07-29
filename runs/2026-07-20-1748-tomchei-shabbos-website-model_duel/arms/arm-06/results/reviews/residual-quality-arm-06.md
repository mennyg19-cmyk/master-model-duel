# Residual quality review — arm-06 (blind, post-fix)

**Phase:** P5 — Checkout: delivery rules, fees, Stripe hosted checkout, POS, order lifecycle
**Tree graded:** `arms/arm-06/workspace/` (post self-fix)
**Method:** Specialist lenses (correctness, money, concurrency, smoke honesty, regressions) run against the post-fix tree only. Self-review chat and self-fix notes were not read. Pre-fix findings sourced from `results/AGGREGATE-REVIEW-P5.md` to verify what was closed.

## Counts

| Severity | Count |
|---|---:|
| Blocker | 0 |
| Major | 1 |
| Minor | 3 |
| **Total** | **4** |

## Pre-fix finding closeout (P5 aggregate → post-fix tree)

All 4 Majors and 17 of 19 Minors from the P5 aggregate are closed in the tree.

**Majors — all 4 closed:**

- **MAJ-1 (POS finalize / Stripe webhook race)** — Closed. `lib/checkout/pos.ts:35-37` throws `SessionInFlightError` when `order.stripeSessionId` is set. `lib/checkout/webhook.ts:77-89` now refunds new money landing on an already-FINALIZED order. Admin finalize route maps `SessionInFlightError` → 409. Covered by `scripts/test-checkout.mts:440-459`.
- **MAJ-2 (client/server bulk-dedupe key divergence)** — Closed. `checkout-form.tsx:9,107` imports and calls `bulkAddressKey` from `lib/checkout/fulfillment.ts` on the same structured fields.
- **MAJ-3 (public guard triad uneven on drafts)** — Closed. `app/api/drafts/route.ts:63-67` (POST) carries same-origin + rate limit + zod. `app/api/drafts/[draftRef]/route.ts:62-66` (DELETE) carries same-origin + rate limit. GET stays unguarded (read-only, acceptable).
- **MAJ-4 (`checkout.ts` mixed-concerns)** — Closed. Split by concern into `lib/checkout/{submit,pay,webhook,pos,finalize,access,order-load,validate,reservations,shipping-quotes}.ts`.

**Minors — 17 of 19 closed:**

- MIN-1 (safetyRefund released before refund) — Closed. `webhook.ts:42-45` calls `createRefund` before `releaseOrderReservation`; a refund failure leaves the reservation held.
- MIN-2 (audit outside tx for payment void/refund) — Closed. `void/route.ts:25-44` and `payments/route.ts:30-52` write the audit inside the same `$transaction`.
- MIN-3 (safety-refund audit conditional) — Closed. Audit is unconditional inside the tx (`webhook.ts:46-65`); the only skip is a thrown `createRefund`, which also leaves the reservation held.
- MIN-4 (dev-auth bypass on Vercel preview) — Closed. `lib/dev-auth.ts:14-22` requires `APP_ENV === "test"` AND `VERCEL_ENV` not in `{production, preview}`. Fail-closed on any Vercel deploy.
- MIN-5 (safeEqual length short-circuit) — Not changed, but `lib/hmac.ts:30-34` now documents the rationale (every caller compares fixed-length HMAC/PIN outputs). Acceptable resolution of a low-impact finding.
- MIN-6 (status doc misstates counts) — N/A. Lives in `.scratch/` (gitignored, not part of the tree).
- MIN-7 (`.gitignore` ignores `.env` only) — Closed. `.gitignore:3-4` is now `.env*` with `!.env.example`.
- MIN-8 (season closed before finalize) — Closed. `webhook.ts:108-114` checks season status and routes to `safetyRefund` instead of a 500 loop. Covered by `test-checkout.mts:511`.
- MIN-9 (`payCheckout` skips open-season gate) — Closed. `lib/checkout/pay.ts:20-22` asserts the open season.
- MIN-10 (dead `Select` + hand-rolled `<select>`) — Closed. The checkout form now uses `<Select>` from `components/ui/select.tsx`.
- MIN-11 (duplicated greeting loop) — Closed. Extracted to `commitSubmittedOrder` in `lib/checkout/finalize.ts:23-29`.
- MIN-12 (duplicated stock-commit block) — Closed. Extracted to `commitSubmittedOrder` (`finalize.ts:17-21`).
- MIN-13 (duplicated checkout access-context) — Closed. Extracted to `checkoutAccess` in `lib/checkout/access.ts`.
- MIN-14 (duplicated guard preamble) — Closed. Extracted to `guardPublicCheckoutMutation` in `lib/public-guard.ts:28-35`.
- MIN-15 (duplicated domain-error mapping) — Closed. Extracted to `mapDomainError`/`mapDomainErrorOrThrow` in `lib/http-errors.ts`.
- MIN-16 (`// P5:` prefixes) — Mostly closed; 2 sites remain (see MIN-R2).
- MIN-17 (`fulfillmentChoice String?`) — Closed. `prisma/schema.prisma:63` declares `enum FulfillmentChoice`; column at `:461` uses it.
- MIN-18 (unsafe cast of webhook `data.object`) — Closed. `webhook.ts:15-28` defines zod schemas; the route `safeParse`s the envelope and per-type object. A signed-but-malformed payload is a 400.
- MIN-19 (vague names `hit`/`cached`) — Closed. `rate-limit.ts:17` is `tryConsume`; `stripe.ts:38` is `stripeConfigCache`.

## Residual findings (post-fix tree)

### MAJ-R1 — `cancelDraft` clobbers a concurrent webhook finalize (unconditional status update)

**Where:** `lib/orders/drafts.ts:244-253` (`cancelDraft`), reached by `DELETE /api/drafts/[draftRef]`.

```244:253:lib/orders/drafts.ts
export async function cancelDraft(draftRef: string, access: DraftAccess): Promise<boolean> {
  const order = await prisma.order.findUnique({ where: { draftRef } });
  if (!order || order.status !== "DRAFT") return false;
  if (!(await canAccess(order, access))) return false;
  await prisma.$transaction(async (tx) => {
    await releaseOrderReservation(tx, order.id);
    await tx.order.update({ where: { id: order.id }, data: { status: "DISCARDED" } });
  });
  return true;
}
```

The status guard runs outside the transaction; the `tx.order.update` is unconditional on `id` — no `status: "DRAFT"` predicate inside the transaction. Compare `discardOrder` in `lib/orders/state-machine.ts:102-106`, which uses `updateMany` with `where: { id, status: "DRAFT" }` and throws `OrderConcurrencyError` on `count === 0`.

**Race:** a customer submits checkout (reserves stock, sets `stripeSessionId`), starts the hosted Stripe page, then hits `DELETE /api/drafts/[draftRef]`. `cancelDraft` reads DRAFT outside the tx. A Stripe webhook lands and commits `completeCheckoutSession` — DRAFT → FINALIZED, stock committed, payment posted, email queued. `cancelDraft`'s transaction then runs `releaseOrderReservation` (a no-op: `stockReserved` is already false after the webhook's commit) and unconditionally sets status DISCARDED. Net: a FINALIZED order with committed stock and a posted payment is clobbered to DISCARDED — a state/money inconsistency with no audit row for the clobber.

**Severity rationale:** Major, not Blocker. The window is narrow (the customer must cancel at the exact moment the webhook lands) and ownership (session or guest cookie) still contains the blast radius to the ordering customer. But the inconsistency is real and the fix is one line — use the same conditional `updateMany` + `count === 0` guard as `discardOrder`, or re-read the status inside the tx and bail.

### MIN-R1 — No dead-letter row or alerting for a persistently failing safety refund

**Where:** `lib/checkout/webhook.ts:36-66` (`safetyRefund`).

The MIN-1 fix correctly moved `createRefund` before `releaseOrderReservation`, so a refund failure holds the reservation (no double-charge on re-pay). But a *persistent* Stripe refund failure (outage, merchant balance insufficient) still leaves the captured charge outstanding, the reservation held, and no durable dead-letter row or operator alert. The webhook 500s so Stripe retries; `refund-${paymentIntent}` idempotency prevents a double-refund on retry. But a refund that never succeeds has no durable record beyond the server log. Narrow real-world window, hence Minor. Related to the original MIN-1/MIN-3; the re-pay hazard is closed, the operator-visibility hazard is not.

### MIN-R2 — Two `// P5` change-explanation prefixes remain

**Where:** `lib/settings.ts:19` (`// P5 delivery rules (UR-009/G-015)...`), `lib/testops/baseline-seed.ts:186` (`// P5 placeholder rate rules...`).

The "why" content of each comment is good and should stay; the `P5` prefix is the changelog tic MIN-16 called out. 2 of the 9 original sites remain.

### MIN-R3 — `order_finalize` audit commits outside the finalize transaction

**Where:** `app/api/admin/orders/[orderId]/finalize/route.ts:17-24`.

`finalizePosOrder` commits stock + finalize in its own transaction, then the route calls `recordAudit` after the transaction. A crash between commit and audit leaves a finalized order with no `order_finalize` audit row. Same class as the original MIN-2 (which the fix closed for the payment verbs). The P5 aggregate referenced this as the existing contrast pattern, so it is a known minor rather than a regression. Note: the POS checkout flow (`lib/payments/pos.ts`) does not write `order_finalize` at all — only `payment_post` — so the finalize action there has no dedicated audit row.

## Notes (not findings)

- Money math is recomputed server-side from the live catalog in `lib/checkout/validate.ts`; the client-supplied `expectedTotalCents` is a check, not a source of truth. Stock availability is `onHand - reserved` under `SELECT ... FOR UPDATE` row locks (`lib/inventory/reserve.ts`). No money regression.
- Smoke is honest: `scripts/test-p5.mts` (52 checks) and `scripts/test-checkout.mts` exercise the real signature verify, fulfillment validation, fee resolution, bulk dedupe keys, the POS/Stripe race, the season-closed refund, and the webhook payload zod schemas. No fake paid states; the no-keys seam surfaces as explicit 503.
- Webhook authenticity (raw-body HMAC, 5-min replay window, idempotency row, delete-on-fail for Stripe retry) remains correct.
- Charged-amount safety, session-id mismatch refund, and the FINALIZED-branch refund are correct on the post-fix paths.
- Anti-enumeration (404 on ownership miss) is consistent across drafts, checkout, and the address book.
- The checkout lifecycle split is clean — each stage has a single concern and a clear caller; `commitSubmittedOrder` is the shared post-submit core for the webhook and POS paths.
- No regressions detected in the fee math, the state machine, the inventory locks, or the checkout page rendering.
