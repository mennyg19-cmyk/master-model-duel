# Scoreboard — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Fill as tests complete. Arms are blind labels until FINAL-REPORT.

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 | Bonus | Late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| arm-01 | 5 | 8 | 14 | | 18.0 | 12.0 | **15.0** | **72.0** | — | no |
| arm-02 | 7 | 8 | 14 | | 18.0 | 12.5 | **15.0** | **74.5** | — | no |
| arm-03 | **6** | **8** | **15** | | **18.0** | **11.0** | **11.0** | **69.0** | inv_novel=2; bonus_plan | **yes** (join after Test 6) |
| arm-04 | **7** | **8** | **15** | | **18.0** | **14.0** | **11.0** | **73.0** | inv_novel=6; bonus_plan | **yes** (join after Test 6; Opus 5 high; T6 rerun) |
| arm-05 | — | — | — | | **18.0** | **12.0** | — | **30.0** | — | **yes** (Terra high; T4+T5 only) |
| arm-06 | **7** | **6.5** | **15** | | **10.5** | | | | inv_novel=4; bonus_plan | **yes** (Kimi K3 max; full suite) |

Grill on — 1a scored /7 per rubric. **Re-graded** with full 192-row denominator (see DEVIATIONS.md).

## Efficiency / interviewer (1b)

| Arm | inventory_score | turn_quality_mean | necessary_turns | grill_efficiency |
|---|---:|---:|---:|---:|
| arm-01 | 7 | 1.98 | 13 | 0.54 |
| arm-02 | 7 | 2.00 | 13 | 0.54 |
| arm-03 | 7 | 1.99 | 13 | 0.54 |
| arm-04 | 7 | 2.00 | 10 | **0.70** |
| arm-06 | 6 | 2.00 | 11 | 0.55 |

## Cost (from COST-LEDGER.csv)

Backfilled 2026-07-27 from Cursor usage export (`usage-events-2026-07-27.csv`); arm-05 backfilled 2026-07-28 from `usage-events-2026-07-28.csv`. `verify-cost-ledger.ps1 -RequireUsage` → **ok=true**.

| Arm | Builder $ | Full pipeline $ | Solo TCO (T5 lineage) |
|---|---:|---:|---:|
| arm-01 | 88.60 | 106.82 | 85.42 |
| arm-02 | 296.41 | 319.83 | 286.19 |
| arm-03 | Included* | 33.72† | Included* |
| arm-04 | 622.27 | 663.03 | 607.98 |
| arm-05 | 63.49 | 97.65 | 63.49‡ |

\* Grok contestant rows export as `Included` (no dollar amount). † arm-03 full pipeline $ is **reviewer (glm) billed only**. ‡ arm-05 T4+T5 only; Solo TCO = Terra contestant lineage (no 1a/1b/2/6); full pipeline includes glm residual/panel.

## Headlines (Option D)

