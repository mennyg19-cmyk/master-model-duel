## Cursor host

## Ask UI

For kickoff and other fixed choices, use Cursor’s **`AskQuestion`** tool (see `kickoff/ASK-UI.md`). Do not paste long option lists in chat when AskQuestion is available.

## Orchestrator

1. Open this repo in Cursor.  
2. Say **start testing** / **run test N** (rules in `.cursor/rules/`).  
3. Bootstrap with `-DuelHost cursor` (or auto from detect-host).  
4. Spawn via `scripts/spawn-agent.ps1` → execute the Cursor Task brief.  
5. Arm rules live in `arms/{id}/.cursor/rules/*.mdc`.

## Cost

Paste Cursor usage / Cost into `results/COST-LEDGER.csv`. Optional: reconcile from Cursor CSV export later.

## Model ids

Use slugs from `catalog/MODEL-FAMILIES.json` → `slugs` (Cursor names). Family overlap check uses those.
