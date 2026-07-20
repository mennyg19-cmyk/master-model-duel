## Cursor host

## Ask UI

- **If `AskQuestion` exists** → clickable kickoff (`kickoff/ASK-UI.md`). Never “Reply A or B.”  
- **If not** (Grok Agent often has no AskQuestion) → short-reply words (`models` / `rules`, …). Continue the run; don’t tell the user to switch chats.

## Orchestrator

1. Open this repo in Cursor.  
2. Say **start testing** / **run test N** (rules in `.cursor/rules/`).  
3. Bootstrap with `-DuelHost cursor` (or auto from detect-host).  
4. Spawn via `scripts/spawn-agent.ps1` → execute the Cursor Task brief.  
5. Arm rules live in `arms/{id}/.cursor/rules/*.mdc`.

## Cost (hard gate)

After **every** Task spawn, run `scripts/append-cost-ledger.ps1` with **token/`$` from Usage Summary** (Settings → Agents → Usage Summary → Always). Cursor Task does **not** auto-fill the ledger — you must copy the numbers.  

If you missed them: export https://cursor.com/dashboard/usage CSV → `runs/{id}/.scratch/cursor-usage-export.csv` → `scripts/backfill-cost-ledger.ps1`.  

Test gate: `verify-cost-ledger.ps1 -RequireUsage`. See `results/COST-LEDGER-HOWTO.md`.

## Model ids

Use slugs from `catalog/MODEL-FAMILIES.json` → `slugs` (Cursor names). Family overlap check uses those.
