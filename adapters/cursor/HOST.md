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

## Cost

Paste Cursor usage / Cost into `results/COST-LEDGER.csv`. Optional: reconcile from Cursor CSV export later.

## Model ids

Use slugs from `catalog/MODEL-FAMILIES.json` → `slugs` (Cursor names). Family overlap check uses those.
