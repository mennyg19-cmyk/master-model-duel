# Phase EXPECTED — P7

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P7 — Package engine live: grouping UI, statuses, print batches, cards.

## Must be true when phase is done

1. [ ] Finalized orders materialize packages via P2 grouping engine
2. [ ] Staff package board: split, regroup, per-package status advance (optional stages; print ≠ shipped)
3. [ ] Fulfillment channel dashboard with bulk status actions + production/savings summaries
4. [ ] Nightly print batch: separate PDF per filing group (slips, labels); reprint per group or order
5. [ ] Greeting-card PDFs per filing group on card stock; per-order packing slip
6. [ ] Printing never auto-advances shipped state (UR-001, G-001–G-004)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Package split/group | Order with 2 recipients × 2 methods → correct packages; split one package → both print; audit retained |
| S2 | Print vs status | Print all artifacts → no stage change; mark Printed/Packed/Sent separately |
| S3 | Batch idempotency | Run nightly batch twice → second idempotent; reprint one group/order without unrelated regen; printed still unshipped |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P7-SMOKE.md`

## Out of scope this phase

- Live Shippo labels / rate margin (P8)
- Delivery routes, driver magic links, reroute (P9)
- SMS/email notifications (P11)
