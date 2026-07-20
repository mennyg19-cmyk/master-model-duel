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

After **every** Task spawn, run `scripts/append-cost-ledger.ps1` before the next spawn. Paste Cursor usage/`Cost` into `-CostUsd` / token fields when shown; if missing, still append (notes get `usage_missing_pending_export`).  
Do not mark a test done until `scripts/verify-cost-ledger.ps1` prints `ok=true` and SCOREBOARD Cost is filled. See `results/COST-LEDGER-HOWTO.md`.

## Model ids

Use slugs from `catalog/MODEL-FAMILIES.json` → `slugs` (Cursor names). Family overlap check uses those.
