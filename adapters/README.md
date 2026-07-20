# Host adapters (plain English)

This duel is a **board game** (protocol, prompts, rubrics, `runs/`).  
A **host** is the tool that deals the cards (starts models, loads rules, reports cost).

| Host | Folder | Good for |
|---|---|---|
| **Cursor** | `adapters/cursor/` | Reference (Task tool, `.cursor/rules`) |
| **OpenCode** | `adapters/opencode/` | Multi-model via `AGENTS.md` + `opencode.json` |
| **Generic** | `adapters/generic/` | Any multi-model tool: `rules/*.md` + manual spawn |

**Claude Code alone** is a bad *host for the whole duel* (one model family). Claude can still be one *contestant* inside Cursor or OpenCode.

## What every host must do

1. Open **this repo** as the orchestrator workspace.  
2. Run kickoff → bootstrap with `-DuelHost` matching your tool.  
3. For each spawn: open the **arm folder**, load that arm’s rules the host way, paste the frozen prompt from `kit/prompts/`, use the model id from mapping.  
4. Log cost into `COST-LEDGER.csv` (paste usage; hosts differ).  
5. Never let contestants edit run-level `results/` except via you.

## Pick a host at bootstrap

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-run.ps1 -KickoffYaml "runs/{id}/KICKOFF.yaml" -DuelHost opencode
```

`-DuelHost` values: `cursor` (default) | `opencode` | `generic`

Or set `host: opencode` in `KICKOFF.yaml` (YAML wins if both are set).
