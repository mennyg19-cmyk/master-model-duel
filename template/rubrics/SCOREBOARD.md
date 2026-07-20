# Scoreboard — run `__RUN_ID__`

Fill as tests complete. Arms are blind labels until FINAL-REPORT.

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arm-01 | | | | | | | | |
| arm-02 | | | | | | | | |

If grill off: put 1a score scaled to /15 in 1a column; leave 1b blank; note in footer.

## Efficiency / interviewer (1b)

| Arm | inventory_score | turn_quality_mean | necessary_turns | grill_efficiency |
|---|---:|---:|---:|---:|
| arm-01 | | | | |
| arm-02 | | | | |

## Cost (from COST-LEDGER.csv)

**Gate:** fill this from `results/COST-LEDGER.csv` at every test gate. Empty cells while the CSV has rows (or CSV has only a header after spawns) = incomplete. Use `scripts/append-cost-ledger.ps1` / `verify-cost-ledger.ps1`.

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
