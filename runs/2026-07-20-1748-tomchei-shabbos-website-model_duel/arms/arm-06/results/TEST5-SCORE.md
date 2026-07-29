# Test 5 — Residual + self-loop score (arm-06)

**Rubric:** `kit/rubrics/self-review-residual.md`
**Aggregate:** `AGGREGATE-RESIDUAL-REVIEW.md`
**Max:** 15

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 4.0 | 0 blockers · 5 majors (admin CSRF SameSite-only, no CSP, `cancelDraft` race, duplicated address-key + auth-session scaffolding). Defense-in-depth / narrow race / clean-code debt — not architectural fail-open. Docked from 6 for five lingering majors. |
| Self-finding fix rate | 4 | 4 | Self-review 0B·2M·7m; self-fix closed **all 9** (SR-01–09). 100% on majors+blockers. Residual majors are carry-over debt the self-review did not surface. |
| Regressions introduced | 3 | 3 | Quality residual: no money/state-machine/smoke regressions from the fix pass. |
| Solo process hygiene | 2 | 2 | Fresh single-mode review → one fix pass → complete SELF-FIX-NOTES with verification. |
| **Total** | 15 | **13.0** | |

## Score rationale

Aggregator suggestion was 13/15; orchestrator accepts. Stronger residual than arm-01/03/05 (blockers or heavier major load); behind arm-04 (14.0 with 0B·3M).

## Solo TCO ($)

See `results/COST-LEDGER.csv` (lineage + self-review + self-fix; residual reviewers listed separately). Usage backfill still pending on many post-2026-07-29 rows.
