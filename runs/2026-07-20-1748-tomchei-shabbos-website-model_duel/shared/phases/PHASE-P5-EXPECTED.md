# Phase EXPECTED — P5

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments.

## Must be true when phase is done

1. [ ] Checkout with per-recipient fulfillment method; bulk delivery (one fee per destination) and per-package delivery (fee per recipient, hard zip block)
2. [ ] Greeting: order default + per-recipient override; remembered per recipient for next season
3. [ ] Stock + price validation at checkout; conflict/price UI for stale totals
4. [ ] Hosted Stripe Checkout with immediate capture; webhook authenticity + idempotency; charged-amount safety + auto-refund of stale/failed; refund sync
5. [ ] Guest checkout tokens + draft ownership anti-enumeration; public endpoint guards (same-origin, rate limit, Zod)
6. [ ] Staff-only cash/check POS posting + voiding with audit; fulfillment price snapshots preserved
7. [ ] Order lifecycle: finalize, discard, transitions, sequential numbering, cached payment status
8. [ ] Placeholder rate-resolution rules (live Shippo rates deferred to P8)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Stripe web checkout | Multi-recipient order through hosted Stripe test checkout; webhook replay → one order, one payment, one stock commit |
| S2 | Delivery fees + zip block | Out-of-zone zip blocked for per-package; bulk 2 destinations = 2 fees; per-package 3 recipients = 3 fees |
| S3 | Stale price/stock | Change price/stock after draft; checkout refuses stale totals; tampered price fails validation |
| S4 | POS cash/check | Staff cash/check orders post + void with audit; same methods rejected publicly |
| S5 | Order lifecycle | Allowed/forbidden transitions, numbering, discard, refund, payment-status recalc |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P5-SMOKE.md`

## Out of scope this phase

- Live Shippo rate margin engine (P8)
- Package board, printing, routes (P7–P9)
- Full admin ops hub (P6)
