# Test 5 — Residual + self-loop score (arm-04)

**Rubric:** `kit/rubrics/self-review-residual.md`
**Aggregate:** `AGGREGATE-RESIDUAL-REVIEW.md`
**Max:** 15

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 5.0 | 0 blockers. 3 majors: MAJ-01 POS can still ring up a merged-away shell (incomplete survivor wiring); MAJ-02/03 clean-code pattern drift (P2002 helper, env-spec boilerplate). 14 minors, none customer-exploitable security. Cleaner residual than arms with blockers (arm-01 3B, arm-02 1B). Docked from 6 for the real merge gap + two majors. |
| Self-finding fix rate | 4 | 4 | 5/5 self-found blockers+majors closed (F-01..F-05). 8/12 minors also fixed; 4 skipped with documented reasons. MAJ-01 is a related residual gap, not an unfixed self-ID. |
| Regressions introduced | 3 | 3 | None. lint/typecheck/migration guard clean; **234/234** tests; ordered P1–P12 smokes all green after fix. Residual panel reports no new blocker/major introduced by the fix pass. |
| Solo process hygiene | 2 | 2 | Fresh self-review (findings only), one fix pass, `SELF-FIX-NOTES.md` maps Fixed/Skipped/Verification with self-review IDs intact. |
| **Total** | 15 | **14.0** | |

## Score rationale

- **Residual 5.0/6:** 0 blockers is the ceiling-adjacent floor. MAJ-01 keeps it off 6 — the merge identity fix left an admin POS hole that can re-split a household. MAJ-02/03 are real but non-shipping pattern debt.
- **Fix rate 4/4:** full closure of self-found blocker+major set in one pass.
- **Regressions 3/3:** clean verification ladder.
- **Hygiene 2/2:** notes and process match the rubric literally.

## Solo TCO ($)

See `results/COST-LEDGER.csv` (lineage + self-review + self-fix; residual reviewers listed separately). Usage backfill still pending on many rows.
