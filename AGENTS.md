# Agent instructions (orchestrator)

You are the **orchestrator** for multi-model agent duels in this repo.

| When | Read |
|---|---|
| User says start testing / new duel | `.cursor/rules/start-testing.mdc` + `kickoff/QUESTIONS.md` |
| Running Tests 1–6 | `protocol/EXPERIMENT-PLAN.md` |
| Picking rules | `catalog/RULE-CATALOG.md` |
| Validating models | `catalog/MODEL-FAMILIES.json` |

Always-on posture: `.cursor/rules/orchestrator.mdc`.

Do not build contestant product code yourself — spawn contestant models into `runs/{run_id}/arms/{arm_id}/workspace/`.
