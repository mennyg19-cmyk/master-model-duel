# Self-fix notes — arm-05

## Fixed

- **SR-001:** Replaced the single-page PDF writer with a complete multi-page page tree. Added a 56-line regression test.
- **SR-002:** Production geocoding now requires Mapbox for uncached addresses; fixture coordinates are allowed only in non-production `TEST_MODE`. Cached fixture records are re-geocoded in production.
- **SR-003:** The package board now pages 100 records at a time while calculating channel and production totals across every active package.
- **SR-004:** Item-sales CSV exports now include finalized orders only.
- **SR-005:** Shipping-margin reports and CSV exports now exclude voided labels.
- **SR-006:** Legacy imports now create a `PackageLine` for each imported package, preserving its recipient for repeat orders. The P12 smoke verifies this flow.
- **SR-007:** Anonymous POS sales create distinct customers with no shared email; identified customers still upsert by normalized email.
- **SR-008:** Reworked the reports and seasons initial fetch effects so lint passes without `set-state-in-effect` errors.

## Skipped

- None.

## Verification

- `npm run typecheck` passed.
- `npm run lint` passed with three existing `no-img-element` warnings outside this fix pass.
- `npm test`, `npm run smoke:p9`, and `npm run smoke:p12` passed.
