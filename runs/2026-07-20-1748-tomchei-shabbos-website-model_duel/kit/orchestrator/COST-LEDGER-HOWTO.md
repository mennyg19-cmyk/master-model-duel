# Cost ledger how-to (orchestrator-owned — mandatory)

File: `runs/{run_id}/results/COST-LEDGER.csv`

## Hard gate

A spawn is **not done** until a ledger row exists for it.

| Rule | Detail |
|---|---|
| When | **Immediately after every spawn returns** (contestant, specialist, merge, reviewer, reconciler, grader, chooser, fix, detect) |
| How | Prefer `scripts/append-cost-ledger.ps1` (do not hand-edit unless the script fails) |
| Missing $ / tokens | **Still append.** Script adds `usage_missing_pending_export` in notes. Never skip the row. |
| Before next spawn | Confirm previous row landed (`verify-cost-ledger.ps1` or open the CSV) |
| Before test / phase gate | Ledger must cover that test’s spawns; fill SCOREBOARD **Cost** from the CSV. Empty Cost table = **gate fail** |
| Contestants | Never write the ledger — orchestrator only |

Skipping the ledger to “move faster” is a protocol violation. Log it in `results/DEVIATIONS.md` if it already happened, then backfill.

## Append (required command)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/append-cost-ledger.ps1 `
  -RunId "{run_id}" `
  -Test "1a" `
  -ArmId "arm-01" `
  -Role "inventory" `
  -Model "{model_slug}" `
  -Phase "" `
  -AgentId "{cursor_agent_id_if_known}" `
  -TotalTokens "{n_or_blank}" `
  -CostUsd "{dollars_or_blank}" `
  -Notes "job=product"
```

OpenCode: pull usage from CLI output when available.  
Cursor: paste usage/`Cost` from the Task turn when shown; otherwise leave blank + `usage_missing_pending_export`.

## Verify (gate)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-cost-ledger.ps1 -RunId "{run_id}" -MinRows 1
```

After Test 1a example (2 arms, focused off): expect rows for each inventory + reconcile + inventory_grade (at least). Use `-RequireRoles` when checking a finished test.

## Columns

| Column | Example |
|---|---|
| timestamp_utc | 2026-07-20T12:00:00Z |
| run_id | 2026-07-20-myapp |
| test | 1a / 1b / 2 / 3 / 4 / 5 / 6 |
| arm_id | arm-01 or `shared` |
| phase | P1 or blank |
| role | inventory / grill / review_security / … |
| model | slug |
| agent_id | Cursor/OpenCode agent id if known |
| kind | input/output split if known |
| *_tokens / cost_usd | numbers or blank |
| notes | pack id, job id, usage_missing_pending_export |

## Scoreboard Cost section

At every test gate, roll the CSV into SCOREBOARD:

- **Builder-only $:** roles `inventory`, `grill`, `plan`, `build`, `fix`, `self_*`, `detect`, `vague_fix`  
- **Full pipeline $:** everything including reviewer panel  
- **Solo TCO (T5):** lineage build for that tree + `self_review` + `self_fix` (exclude residual reviewer)

If the CSV has rows but SCOREBOARD Cost is blank, the gate is incomplete.
