# Master Model Duel

A **multi-model agent experiment** you can run in **Cursor**, **OpenCode**, or another multi-model tool.

The tests, prompts, and scorecards are the same everywhere. Only *how* you start models and attach rules changes — see [`adapters/README.md`](adapters/README.md).

| Mode | Compare |
|---|---|
| `model_duel` | Different models, **same** rule pack |
| `rules_duel` | **Same** model, different rule packs |

**Why:** [`PHILOSOPHY.md`](PHILOSOPHY.md).

## Quick start

### Cursor

1. Open this repo in Cursor.  
2. Say **start testing**.  
3. Bootstrap uses `-DuelHost cursor` (default).  
4. Details: [`adapters/cursor/HOST.md`](adapters/cursor/HOST.md).

### OpenCode

1. Open this repo in OpenCode (root [`AGENTS.md`](AGENTS.md) is the orchestrator).  
2. Say **start testing**; set host to **opencode**; use OpenCode model ids.  
3. Bootstrap:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-run.ps1 -KickoffYaml "runs/{id}/KICKOFF.yaml" -DuelHost opencode
```

4. For each spawn: new session in `arms/arm-0N/` with that arm’s model — full steps in [`adapters/opencode/HOST.md`](adapters/opencode/HOST.md).

### Something else

Use `-DuelHost generic` and [`adapters/generic/HOST.md`](adapters/generic/HOST.md).

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
scripts/           bootstrap-run.ps1 (-DuelHost …)
runs/              One archive per experiment
```

Bootstrap copies the kit into `runs/{id}/kit/` and projects rules for your host (`.cursor/rules` or `rules/*.md` + `AGENTS.md`).
