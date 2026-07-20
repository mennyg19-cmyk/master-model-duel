# Master Model Duel

Reusable Cursor harness for agent experiments. Open this repo, say **"start testing"**, pick a mode, and the orchestrator bootstraps an isolated run under `runs/{run_id}/`.

| Mode | Compare |
|---|---|
| `model_duel` | Different models, **same** rule pack |
| `rules_duel` | **Same** model, different rule packs |

**Why this exists:** [`PHILOSOPHY.md`](PHILOSOPHY.md). Rules mode details: [`protocol/RULES-DUEL.md`](protocol/RULES-DUEL.md).

Each run stays forever — start as many as you want; they don’t overwrite each other.

## What it measures (protocol)

See [`protocol/EXPERIMENT-PLAN.md`](protocol/EXPERIMENT-PLAN.md):

1. Inventory from a real codebase **and** (optional/default) inventory from grilling you — reviewer diffs them for you  
2. Greenfield build plan (from your resolved inventory)  
3. Build without review feedback  
4. Build with one review→fix pass per phase  
5. Solo self-review → fix → third-party residual (which model to commit to alone)  
6. Detect + vague fix on the winner  

Dual inventory details: [`protocol/GRILL-INVENTORY.md`](protocol/GRILL-INVENTORY.md).

Scorecard: **Option D** (dual headlines) + parallel `$`/token ledger.

## Quick start

1. Clone this repo and open it in Cursor.  
2. Say: **start testing**  
3. Answer kickoff (mode, models/packs, catalog rules, reviewer, **inventory spawn shape**, **self-review spawn shape**).  
4. Confirm → bootstrap creates `runs/{run_id}/`.  
5. Either run the full suite, or run tests one at a time:

| Say | Runs |
|---|---|
| **run test 1** / **run inventory** | Codebase inventory + grill inventory (if enabled) → reviewer diff for you |
| **run test 1a** | Codebase inventory only |
| **run test 1b** / **run grill** | Grill inventory only (asks seed; grades turn quality) |
| **run test 2** / **run plan** | Build plan (needs **user-resolved** inventory after dual track) |
| **run test 3** | Build without review feedback (needs merged plan) |
| **run test 4** | Build with one review→fix pass |
| **run test 5** / **run self-review** | Solo self-review loop (asks single vs focused) |
| **run test 6** / **run detect** | Detect + vague fix |
| **continue testing** / **run remaining** | Next unfinished / rest of suite |

Details: [`protocol/RUN-SINGLE-TEST.md`](protocol/RUN-SINGLE-TEST.md).

## Layout

```
catalog/           Model families + selectable rules
kickoff/           Interview script + KICKOFF schema
protocol/          Locked experiment methodology
template/arm/      Contestant AGENTS + base prompt
scripts/           bootstrap-run.ps1
runs/              One folder per experiment (archives)
.cursor/rules/     Orchestrator: start-testing, run-test, posture
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

## Rule packs (stock + your own)

Kickoff always **scans the catalog** (`catalog/RULE-CATALOG.md` + `catalog/rules/*.mdc`) and asks which of those rules to include. It does not use a fixed memorized list.

**Add your own:** drop `{id}.mdc` into `catalog/rules/`, add a row to [`catalog/RULE-CATALOG.md`](catalog/RULE-CATALOG.md). Next **start testing** (or **add pack**), that ID is in the checklist with everything else. Don’t paste one-off rules into arm folders — bootstrap only copies from the catalog.

### Ablation modes

- **Across runs (`model_duel`):** same models, change `rules_selected`, compare FINAL-REPORTs.  
- **Inside one run (`rules_duel`):** one model, N packs side by side — see [`protocol/RULES-DUEL.md`](protocol/RULES-DUEL.md).

## Dual inventory (codebase + grill)

Full suite (and **run test 1**) can produce **two** inventories per arm:

1. **Codebase** — model reads the old app  
2. **Grill** — model interviews you under `grill-protocol` (different questions across models are expected)

The **reviewer** grades each Q&A turn for quality (needed vs fluff, explain-down, real vs hallucinated options, uptake) — not raw turn count. Same inventory quality with fewer necessary questions scores higher on efficiency. Then it diffs codebase vs grill and shows you what changed and why so you can freeze `USER-RESOLVED-INVENTORY.md` before planning.

See [`protocol/GRILL-INVENTORY.md`](protocol/GRILL-INVENTORY.md).

## Focused specialists (inventory + self-review)

At kickoff (and again when you **run test 1** / **run test 5** if unset):

- **Inventory:** one deep agent **or** several agents of the **same contestant model**, each on a different job (security, data, UI, …), then merge.  
- **Self-review:** one deep agent **or** several same-model specialists (security, quality, rules, clean-code, …), then self-aggregate → one fix.

Job lists: [`catalog/SPECIALIST-ROLES.md`](catalog/SPECIALIST-ROLES.md). External residual / build reviewers still use the kickoff **reviewer** model.

## Reviewer family lock

`catalog/MODEL-FAMILIES.json` maps slugs → families. Bootstrap **refuses** a reviewer whose family appears in the contestant set (e.g. no Fable reviewer if Fable is competing).

## Late join

Add an arm mid-run without restarting:

- `model_duel` → **add model** (same shared rules)  
- `rules_duel` → **add pack** (same model, new rule list)  
- Shared freezes stay put; late arm can earn **bonus**; builds still use the merged plan  

Details: [`protocol/LATE-JOIN.md`](protocol/LATE-JOIN.md)

## License

MIT
