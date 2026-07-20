# P5 fix pass — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Input:** `AGGREGATE-REVIEW-P5.md` (B1 + priority majors M1–M6). Single pass.
**Result:** all 7 targeted findings fixed. Smoke 52/52 PASS (`.scratch/p5-smoke-output.log`),
pages 3/3 PASS, `npm run ci` green (lint, typecheck, migration guard, 41/41 unit tests).

## B1 — webhook secret must not default in real mode (FIXED)

`lib/env.ts`: schema now fails startup (superRefine) when `STRIPE_SECRET_KEY` is set but
`STRIPE_WEBHOOK_SECRET` still equals the repo-committed `whsec_dev_mock_secret`
(`DEV_WEBHOOK_SECRET` constant). Loaded via `instrumentation.ts`, so a real-mode deploy with the
public default never serves a request. `.env.example` documents both guards.
Evidence: `p5-env-guard.ts real-default` → throws; `mock-ok` → boots.

## M1 — mock gateway fallback without production guard (FIXED)

Same env guard: `NODE_ENV=production` (outside `next build`'s
`phase-production-build`) without `STRIPE_SECRET_KEY` fails startup. Defense in depth:
`getPaymentGateway()` (`lib/payments/stripe.ts`) throws instead of returning the mock in
production, so even a bypassed startup check cannot mint fake "paid" orders.
Evidence: `p5-env-guard.ts prod-no-key` → throws.

## M2 — refund sync listened for non-existent event types (FIXED)

`app/api/webhooks/stripe/route.ts` now handles `charge.refunded` (charge object: syncs every
succeeded refund from the embedded `refunds.data` list, or books the cumulative
`amount_refunded` delta under a deterministic key when the list is omitted) and
`charge.refund.updated` (refund object, only when `status === "succeeded"`); the phantom
`refund.created`/`refund.updated` branches are gone. All rows land through the idempotent
`recordRefund` keyed on the unique refund id.
Evidence: smoke posts a hand-signed `charge.refunded` → −300 row; replay → no-op.

## M3 — duplicate payment row on finalize-after-payment failure (FIXED)

`autoRefund` now takes `chargeAlreadyRecorded`: the finalize-failure path (charge was posted by
`postPayment` moments earlier) no longer books a second positive row — one Stripe charge, one
ledger charge, one refund. The safe===false path still books both sides (charge in, refund out).
`autoRefund` also routes both writes through `postPayment`/`recordRefund` (one pattern for money
writes) and skips everything if the refund row already exists (retry-safety).
Evidence: smoke drops stock to 0 after checkout, pays → exactly 1 charge + 1 refund row, net 0.

## M4 — idempotency ledger committed before the money work (FIXED)

`StripeWebhookEvent` gained `status` (`pending` default; migration
`20260721070000_webhook_event_status` backfills existing rows to `processed`). The unique insert
claims the event id as pending; the flip to `processed` happens only after the handlers return.
A replay of a processed event is a no-op; a redelivery of a pending event (crash mid-work, 5xx
retry) reprocesses through retry-safe handlers — prior charge detected by payment-intent row,
refunds by unique refund id, finalize skipped when the order is already FINALIZED, and the
charged-amount safety check accepts the partially-completed states only on such retries. An
event delivery can no longer be permanently lost. Residual (documented, DECISION-P5-8): two
concurrent deliveries of the same pending event could double-process in a narrow window; Stripe
retries are sequential, accepted.
Evidence: ledger query after full smoke → all rows `processed`, none `pending`.

## M5 — auto_refunded claimed when the refund API failed (FIXED)

`autoRefund` returns whether the refund reached the gateway. On failure the session is marked
**`refund_failed`** (never `auto_refunded`), the order is left untouched (not discarded) for ops
to reconcile, and the charge row is still booked so the ledger matches Stripe. Both caller
branches honor the result.
Evidence: code path — the mock gateway's `createRefund` cannot fail, so the failure branch is
not reachable in this harness; success path exercised twice in smoke (S5 + M3 checks).

## M6 — dead voidPayment helper diverging from the void route (FIXED)

`voidPayment` (`lib/payments/post-payment.ts`) is now the single void implementation: takes the
`StaffContext`, refuses STRIPE payments and already-voided rows (typed result), recalcs payment
status and writes the audit row in the same transaction. The admin void route delegates to it and
maps the result to 400/409. No second implementation left to drift.
Evidence: smoke — void + audit (S4), double void → 409, Stripe void → 400.

## Not touched

M7–M11 and all minors were out of scope for this pass per the fix brief (money/security majors
only). `.scratch/PHASE-P5-SMOKE.md` updated with the fix-pass evidence; DECISION-LOG gained
DECISION-P5-7/8/9.
