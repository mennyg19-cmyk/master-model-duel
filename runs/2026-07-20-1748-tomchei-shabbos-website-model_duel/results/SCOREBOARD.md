# Scoreboard — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Fill as tests complete. Arms are blind labels until FINAL-REPORT.

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 | Bonus | Late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| arm-01 | 5 | 8 | 14 | | 18.0 | 12.0 | **15.0** | **72.0** | — | no |
| arm-02 | 7 | 8 | 14 | | 18.0 | 12.5 | **15.0** | **74.5** | — | no |
| arm-03 | **6** | **8** | **15** | | **18.0** | **7.5** | **15.0** | **69.5** | inv_novel=2; bonus_plan | **yes** (join after Test 6) |

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
| With external reviewer (1+2+4+6 renorm) | **arm-02** (95.4/100) | Test 3 skipped |
| Solo commit (1+2+5 renorm) | **arm-02** (92.2/100) | |
| Best interviewer (1b) | arm-02 (tie 8/8; wins efficiency tie-break on turn quality 2.00 vs 1.98) | |

## Test 4 notes (partial)

- **Mode:** with_review — one fix pass per phase
- **P1–P3:** both **4.5/20** cumulative
- **P4 arm-01:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-01/results/P4-FIX-NOTES.md))
- **P5 arm-01:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-01/results/P5-FIX-NOTES.md); 4 blockers + priority majors; S1–S5 pass)
- **P4 arm-02:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-02/results/P4-FIX-NOTES.md); B1 + M1–M6; smoke 38/38)
- **P5 arm-02:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-02/results/P5-FIX-NOTES.md); B1 + M1–M6; smoke 52/52)
- **P6 arm-02:** **1.5/20** → **9.0/20** ([fix notes](arms/arm-02/results/P6-FIX-NOTES.md); B1–B6 + M1–M5/M7/M8; S1–S4 pass)
- **P7 arm-02:** **1.5/20** → **10.5/20** ([fix notes](arms/arm-02/results/P7-FIX-NOTES.md); B1–B4 + M1–M11; S1–S3 25/25 + fix-verify 8/8)
- **P8 arm-02:** **1.5/20** → **12.0/20** ([fix notes](arms/arm-02/results/P8-FIX-NOTES.md); B1–B2 + M1–M8; S1–S3 19/19, CI 62/62)
- **P9 arm-02:** **1.5/20** → **13.5/20** ([fix notes](arms/arm-02/results/P9-FIX-NOTES.md); B1–B6 + M1–M6/M10/M15; S1–S5 47/47, CI 66/66)
- **P10 arm-02:** **1.5/20** → **15.0/20** ([fix notes](arms/arm-02/results/P10-FIX-NOTES.md); B1 + M1–M4; S1–S3 22/22, CI 71/71)
- **P11 arm-02:** **1.5/20** → **16.5/20** ([fix notes](arms/arm-02/results/P11-FIX-NOTES.md); S-M1–M3 + Q-M1–M3 + R-H1/M1–M3; S1–S5 28/28, CI 74/74)
- **P12 arm-02:** **1.5/20** → **18.0/20** ([fix notes](arms/arm-02/results/P12-FIX-NOTES.md); S-M1 + Q-M3 + C-M5/H1 + R-M2/M3 + C-M2; S1–S5 46/46, CI 77/77) — **Test 4 complete**
- **P6 arm-01:** **1.5/20** → **9.0/20** ([fix notes](arms/arm-01/results/P6-FIX-NOTES.md); blocker + priority majors; S1–S4 pass)
- **P7 arm-01:** **1.5/20** → **10.5/20** ([fix notes](arms/arm-01/results/P7-FIX-NOTES.md); B1–B4 + M1–M2; S1–S3 pass)
- **P8 arm-01:** **1.5/20** → **12.0/20** ([fix notes](arms/arm-01/results/P8-FIX-NOTES.md); B1–B3 + M1–M6; S1–S3 pass)
- **P9 arm-01:** **1.5/20** → **13.5/20** ([fix notes](arms/arm-01/results/P9-FIX-NOTES.md); B1 + A-H1/A-H3–A-H5; S1–S5 pass)
- **P10 arm-01:** **1.5/20** → **15.0/20** ([fix notes](arms/arm-01/results/P10-FIX-NOTES.md); B1 + A-H1/H2/H3 + A-M2/M3/M5/M6/M7; S1–S3 pass)
- **P11 arm-01:** **1.5/20** → **16.5/20** ([fix notes](arms/arm-01/results/P11-FIX-NOTES.md); A-H1–A-H6 + A-M1/M2/M3/M5/M6/M7; S1–S5 pass)
- **P12 arm-01:** **1.5/20** → **18.0/20** ([fix notes](arms/arm-01/results/P12-FIX-NOTES.md); B1–B4 + M1/M3/M5–M7/M9–M11; S1–S5 pass) — **Test 4 complete**
- **P7 arm-03:** gated ([fix notes](arms/arm-03/results/P7-FIX-NOTES.md); B1–B19 + M1–M8; smoke 16/16)
- **P8 arm-03:** gated ([fix notes](arms/arm-03/results/P8-FIX-NOTES.md); B1–B6 + critical majors; smoke 3/3)
- **P9 arm-03:** gated ([fix notes](arms/arm-03/results/P9-FIX-NOTES.md); B1–B5 + M5/M6/m1; smoke 5/5)
- **P10 arm-03:** **1.5/20** → **15.0/20** ([fix notes](arms/arm-03/results/P10-FIX-NOTES.md); B1–B5 + M1/M3/M6–M9/M12; S1–S3 3/3)
- **P11 arm-03:** **1.5/20** → **16.5/20** ([fix notes](arms/arm-03/results/P11-FIX-NOTES.md); B1–B3 + M1/M7/M11/M12; S1–S5 5/5)
- **P12 arm-03:** **1.5/20** → **18.0/20** ([fix notes](arms/arm-03/results/P12-FIX-NOTES.md); B1–B3 + priority majors; S1–S5 5/5) — **Test 4 complete**
- **Test 6 winner:** tie **15.0/15** both arms (detect 8/8 · vague fix 7/7)

