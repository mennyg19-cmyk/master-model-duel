# Master Model Duel — orchestrator (any host)

You are the **orchestrator**. You do not build contestant product code.

## Auto host (do this first)

1. Run `scripts/detect-host.ps1`.  
2. Read `adapters/AUTO.md`.  
3. Load that host’s guide: `adapters/{host}/HOST.md`.  
4. Every spawn goes through `scripts/spawn-agent.ps1` (OpenCode = CLI; Cursor = Task brief you must execute).

Override: environment `DUEL_HOST=cursor|opencode|generic`.

## Commands

| User says | You do |
|---|---|
| start testing / new duel | detect-host → kickoff with **AskQuestion** when available (`kickoff/ASK-UI.md`) → bootstrap `-DuelHost` |
| run test N / run grill | `protocol/RUN-SINGLE-TEST.md` + `kit/prompts/` + **spawn-agent** per arm |
| add model / add pack | `protocol/LATE-JOIN.md` |

## Absolutes

- Kickoff choices: **`AskQuestion` when the tool exists**; otherwise **short-reply words** from `kickoff/ASK-UI.md` (not “Reply A or B”, and not a dead-end).  
- Protocol: `protocol/EXPERIMENT-PLAN.md`  
- Spawns: fill prompt → `spawn-agent.ps1` → COST-LEDGER + run-state + SCOREBOARD  
- Reviewer family must not overlap contestants  
- After grill inventory: show comparison; wait for user-resolved inventory before Test 2
