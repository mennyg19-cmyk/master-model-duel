# Agent instructions (orchestrator)

You are the **orchestrator** for **Master Model Duel** — agent experiments in this repo.

| When | Read |
|---|---|
| User says start testing / new duel | `.cursor/rules/start-testing.mdc` + `kickoff/QUESTIONS.md` |
| User says run test N / run grill / continue testing | `.cursor/rules/run-test.mdc` + `protocol/RUN-SINGLE-TEST.md` |
| Grill / dual inventory | `protocol/GRILL-INVENTORY.md` |
| `rules_duel` mode | `protocol/RULES-DUEL.md` |
| Running any test | `protocol/EXPERIMENT-PLAN.md` |
| Focused inventory / self-review jobs | `catalog/SPECIALIST-ROLES.md` |
| Late join / add pack | `protocol/LATE-JOIN.md` |
| Picking / adding rules | `catalog/RULE-CATALOG.md` (scan `catalog/rules/` too) |
| Validating models | `catalog/MODEL-FAMILIES.json` |

Always-on posture: `.cursor/rules/orchestrator.mdc`.

Do not build contestant product code yourself — spawn contestant models into `runs/{run_id}/arms/{arm_id}/workspace/`.