## Test 6 notes

- **Clone source:** arm-02 headline winner; identical tree + 5 seeds (B1–B5)
- **Detect:** both **5/5** — [arm-01](4d486d13-886f-4e9d-bd21-ede97965422f) · [arm-02](8f8af929-9a3e-41f3-bd6f-29bbced13b4f) · **arm-03** [fbfa1c16-f3ed-4993-8ab0-f9ada0793fde](fbfa1c16-f3ed-4993-8ab0-f9ada0793fde) → **8/8** each
- **Vague fix:** arm-01/02 **5/5**, CI **78/78** — [arm-01](c11bc26e-bb16-4036-9549-da9d27fa013a) · [arm-02](fa93c308-33b1-4d9e-aea4-6325d91b828a); **arm-03 rerun** **5/5** symptoms, fee/margin tests 13/13 — [96b619c3-5e43-4269-a822-93252665317f](96b619c3-5e43-4269-a822-93252665317f) → **7/7**
- **Test 6 score:** **15.0/15** all three arms (arm-03 rerun; arm-01/02 frozen)

## Test 5 notes

- **Mode:** single self-review + one fix pass + blind residual panel (`glm-5.2-high`)
- **arm-01:** **12.0/15** — self-review 1B·6M·1m; fixed SR-01–07; residual **3B·14M·25m** ([aggregate](arms/arm-01/results/AGGREGATE-RESIDUAL-REVIEW.md)). Residual 3/6 (3 clean-code blockers, 0 security blockers). Fix rate 4/4. Regressions 3/3. Hygiene 2/2.
- **arm-02:** **12.5/15** — self-review 3M·4m; fixed SR-01–07 (all); residual **1B·11M·20m** ([aggregate](arms/arm-02/results/AGGREGATE-RESIDUAL-REVIEW.md)). Residual 4.5/6 (1 adoption-debt blocker). Fix rate 4/4. Regressions 2/3 (verify-email flow untested). Hygiene 2/2.
- **arm-03:** **7.5/15** — [grade](results/reviews/self-review-residual-grade-arm-03.md). Self-review 3B·9M·6m; fixed SR-B1–B3 + M1–M4/M6/M9 (9/12); residual **5B·11M·26m** incl. **1 security blocker** ([aggregate](arms/arm-03/results/AGGREGATE-RESIDUAL-REVIEW.md)). Residual 1.5/6. Fix rate 3/4. Regressions 1/3 (magic-link refresh lockout). Hygiene 2/2. Corrected from premature 11.0 after residual aggregate + rubric grade landed.
- **Test 5 winner: arm-02** (fewer residual blockers, full minor fix pass)

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
