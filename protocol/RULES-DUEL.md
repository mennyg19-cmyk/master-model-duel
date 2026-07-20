# Rules duel — same model, different Cursor rules

**Mode:** `run_mode: rules_duel` in `KICKOFF.yaml`

## Why

Model comparisons hold the rule pack constant. This mode does the opposite: **one model**, **N rule packs**, so you can see whether `clean-code`, `context-canary`, ponytail, etc. help or just burn tokens for *that* model on *this* codebase.

## Fairness rules

| Locked equal | Allowed to differ |
|---|---|
| Contestant model slug | Rule pack per arm |
| Reviewer model / family | Pack labels |
| Source codebase | — |
| Reconciled inventory (after Test 1) | — |
| Merged build plan + phase cuts | — |
| Smoke scripts / scorecard weights | — |

The **rules specialist** in the review panel grades each arm against **that arm’s** selected rules only (not against packs it never received).

## Kickoff shape

```yaml
run_mode: rules_duel
contestant_model: gpt-5.6-sol-high
reviewer_model: glm-5.2-high
rule_packs:
  - pack_id: full
    label: default stack
    rules:
      - ponytail
      - clean-code
      - workflow
      - vocabulary
      - codegraph
  - pack_id: no-clean-code
    label: drop clean-code
    rules:
      - ponytail
      - workflow
      - vocabulary
      - codegraph
```

Kickoff always offers rule IDs from the **live catalog** (`RULE-CATALOG.md` + `catalog/rules/*.mdc`), including user-added files. Packs may only reference those IDs.

Bootstrap expands each pack into `arms/arm-0N/` with only that pack’s `.cursor/rules/` files (writes `ARMS-EXPANDED.yaml` for auditors).  
`ARM.md` records `pack_id` + rule list. Mapping file records model + pack (model is the same; pack is the variable).

## Scoring

Same Tests 1–6 and Option D as `protocol/EXPERIMENT-PLAN.md`.

**Report must lead with the pack axis**, e.g. “Sol + full rules vs Sol + no-clean-code,” not pretend these are different models.

Cost ledger `notes` or `arm_id` should make packs obvious (`arm-01` ↔ `full` in KICKOFF / ARM.md).

## Late join

You may add another **pack** for the same `contestant_model` (`protocol/LATE-JOIN.md` + new pack).  
Do not late-join a *different model* into a `rules_duel` — start a `model_duel` (or a new run) instead.

## What this does not claim

A rules duel on one app / one model is still N=1. Re-run on another codebase before declaring a rule pack universally better.
