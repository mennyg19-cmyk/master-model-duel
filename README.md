# Master Model Duel

A **multi-model agent experiment**. It **detects** whether you’re in Cursor or OpenCode (or falls back to generic) and uses that host’s spawn path — see [`adapters/AUTO.md`](adapters/AUTO.md).

| Mode | Compare |
|---|---|
| `model_duel` | Different models, **same** rule pack |
| `rules_duel` | **Same** model, different rule packs |

**Why:** [`PHILOSOPHY.md`](PHILOSOPHY.md).

## Quick start

1. Open this repo in **Cursor** or **OpenCode**.  
2. Say **start testing** — orchestrator detects host, then asks setup with **clickable questions** (Cursor `AskQuestion`) when available. If you’re logged into GitHub (`gh auth login`) or GitLab (`glab`), Q1 lists your remotes to pick from.  
3. Bootstrap uses the detected `-DuelHost`.  
4. Spawns go through `scripts/spawn-agent.ps1`:
   - **OpenCode** → `opencode run` in the arm folder (CLI)  
   - **Cursor** → Task brief the orchestrator must spawn  
   - **Generic** → manual brief  

Override detection: set env `DUEL_HOST=opencode` (or `cursor` / `generic`).

Host details: [`adapters/README.md`](adapters/README.md).

---

## What it measures

See [`protocol/EXPERIMENT-PLAN.md`](protocol/EXPERIMENT-PLAN.md):

1. Inventory from codebase **+** optional grill inventory (reviewer diffs for you)  
2. Greenfield build plan (from your resolved inventory)  
3. Build without review feedback  
4. Build with one review→fix pass  
5. Solo self-review → fix → residual  
6. Detect + vague fix  

Commands: **run test 1**…**6**, **run grill**, etc. — [`protocol/RUN-SINGLE-TEST.md`](protocol/RUN-SINGLE-TEST.md).

## Layout

```
adapters/          How to run on Cursor / OpenCode / generic
protocol/          The duel rules (host-agnostic)
template/          Frozen prompts, rubrics, smoke, Test 6
catalog/           Model families + selectable rules
kickoff/           Interview script
scripts/           bootstrap, detect-host, list-model/source-options, resolve-source, spawn
runs/              One archive per experiment
```

Bootstrap copies the kit into `runs/{id}/kit/` and projects rules for your host (`.cursor/rules` or `rules/*.md` + `AGENTS.md`).
