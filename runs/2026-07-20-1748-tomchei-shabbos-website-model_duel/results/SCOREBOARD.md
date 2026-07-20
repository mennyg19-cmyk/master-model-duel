# Scoreboard — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Fill as tests complete. Arms are blind labels until FINAL-REPORT.

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arm-01 | 5 | 8 | 14 | | 7.5 | | | 34.5 |
| arm-02 | 7 | 8 | 14 | | 6.0 | | | 35.0 |

Grill on — 1a scored /7 per rubric. **Re-graded** with full 192-row denominator (see DEVIATIONS.md).

## Efficiency / interviewer (1b)

| Arm | inventory_score | turn_quality_mean | necessary_turns | grill_efficiency |
|---|---:|---:|---:|---:|
| arm-01 | 7 | 1.98 | 13 | 0.54 |
| arm-02 | 7 | 2.00 | 13 | 0.54 |

## Cost (from COST-LEDGER.csv)

| Arm | Builder $ | Full pipeline $ | Solo TCO (T5) |
|---|---:|---:|---:|
| arm-01 | | | |
| arm-02 | | | |

## Headlines (Option D)

| Headline | Winner arm | Notes |
|---|---|---|
| With external reviewer (1+2+3+4+6 renorm) | | |
| Solo commit (1+2+5 renorm) | | |
| Best interviewer (1b) | arm-02 (tie 8/8; wins efficiency tie-break on turn quality 2.00 vs 1.98) | |

## Test 4 notes (partial)

- **Mode:** with_review — one fix pass per phase
- **P1–P3:** both **4.5/20** cumulative
- **P4 arm-01:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-01/results/P4-FIX-NOTES.md))
- **P5 arm-01:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-01/results/P5-FIX-NOTES.md); 4 blockers + priority majors; S1–S5 pass)
- **P4 arm-02:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-02/results/P4-FIX-NOTES.md); B1 + M1–M6; smoke 38/38)
- **Next:** P5 arm-02 · P6 arm-01 review — [PHASE-P5-EXPECTED.md](../shared/phases/PHASE-P5-EXPECTED.md) · [PHASE-P6-EXPECTED.md](../shared/phases/PHASE-P6-EXPECTED.md)

## Test 2 notes

- **arm-01:** 14/15 — [plan](arms/arm-01/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-01.md) (10 phases)
- **arm-02:** 14/15 — [plan](arms/arm-02/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-02.md) (17 phases)
- **Merged plan:** [shared/MERGED-BUILD-PLAN.md](../shared/MERGED-BUILD-PLAN.md) — **12 phases** P1..P12
- **Phase map:** [shared/smoke/phase-map.md](../shared/smoke/phase-map.md)
- **Test 2 tie** on score; arm-01 wins phase count efficiency (10 vs 17 source phases)

## Test 1b notes

- Grill complete: 13 turns each arm, interleaved
- **arm-01:** grill_quality ≈7.9 → **8/8**; 30 grill features; turn_quality 1.98. [grade](results/reviews/grill-turns-arm-01.md)
- **arm-02:** grill_quality 7.0 → **8/8**; 16 grill features; turn_quality 2.00. [grade](results/reviews/grill-turns-arm-02.md)
- **Comparison:** [shared/INVENTORY-COMPARISON.md](../shared/INVENTORY-COMPARISON.md) — resolved → [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md)

## Test 1a notes (corrected grades)

- Reconciled: 192 features (`shared/RECONCILED-INVENTORY.md`)
- **arm-01:** recall 2 (144/192 = 74.5%), precision 3 → **5/7** — missed 48 rows (mostly arm-02-granular schema/design-system + scattered behaviors). [grade](results/reviews/inventory-grade-arm-01.md)
- **arm-02:** recall 4 (188/192 = 97.9%), precision 3 → **7/7** — missed R-015, R-016, R-017 (catalog grid UX), R-114 (customer linking). [grade](results/reviews/inventory-grade-arm-02.md)
- **Test 1a winner: arm-02**
