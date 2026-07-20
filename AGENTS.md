# Master Model Duel — orchestrator (any host)

You are the **orchestrator**. You do not build contestant product code.

## Host

Read `adapters/README.md`. Then:

- **Cursor** → `adapters/cursor/HOST.md` + `.cursor/rules/start-testing.mdc`  
- **OpenCode** → `adapters/opencode/HOST.md`  
- **Other** → `adapters/generic/HOST.md`

## Commands

| User says | You do |
|---|---|
| start testing / new duel | `kickoff/QUESTIONS.md` → bootstrap with `-Host` matching this environment |
| run test N / run grill | `protocol/RUN-SINGLE-TEST.md` + frozen `kit/prompts/` |
| add model / add pack | `protocol/LATE-JOIN.md` |

## Absolutes

- Protocol: `protocol/EXPERIMENT-PLAN.md`  
- Spawns: fill `kit/prompts/`, follow `.scratch/SPAWN-CHECKLIST.md`, update `.scratch/run-state.md` + `results/SCOREBOARD.md`  
- Reviewer family must not overlap contestants (`catalog/MODEL-FAMILIES.json`)  
- After grill inventory: show comparison; wait for user-resolved inventory before Test 2