| Headline | Winner arm | Notes |
|---|---|---|
| With external reviewer (1+2+4+6 renorm) | **arm-02** (62/65 → **95.4/100**) | arm-04 late: 59/65 → 90.8 |
| Solo commit (1+2+5 renorm) | **arm-04** (44/45 → **97.8/100**) | Late join; originals: arm-02 92.2 |
| Best interviewer (1b) | **arm-04** (tie 8/8; wins efficiency 0.70 on 10 turns; tq 2.00) | Original duel: arm-02 (tq 2.00 vs 1.98) |

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
- **P1 arm-04:** **1.5/20** → **1.5/20** ([fix notes](arms/arm-04/results/P1-FIX-NOTES.md); M1–M7 + priority minors; smoke 28/28)
- **P2 arm-04:** **1.5/20** → **3.0/20** ([fix notes](arms/arm-04/results/P2-FIX-NOTES.md); M1–M6 + 17 minors; smoke 21/21, tests 68/68)
- **P3 arm-04:** **1.5/20** → **4.5/20** ([fix notes](arms/arm-04/results/P3-FIX-NOTES.md); M1–M5 + 13 minors; smoke 39/39, tests 97/97)
- **P4 arm-04:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-04/results/P4-FIX-NOTES.md); M1–M3 + 11 minors; smoke 26/26, tests 120/120)
- **P5 arm-04:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-04/results/P5-FIX-NOTES.md); B1 + M1–M7 + 12 minors; smoke 29/29)
- **P6 arm-04:** **1.5/20** → **9.0/20** ([fix notes](arms/arm-04/results/P6-FIX-NOTES.md); M1–M9 + 14 minors; smoke 23/23, tests 156/156)
- **P7 arm-04:** **1.5/20** → **10.5/20** ([fix notes](arms/arm-04/results/P7-FIX-NOTES.md); M1–M4 + 10 minors; smoke 21/21, tests 170/170, ladder 187/187)
- **P8 arm-04:** **1.5/20** → **12.0/20** ([fix notes](arms/arm-04/results/P8-FIX-NOTES.md); M-MAJ-1–4 + 9 minors; smoke 16/16, tests 181/181, ladder 203/203)
- **P9 arm-04:** **1.5/20** → **13.5/20** ([fix notes](arms/arm-04/results/P9-FIX-NOTES.md); 11 majors + 22 minors; smoke 24/24, tests 193/193)
- **P10 arm-04:** **1.5/20** → **15.0/20** ([fix notes](arms/arm-04/results/P10-FIX-NOTES.md); 10 majors + 9 minors; smoke 21/21, tests 206/206)
- **P11 arm-04:** **1.5/20** → **16.5/20** ([fix notes](arms/arm-04/results/P11-FIX-NOTES.md); 8 majors + 11 minors; smoke 27/27, tests 217/217, ladder 275/275)
- **P12 arm-04:** **1.5/20** → **18.0/20** ([fix notes](arms/arm-04/results/P12-FIX-NOTES.md); 6 majors + 10 minors; smoke 28/28, tests 226/226) — **Test 4 complete**
- **P1 arm-05:** **1.5/20** → **1.5/20** ([fix notes](arms/arm-05/results/P1-FIX-NOTES.md); B2–B9 + majors; smoke S1–S5 pass after embedded PG)
- **P2 arm-05:** **1.5/20** → **3.0/20** ([fix notes](arms/arm-05/results/P2-FIX-NOTES.md); M1 + M6 + minors; smoke:p2 pass)
- **P3 arm-05:** **1.5/20** → **4.5/20** ([fix notes](arms/arm-05/results/P3-FIX-NOTES.md); B1–B5 + majors; smoke:p3 pass)
- **P4 arm-05:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-05/results/P4-FIX-NOTES.md); B1 IDOR + M1/M2/M5–M8; smoke:p4 pass)
- **P5 arm-05:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-05/results/P5-FIX-NOTES.md); B1–B3 + M2/M3; smoke:p5 pass)
- **P6 arm-05:** **1.5/20** → **9.0/20** ([fix notes](arms/arm-05/results/P6-FIX-NOTES.md); import/POS/refund auth + bulk/smoke; smoke:p6 pass)
- **P7 arm-05:** **1.5/20** → **10.5/20** ([fix notes](arms/arm-05/results/P7-FIX-NOTES.md); #2/#4–7/#9–24 + partial #1/#3; smoke:p7 S1–S3 pass)
- **P8 arm-05:** **1.5/20** → **12.0/20** ([fix notes](arms/arm-05/results/P8-FIX-NOTES.md); B1–B3 + 10 majors; smoke:p8 S1–S3 pass)
- **P9 arm-05:** **1.5/20** → **13.5/20** ([fix notes](arms/arm-05/results/P9-FIX-NOTES.md); B1–B3 + 8 majors; smoke:p9 S1–S5 pass)
- **P10 arm-05:** **1.5/20** → **15.0/20** ([fix notes](arms/arm-05/results/P10-FIX-NOTES.md); #1–5/#7–8/#10/#15–16; smoke:p10 S1–S3 pass)
- **P11 arm-05:** **1.5/20** → **16.5/20** ([fix notes](arms/arm-05/results/P11-FIX-NOTES.md); B1 + #2/#3/#5–7/#9/#15/#29/#33/#34; smoke:p11 S1–S5 pass)
- **P12 arm-05:** **1.5/20** → **18.0/20** ([fix notes](arms/arm-05/results/P12-FIX-NOTES.md); B1–B2 + 11 majors; smoke:p12 pass) — **Test 4 complete**
- **P1 arm-06:** **1.5/20** → **1.5/20** ([fix notes](arms/arm-06/results/P1-FIX-NOTES.md); 7 majors + 23/24 minors; smoke S1–S6 pass)
- **P2 arm-06:** **1.5/20** → **3.0/20** ([fix notes](arms/arm-06/results/P2-FIX-NOTES.md); 11 majors + 26 minors; smoke S1–S5 + ci pass)
- **P3 arm-06:** **1.5/20** → **4.5/20** ([fix notes](arms/arm-06/results/P3-FIX-NOTES.md); B1 + 8 majors + 20/21 minors; smoke S1–S5 re-run)
- **P4 arm-06:** **1.5/20** → **6.0/20** ([fix notes](arms/arm-06/results/P4-FIX-NOTES.md); 10 majors + 14/19 minors; smoke S1–S3 38/38)
- **P5 arm-06:** **1.5/20** → **7.5/20** ([fix notes](arms/arm-06/results/P5-FIX-NOTES.md); 4 majors + 19 minors; smoke S1–S5 43/43)
- **P6 arm-06:** **1.5/20** → **9.0/20** ([fix notes](arms/arm-06/results/P6-FIX-NOTES.md); 5 majors + 19/21 minors; smoke S1–S4 30/30)
- **P7 arm-06:** **1.5/20** → **10.5/20** ([fix notes](arms/arm-06/results/P7-FIX-NOTES.md); B1 + 5 majors + 18/20 minors; smoke S1–S3 26/26)
- **Test 6 winner:** tie **15.0/15** both arms (detect 8/8 · vague fix 7/7)

## Test 6 notes

- **Clone source:** arm-02 headline winner; identical tree + 5 seeds (B1–B5)
- **Detect:** arm-01/02 **5/5** → **8/8** — [arm-01](4d486d13-886f-4e9d-bd21-ede97965422f) · [arm-02](8f8af929-9a3e-41f3-bd6f-29bbced13b4f); **arm-03 rerun** **4/5** (missed B3 public-guard) — [2a87b30a-2e82-41a4-9ca9-e21cd519d794](2a87b30a-2e82-41a4-9ca9-e21cd519d794) → **4/8**; **arm-04 rerun** **4/5** (missed B4 checkout/start) — [1feaa88e-ac98-41bd-a258-8b90cbf34a04](1feaa88e-ac98-41bd-a258-8b90cbf34a04) → **4/8**
- **Vague fix:** arm-01/02 **5/5**, CI **78/78** — [arm-01](c11bc26e-bb16-4036-9549-da9d27fa013a) · [arm-02](fa93c308-33b1-4d9e-aea4-6325d91b828a); **arm-03 rerun** **5/5** symptoms, CI **78/78** — [903d309c-809f-4681-8611-c77814aab9d0](903d309c-809f-4681-8611-c77814aab9d0) → **7/7**; **arm-04 rerun** **5/5** symptoms, CI **82/82** — [b2113824-99f3-46f1-b3d5-87d77ad41987](b2113824-99f3-46f1-b3d5-87d77ad41987) → **7/7**
- **Test 6 score:** arm-01/02 **15.0/15** (frozen); **arm-03 rerun 11.0/15** (4+7); **arm-04 rerun 11.0/15** (4+7) — [DETECT](arms/arm-04/results/DETECT.md) · [grade](arms/arm-04/results/DETECT-GRADE.md) · [vague fix](arms/arm-04/results/VAGUE-FIX-NOTES.md) · [score](arms/arm-04/results/TEST6-SCORE.md)

## Test 5 notes

- **Mode:** single self-review + one fix pass + blind residual panel (`glm-5.2-high`)
- **arm-01:** **12.0/15** — self-review 1B·6M·1m; fixed SR-01–07; residual **3B·14M·25m** ([aggregate](arms/arm-01/results/AGGREGATE-RESIDUAL-REVIEW.md)). Residual 3/6 (3 clean-code blockers, 0 security blockers). Fix rate 4/4. Regressions 3/3. Hygiene 2/2.
- **arm-02:** **12.5/15** — self-review 3M·4m; fixed SR-01–07 (all); residual **1B·11M·20m** ([aggregate](arms/arm-02/results/AGGREGATE-RESIDUAL-REVIEW.md)). Residual 4.5/6 (1 adoption-debt blocker). Fix rate 4/4. Regressions 2/3 (verify-email flow untested). Hygiene 2/2.
- **arm-03:** **11.0/15** — self-review 1B·6M·9m; fixed SR-B1 + SR-M1–M6; residual **0B·5M·10m** ([aggregate](arms/arm-03/results/AGGREGATE-RESIDUAL-REVIEW.md), [score](arms/arm-03/results/TEST5-SCORE.md)). Residual 3.5/6. Fix rate 3/4 (75%). Regressions 3/3. Hygiene 1.5/2.
- **arm-04:** **14.0/15** — self-review 1B·4M·12m; fixed F-01–F-05 + 8 minors; residual **0B·3M·14m** ([aggregate](arms/arm-04/results/AGGREGATE-RESIDUAL-REVIEW.md), [score](arms/arm-04/results/TEST5-SCORE.md)). Residual 5.0/6. Fix rate 4/4. Regressions 3/3. Hygiene 2/2.
- **arm-05:** **12.0/15** — self-review 0B·8M; fixed SR-001–008 (all); residual **2B·12M·19m** ([aggregate](arms/arm-05/results/AGGREGATE-RESIDUAL-REVIEW.md), [score](arms/arm-05/results/TEST5-SCORE.md)). Residual 3.5/6. Fix rate 4/4. Regressions 2.5/3. Hygiene 2/2.
- **Test 5 winner: arm-04** (0 residual blockers; full self-major fix; cleanest residual panel)

## Test 2 notes

- **arm-01:** 14/15 — [plan](arms/arm-01/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-01.md) (10 phases)
- **arm-02:** 14/15 — [plan](arms/arm-02/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-02.md) (17 phases)
- **arm-03 (late join):** **15/15** + bonus_plan — [plan](arms/arm-03/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-03.md) (12 phases)
- **arm-04 (late join):** **15/15** + bonus_plan — [plan](arms/arm-04/results/BUILD-PLAN.md), [review](results/reviews/plan-arm-04.md) (16 phases P0–P15; not merged into shared freeze)
- **Merged plan:** [shared/MERGED-BUILD-PLAN.md](../shared/MERGED-BUILD-PLAN.md) — **12 phases** P1..P12 (**frozen** for Tests 3–4)
- **Phase map:** [shared/smoke/phase-map.md](../shared/smoke/phase-map.md)
- **Test 2 tie** on score among originals; late joins both 15/15

## Test 1b notes

- Grill complete: 13 turns each original arm, interleaved; late joins live (own questions)
- **arm-01:** grill_quality ≈7.9 → **8/8**; 30 grill features; turn_quality 1.98. [grade](results/reviews/grill-turns-arm-01.md)
- **arm-02:** grill_quality 7.0 → **8/8**; 16 grill features; turn_quality 2.00. [grade](results/reviews/grill-turns-arm-02.md)
- **arm-03 (late join):** **8/8**; 13 features; turn_quality 1.985; efficiency 0.54. [grade](results/reviews/grill-turns-arm-03.md)
- **arm-04 (late join):** **8/8**; 99 features / 18 OPEN; turn_quality **2.00**; efficiency **0.70** (10 turns). [grade](results/reviews/grill-turns-arm-04.md)
- **Comparison:** [shared/INVENTORY-COMPARISON.md](../shared/INVENTORY-COMPARISON.md) — resolved → [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md) (**frozen**; late joins do not rewrite)

## Test 1a notes (corrected grades)

- Reconciled: 192 features (`shared/RECONCILED-INVENTORY.md`)
- **arm-01:** recall 2 (144/192 = 74.5%), precision 3 → **5/7** — missed 48 rows (mostly arm-02-granular schema/design-system + scattered behaviors). [grade](results/reviews/inventory-grade-arm-01.md)
- **arm-02:** recall 4 (188/192 = 97.9%), precision 3 → **7/7** — missed R-015, R-016, R-017 (catalog grid UX), R-114 (customer linking). [grade](results/reviews/inventory-grade-arm-02.md)
- **arm-04 (late join):** recall 4 (192/192 = 100%), precision 3 → **7/7**; bonus_inventory_novel=6. [grade](results/reviews/inventory-grade-arm-04.md)
- **Test 1a winner: arm-02** (tie 7/7 with arm-04 on score; arm-02 gated first)
