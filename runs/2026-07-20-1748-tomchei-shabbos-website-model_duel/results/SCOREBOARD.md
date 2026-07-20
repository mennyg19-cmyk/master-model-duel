# Scoreboard — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Fill as tests complete. Arms are blind labels until FINAL-REPORT.

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arm-01 | 5 | | | | | | | 5 |
| arm-02 | 7 | | | | | | | 7 |

Grill on — 1a scored /7 per rubric.

## Efficiency / interviewer (1b)

| Arm | inventory_score | turn_quality_mean | necessary_turns | grill_efficiency |
|---|---:|---:|---:|---:|
| arm-01 | | | | |
| arm-02 | | | | |

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
| Best interviewer (1b) | | |

## Test 1a notes

- Reconciled: 192 features (`shared/RECONCILED-INVENTORY.md`)
- **Correction (2026-07-20):** prior grades used UNIQUE tags to shrink denominators (arm-01: 140; arm-02: 188). Protocol = full 192 for both. See corrected `results/reviews/inventory-grade-arm-0N.md`.
- arm-01: covered 140/192 ≈ 72.9% → recall **2**, precision 3 → **5/7**
- arm-02: covered 188/192 ≈ 97.9% → recall **4**, precision 3 → **7/7**
- **arm-02 wins Test 1a** (not a tie)
