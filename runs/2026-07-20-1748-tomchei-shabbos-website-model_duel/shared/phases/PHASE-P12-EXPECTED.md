# Phase EXPECTED — P12

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness.

## Must be true when phase is done

1. [ ] Multi-season performance reports + shipping-margin reconciliation view (charged vs paid per package, season totals)
2. [ ] CSV export center + audit history; Stripe payment reconciliation (run button + cron + matcher)
3. [ ] Legacy import pipeline with dry-run, normalization, staged atomic commits, address-book cleanup (UR-014)
4. [ ] Scale dress rehearsal at 1k orders / 5k packages; test console + test-mode banner; all crons registered with secret auth
5. [ ] End-to-end dress rehearsal: web order → pay → package → print → ship/deliver/pickup → reroute → reports reconcile

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Reports + margin | Report totals and drill-downs match seeded ledger; margin report matches seeded shipments |
| S2 | Exports + reconciliation | Authorized CSV exports; unauthorized rejected; orphaned PaymentIntent flagged; rerun without duplicate adjustments |
| S3 | Legacy import | Dry-run messy fixture; mapping + atomic commit; resume after interruption; dedupe rules applied |
| S4 | Imported repeat | Repeat imported prior-year order through P10 review page |
| S5 | Dress rehearsal | Full E2E with zero manual DB edits; nightly batch over 5k packages acceptable; wipe+reseed restores clean test season |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P12-SMOKE.md`

## Out of scope this phase

- New product features beyond launch polish listed above
