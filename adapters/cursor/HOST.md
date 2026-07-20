# Cursor host

## Orchestrator

1. Open this repo in Cursor.  
2. Say **start testing** / **run test N** (rules in `.cursor/rules/`).  
3. Bootstrap with `-Host cursor` (default).  
4. Spawn contestants with Cursor Task/subagents into `arms/{id}/` using the model slug from mapping.  
5. Arm rules live in `arms/{id}/.cursor/rules/*.mdc`.

## Cost

Paste Cursor usage / Cost into `results/COST-LEDGER.csv`. Optional: reconcile from Cursor CSV export later.

## Model ids

Use slugs from `catalog/MODEL-FAMILIES.json` → `slugs` (Cursor names). Family overlap check uses those.
