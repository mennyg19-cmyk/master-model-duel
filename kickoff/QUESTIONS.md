# Kickoff questions ("start testing")

Ask **one group at a time**. Do not bootstrap until all answers are locked in `runs/{run_id}/KICKOFF.yaml`.

## Q1 — Source codebase

**Ask:** Absolute path (or git URL + local clone path) of the repo to inventory in Test 1.

**Validate:** Path exists; is a git repo or readable tree. Record as `source_codebase`. After Test 1 this path is **not** mounted into builder workspaces.

## Q2 — Contestant models

**Ask:** List of Cursor model slugs to test (`N ≥ 2`).

**Validate:** Each slug resolves in `catalog/MODEL-FAMILIES.json` (or user confirms a new slug + family). Assign `arm_id` = `arm-01` … `arm-N`, ports `3100+i`, folders under `runs/{run_id}/arms/{arm_id}/`.

## Q3 — Reviewer model

**Ask:** One model slug for **all** external review roles (specialists, aggregator, reconciler, chooser, residual).

**Validate (hard fail):** Reviewer’s `family` must **not** appear in the set of contestant families.  
Example: contestants = Fable + Sol → reviewer cannot be `claude-fable-*` or `gpt-5.6-sol-*`. GLM / Grok / Gemini / Terra / Sonnet may be OK depending on contestants.

If invalid: refuse, list allowed families, ask again.

## Q4 — Rule packs (ablation)

**Ask:** Which rule IDs from `catalog/RULE-CATALOG.md` to include in every contestant arm?

**Suggest default on:** `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`  
**Suggest default off:** `git-discipline`, `grill-protocol`, `plan-review`, `context-canary` (unless user wants that ablation)

Record exact list in `KICKOFF.yaml` → `rules_selected`. Same list for all arms.

## Q5 — Run label

**Ask:** Short slug for this run (or accept auto `yyyy-MM-dd-HHmm` + source repo name).

## Q6 — Confirm

Show summary:

- source path  
- contestants (slug + family + arm_id)  
- reviewer (slug + family) + proof of no family overlap  
- rules selected  
- run_id path `runs/{run_id}/`

**Ask:** Proceed to bootstrap? Yes → run `scripts/bootstrap-run.ps1` then begin Test 1 per `protocol/EXPERIMENT-PLAN.md`.
