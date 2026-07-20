# Cost ledger how-to

File: `runs/{run_id}/results/COST-LEDGER.csv`

## After every spawn

Append one row. Prefer Cursor usage/`Cost` from the agent turn. If missing, leave cost blank and fill from CSV export later.

| Column | Example |
|---|---|
| timestamp_utc | 2026-07-20T12:00:00Z |
| run_id | 2026-07-20-myapp |
| test | 1a / 1b / 2 / 3 / 4 / 5 / 6 |
| arm_id | arm-01 or `shared` |
| phase | P1 or blank |
| role | inventory / grill / review_security / … |
| model | slug |
| agent_id | Cursor agent id if known |
| kind | input/output split if known |
| *_tokens / cost_usd | numbers |
| notes | pack id, job id, fluff |

## Headlines

- **Builder-only $:** roles inventory, grill, plan, build, fix, self_*, detect, vague_fix  
- **Full pipeline $:** everything including reviewer panel  
- **Solo TCO (T5):** lineage build for that tree + self_review + self_fix (exclude residual reviewer)
