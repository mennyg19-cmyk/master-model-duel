## Cursor host

## Ask UI

Kickoff **must** use Cursor’s **`AskQuestion`** tool (clickable cards).  
**Never** ask the user to type A/B. If AskQuestion isn’t in the agent’s tool list, stop and tell the user — see `kickoff/ASK-UI.md`.

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
