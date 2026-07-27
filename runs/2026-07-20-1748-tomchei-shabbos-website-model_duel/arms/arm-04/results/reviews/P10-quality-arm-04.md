# P10 Quality Review — arm-04 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-04/workspace/` (replacements, repeat review page, bulk repeat, season wizard + auto-flip)
**Reviewer:** External, Quality specialist
**Reference:** `shared/phases/PHASE-P10-EXPECTED.md`, `kit/prompts/reviewer/review-quality.md`
**Mode:** Findings only, no fixes. Blind to model name.

## Summary

The four EXPECTED pillars are present and load-bearing: chain resolution with the slug-beats-mapping rule and loop cap, a forced-pick review page with two ticks and a homeless-recipient check, staff/bulk repeat that names what it cannot resolve, and a season wizard plus scheduled auto-flip behind a bearer-gated cron. Unit tests in `tests/repeat-seasons.test.ts` and `tests/scheduled-jobs.test.ts` cover the core invariants (chain walk, loop, fold-into-one, price-smart category scoping, undecided-line refusal, one-cart-per-customer, scheduled open/close, scheduled-open-closes-other). The HTTP smoke script (`scripts/smoke-p10.ts`) maps onto S1–S4.

The findings below are correctness gaps against EXPECTED, not style.

## Findings

### M1 — `importPriorYearOrder` re-import does not update `amountPaidCents`

**Severity:** Medium
**File:** `src/lib/imports/prior-year-orders.ts:108-117`

On the update branch (re-import of an already-imported reference), `subtotalCents` and `totalCents` are rewritten from the new lines, but `amountPaidCents`, `paymentStatus`, and `status` are left at the values written by the first import. A corrected export with a different line total leaves the order with `paymentStatus: 'PAID'` and `amountPaidCents != totalCents`, so imported history looks partially unpaid against a paid status.

The code comment at lines 104-106 explicitly frames re-import as "a corrected export", so divergent totals are the expected case, not an edge case. `amountPaidCents` should track `totalCents` on the update branch the way it does on the create branch.

EXPECTED S3 ("imported prior-year repeat ... resolve") is met for the happy path; this bug only surfaces on re-import with a different total, which is precisely the scenario the comment invites.

### M2 — Scheduled season flip is not audited

**Severity:** Medium
**File:** `src/lib/seasons/schedule.ts:33-76` (`applyScheduledSeasonFlips`)

`applyScheduledSeasonFlips` opens and closes seasons inside a single transaction but only writes a `CronRunLog` row (via `runCronJobBody`). It does not call `recordAudit` for the seasons it moves. By contrast, `setSeasonStatus` (manual flip) records `season.status_changed` with `scheduled: false`, and `setSeasonSchedule` records `season.schedule_changed`. The scheduled half of UR-008 leaves no `season.status_changed` audit entry — the audit trail can show a manager flipping a season by hand but is silent when the clock does the same thing.

The `CronRunLog` row records that the job ran and how many seasons it moved, but not which season ids moved or in which direction. Reconstructing "who opened the 2027 season" requires diffing the season table against a prior snapshot.

EXPECTED UR-008 ("manager Open/Closed switch + optional scheduled auto-flip") treats both halves as the same switch; only one is audited.

### L1 — `listRepeatableOrders` is dead code with a wider filter than the UI

**Severity:** Low
**File:** `src/lib/orders/repeat-review.ts:161-168`

`listRepeatableOrders` is exported but has no import sites in the app or the test suite. The storefront orders page (`src/app/(storefront)/account/orders/page.tsx`) uses `listCustomerOrders` + `OrderSummaryRow`, and `OrderSummaryRow`'s `REPEATABLE` set is `['PLACED', 'IN_FULFILLMENT', 'COMPLETED']`. The dead function filters `status: { notIn: ['DRAFT', 'DISCARDED'] }`, which includes `CANCELLED` — so even if it were wired up, cancelled orders would surface as repeatable, contradicting the detail page's repeat-button guard (`isDraft || CANCELLED || DISCARDED ? null : ...`).

Either delete it, or align its filter with `REPEATABLE` and use it.

### L2 — Missing P10 smoke / status evidence

**Severity:** Low (process)
**Files:** `arms/arm-04/workspace/.scratch/PHASE-P10-STATUS.md`, `.scratch/PHASE-P10-SMOKE.md`

EXPECTED states: "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P10-SMOKE.md`". arm-04 has no `.scratch/` directory and neither file. The smoke script and helpers exist (`scripts/smoke-p10.ts`, `scripts/smoke-p10-helpers.ts`) and the unit tests are present, but there is no recorded run output. arm-03 carries both files; arm-04 carries neither. Without the smoke evidence the S1–S4 checks cannot be confirmed against EXPECTED from the archive alone — only from re-running the script.

### L3 — `SEASON_ALREADY` error code reused for "not found"

**Severity:** Low
**File:** `src/lib/seasons/management.ts:43`

`setSeasonStatus` returns `failure(SEASON_ALREADY, 'That season no longer exists.')` when the season row is missing, and the same code is used two lines later for "already in that state". The flash message distinguishes them, but the code is misleading for any log/monitoring consumer that groups by `code`. A `SEASON_NOT_FOUND` code would read honestly.

## Severity counts

- Medium: 2 (M1, M2)
- Low: 3 (L1, L2, L3)
- High: 0
- Total: 5
