# Cost ledger how-to (orchestrator-owned — mandatory)

File: `runs/{run_id}/results/COST-LEDGER.csv`

## Why tokens/$ are often blank (Cursor Task)

Cursor **Task/subagent** spawn does **not** return token or dollar totals to the parent chat in a structured field.  
So if you only run `append-cost-ledger.ps1` with `-Role` / `-AgentId` / notes, the CSV gets a row but **empty** `total_tokens` / `cost_usd`.

That is not “ledger broken” — usage was never passed in. Fix by capturing usage (below) or backfilling from Cursor’s export.

## Hard gate

| Rule | Detail |
|---|---|
| When | **Immediately after every spawn returns** |
| How | `scripts/append-cost-ledger.ps1` with **`-TotalTokens` and/or `-CostUsd` whenever known** |
| Cursor | Turn on **Settings → Agents → Usage Summary → Always**. After each Task finishes, read the usage/`$` line and pass those numbers into append. |
| OpenCode | Parse CLI usage if printed; pass into append. |
| Still unknown? | Append anyway (notes=`usage_missing_pending_export`) — **provisional only**. Do not claim the test’s Cost gate is done. |
| Before next spawn | Row must exist (`appended=1`). Prefer `usage=present`. |
| Before test gate | `verify-cost-ledger.ps1 -RequireUsage` must print `ok=true`, **or** you have backfilled from export and then verify. Empty SCOREBOARD Cost = fail. |

## Append (required)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/append-cost-ledger.ps1 `
  -RunId "{run_id}" -Test "4" -ArmId "arm-01" -Role "build" -Model "{slug}" `
  -Phase "P3" -AgentId "{task_id}" `
  -TotalTokens "123456" -CostUsd "1.23" `
  -InputWithCacheWrite "" -InputWithoutCache "" -CacheRead "" -OutputTokens "" `
  -Notes "…"
```

If append prints `usage=MISSING`, you still owe tokens/`$` before the test gate.

## Backfill from Cursor dashboard (when live paste failed)

1. https://cursor.com/dashboard/usage → Export CSV for the duel days  
2. Save as `runs/{run_id}/.scratch/cursor-usage-export.csv`  
3. Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backfill-cost-ledger.ps1 -RunId "{run_id}"
```

Matches by model + timestamp window (~20 min). Then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-cost-ledger.ps1 -RunId "{run_id}" -RequireUsage
```

## Verify

```powershell
# rows exist
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-cost-ledger.ps1 -RunId "{run_id}" -MinRows 1

# tokens or $ present on every real spawn (test gate)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-cost-ledger.ps1 -RunId "{run_id}" -RequireUsage
```

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
| *_tokens / cost_usd | **required by test gate** (live or backfill) |
| notes | pack id, job id, usage_missing_pending_export, backfilled_from_cursor_csv |

## Scoreboard Cost section

Roll CSV into SCOREBOARD at every test gate (builder-only / full pipeline / solo TCO). Blank Cost while spawns ran = incomplete.
