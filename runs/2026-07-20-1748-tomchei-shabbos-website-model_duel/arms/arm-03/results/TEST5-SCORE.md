# Test 5 — Residual + self-loop score (arm-03)

**Rubric:** `kit/rubrics/self-review-residual.md`
**Aggregate:** `AGGREGATE-RESIDUAL-REVIEW.md`
**Max:** 15

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 3.5 | 0 blockers residual (all 3 self-found blockers closed + S3 smoke blocker closed). But 5 majors residual incl. AG-M5 mojibake (customer-visible on payment path) and AG-M4 adminHandler half-migration that the self-fix made worse; plus 10 minors and 5 process slips. Debt is real and one defect ships to customers. |
| Self-finding fix rate | 4 | 3 | 9 / 12 self-found majors+blockers closed in tree = 75% (`residual-rules`). 3 of those fixes (B3, M4, M9) landed unrecorded in `SELF-FIX-NOTES.md`. |
| Regressions introduced | 3 | 3 | None. Post-fix `npm run ci` green (79 tests); `smoke:p12` 5/5; S3 moved FAIL→PASS. Both residual reviews confirm no new blocker/major introduced by the fix pass. |
| Solo process hygiene | 2 | 1.5 | Fresh residual review done, one fix pass, notes present — all three rubric criteria literally met. Deducted 0.5 for AG-P1/AG-P2: notes undercount fixes (claims 7, tree shows 10) and re-ID findings so they do not map back to self-review IDs. |
| **Total** | 15 | **11** | |

## Score rationale

- **Residual quality 3.5/6:** the "blockers left" axis is clean (0), which holds the floor. The 0.5 above floor is docked for (a) a customer-visible defect still shipping on the payment path (AG-M5 mojibake) and (b) a major the self-fix actively worsened (AG-M4 adminHandler half-migration → two competing patterns). The remaining majors (AG-M1/M2 god files, AG-M3 rate limits) are agreed debt and would not alone drop the score below 3.5.
- **Self-finding fix rate 3/4:** 75% majors+blockers closed is a solid single-pass result. Not 4 because three real fixes were never recorded in the notes, so the self-loop's own audit trail understates what shipped.
- **Regressions 3/3:** clean.
- **Solo process hygiene 1.5/2:** the three literal criteria are met; the half-point dock is for the inaccurate notes (AG-P1 undercount, AG-P2 ID drift), which is a real self-loop hygiene slip even if it does not change the tree state.

## Solo TCO ($)

Not aggregated here — see `results/COST-LEDGER.csv` for lineage + self-review + self-fix rows (residual reviewer listed separately). The rubric's TCO line is informational; it does not affect the 15-point total.

## Missing-input caveat

`residual-security-arm-03.md` and `residual-quality-arm-03.md` were not produced. Security/quality residuals in `AGGREGATE-RESIDUAL-REVIEW.md` are **derived** from the P12 phase reviews cross-referenced against the verified-fixes list. If dedicated residual reviews are later produced and differ, this score should be revisited.
