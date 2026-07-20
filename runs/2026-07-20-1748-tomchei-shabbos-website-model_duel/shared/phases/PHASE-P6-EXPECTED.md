# Phase EXPECTED — P6

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P6 — Admin operations hub & POS.

## Must be true when phase is done

1. [ ] Permission-aware admin dashboard (KPIs, recent orders) and Today work queue
2. [ ] Searchable/filterable/paginated order list (1k+ scale) + full order detail with money actions and Stripe refund path
3. [ ] POS reuses cart-first builder + customer lookup/find-or-create; check/cash with staff audit (no public POS payments)
4. [ ] Customer directory + detail + order history; staged atomic CSV import (customers/products) with preview + audit
5. [ ] Admin chrome (visit-store, alert banner, back link); settings hub tabs wired to live config
6. [ ] Bounded list queries and bulk actions with deterministic conflict reporting at crunch scale

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Ops hub | Manager + restricted Staff traverse dashboard, Today queue, search, detail, refund, audit views on seeded order |
| S2 | POS | Walk-in POS cash order writes audited payment; repeat one order; bounded bulk-repeat batch |
| S3 | Import | Stage CSV with valid/duplicate/invalid rows; preview errors; atomic commit; import audit |
| S4 | Scale | Page 1k-order / 5k-package fixtures; two conflicting bulk actions report skipped/conflicts deterministically |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P6-SMOKE.md`

## Out of scope this phase

- Package board, print batches, greeting cards (P7)
- Live Shippo margin engine (P8)
- Delivery routes / driver magic links (P9)
- Repeat-order replacement flow (P10)
- Test-mode, help tours, launch polish (P12)
