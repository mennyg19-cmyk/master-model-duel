# Master Model Duel

Reusable Cursor harness for **multi-model agent experiments**. Open this repo, say **"start testing"**, answer the kickoff questions, and the orchestrator bootstraps an isolated run under `runs/{run_id}/`.

Each run stays forever — start as many as you want; they don’t overwrite each other.

## What it measures (protocol)

See [`protocol/EXPERIMENT-PLAN.md`](protocol/EXPERIMENT-PLAN.md):

1. Inventory from a real codebase  
2. Greenfield build plan  
3. Build without review feedback  
4. Build with one review→fix pass per phase  
5. Solo self-review → fix → third-party residual (which model to commit to alone)  
6. Detect + vague fix on the winner  

Scorecard: **Option D** (dual headlines) + parallel `$`/token ledger.

## Quick start

1. Clone this repo and open it in Cursor.  
2. Say: **start testing**  
3. Answer:
   - source repo path (Test 1 inventory only)
   - contestant model slugs (`N ≥ 2`)
   - reviewer model (must be a **different family** than every contestant)
   - which rule packs to include (ablation — same set for all arms)
4. Confirm → bootstrap creates `runs/{run_id}/` with one sandbox per contestant.  
5. Orchestrator runs Tests 1–6 to completion.

## Layout

```
catalog/           Model families + selectable rules
kickoff/           Interview script + KICKOFF schema
protocol/          Locked experiment methodology
template/arm/      Contestant AGENTS + base prompt
scripts/           bootstrap-run.ps1
runs/              One folder per experiment (archives)
.cursor/rules/     Orchestrator: start-testing + posture
```

### One run looks like

```
runs/2026-07-20-myapp/
  KICKOFF.yaml
  SOURCE.md
  README.md
  arms/arm-01/     .cursor/rules/ + workspace/
  arms/arm-02/
  shared/          reconciled inventory, merged plan
  results/         reviews, scores, COST-LEDGER.csv, FINAL-REPORT
  .scratch/        mapping (hidden until reveal)
```

## Rule ablation

Kickoff asks which rules to copy into every arm (`catalog/RULE-CATALOG.md`).  
Example: leave out `clean-code` or `context-canary` to see who still ships cleanly.

## Reviewer family lock

`catalog/MODEL-FAMILIES.json` maps slugs → families. Bootstrap **refuses** a reviewer whose family appears in the contestant set (e.g. no Fable reviewer if Fable is competing).

## Late join

You can add another model to an **existing** run without restarting:

- Say **add model** / **late join**
- Shared live-duel freezes stay put (reconciled inventory, merged plan, rules, reviewer)
- Late arm is graded against those freezes and can earn **bonus** if it finds more real features (or plans better) than the freeze captured
- Build tests still use the **same merged plan** so execution stays equal

Details: [`protocol/LATE-JOIN.md`](protocol/LATE-JOIN.md)

## License

MIT
