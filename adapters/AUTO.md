# Auto host + spawn (orchestrator cheat sheet)

## Detect

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/detect-host.ps1
```

Override anytime: `$env:DUEL_HOST = "opencode"` (or `cursor` / `generic`).

| Result `spawn=` | Meaning |
|---|---|
| `opencode_cli` | Orchestrator **runs** `scripts/spawn-agent.ps1` (shell) |
| `cursor_task` | Orchestrator **spawns Cursor Task** using the brief spawn-agent writes |
| `manual` | Orchestrator follows the manual brief |

## Spawn one agent

1. Fill placeholders in a copy of `kit/prompts/….md` under the arm or run `.scratch/`.  
2. Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spawn-agent.ps1 -ArmDir "runs/{id}/arms/arm-01" -Model "{model_id}" -PromptFile "path\to\filled-prompt.md" -Role inventory -DuelHost auto
```

3. Exit code **2** on Cursor/generic = you must finish the spawn in-UI (brief path printed).  
4. Exit code **0** on OpenCode = CLI run finished (check arm `results/`).  
5. Always append `COST-LEDGER.csv`.

## Kickoff

If `detect-host` confidence is **high**, skip asking Q-1 — write `host:` from detection.  
If **low/medium**, show detection + ask user to confirm.
