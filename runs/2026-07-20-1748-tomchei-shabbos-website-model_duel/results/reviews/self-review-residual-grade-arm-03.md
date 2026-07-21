# Rubric — Test 5 residual + self-loop

**Arm:** arm-03  
**Max:** 15

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 1.5 | 5 blockers left, including **1 security blocker** (B1 newsletter subscribe email-bombing faucet). Four clean-code blockers (B2 `routes/service.ts` 965-line god file, B3 `import.ts` 671-line god file, B4 admin page-guard boilerplate duplicated across ~26 pages and *reproduced* by the SR-M1 fix, B5 dead `payments/reconcile.ts` shell left by the reconcile consolidation). Worst residual tree of the three arms; security blocker plus structural debt on money/PII paths. Calibration: arm-01 3B/0sec=3, arm-02 1B=4.5 → 5B/1sec lands at 1.5. |
| Self-finding fix rate | 4 | 3 | Fixed 9 of 12 self-found blocker+major findings (3/3 blockers: B1-B3; 6/9 majors: M1-M4, M6, M9). Skipped M5 (shared-store rate limit — infra), M7/M8 (god-file splits — deferred as too risky for one pass). All three blockers closed; ~75% major closure matches the 3/4 score. |
| Regressions introduced | 3 | 1 | M6 is a genuine user-facing regression introduced by the SR-B2 fix: GET releases PII once `isMagicPinUnlocked` is true, but mutating paths (`startRouteViaMagicLink`, `markStopDelivered`) still call `verifyMagicPin({pin: ""})` on refresh → fail-counter increments → 60s lockout despite an unlocked link. M5 (refund retry double-count) is incomplete closure of SR-M2 on a money path. Worse than arm-02's 2/3. |
| Solo process hygiene | 2 | 2 | Fresh self-aggregate review (single mode, no external specialists), one fix pass with explicit fixed/skipped table, smoke table present with per-script verdicts and a reasoned failure-classification. Notes honestly flag p3/p4/p5/p7 smoke failures as data pollution rather than hiding them. |
| **Total** | 15 | **7.5** | |

Solo TCO ($): lineage + self-review + self-fix = see `results/COST-LEDGER.csv` (residual reviewer listed separately).
