# Spawn checklist (orchestrator)

0. [ ] `detect-host.ps1` run; host locked  
1. [ ] Correct model id for that host  
2. [ ] Frozen prompt filled  
3. [ ] `spawn-agent.ps1` invoked (OpenCode CLI or Cursor Task brief executed)  
4. [ ] Blind: reviewer does not see model names  
5. [ ] **COST-LEDGER via `append-cost-ledger.ps1`** with `-TotalTokens` / `-CostUsd` when Usage Summary shows them (`usage=present` preferred; `usage=MISSING` = provisional)  
6. [ ] RUN-STATE.md updated  

Do **not** start the next spawn until step 5 prints `appended=1`.

## Test / phase gate

1. [ ] `verify-cost-ledger.ps1 -RunId … -RequireUsage` → `ok=true` (backfill from Cursor usage CSV first if needed)  
2. [ ] SCOREBOARD **Cost** filled from CSV  
3. [ ] Expected roles for this test have rows  

## Test 1b interleave

Do **not** finish all turns for arm-01 then arm-02 if the same human answers. Prefer:

`arm-01 Turn N` → user answers → `arm-02 Turn N` → user answers → …

Log order in RUN-STATE. If impractical, note fatigue risk in DEVIATIONS.
