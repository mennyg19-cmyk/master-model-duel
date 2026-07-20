# Spawn checklist (orchestrator)

0. [ ] `detect-host.ps1` run; host locked  
1. [ ] Correct model id for that host  
2. [ ] Frozen prompt filled  
3. [ ] `spawn-agent.ps1` invoked (OpenCode CLI or Cursor Task brief executed)  
4. [ ] Blind: reviewer does not see model names  
5. [ ] **COST-LEDGER row appended via `scripts/append-cost-ledger.ps1`** (required — spawn incomplete without it)  
6. [ ] RUN-STATE.md updated  

Do **not** start the next spawn until step 5 succeeded (`appended=1`). Blank `$` is fine; skipping the row is not.

## Test / phase gate

Before marking a test or phase done:

1. [ ] `verify-cost-ledger.ps1 -RunId …` → `ok=true`  
2. [ ] SCOREBOARD **Cost** section filled from the CSV (not left empty)  
3. [ ] Expected roles for this test have rows (inventory, reviews, etc.)

## Test 1b interleave

Do **not** finish all turns for arm-01 then arm-02 if the same human answers. Prefer:

`arm-01 Turn N` → user answers → `arm-02 Turn N` → user answers → …

Log order in RUN-STATE. If impractical, note fatigue risk in DEVIATIONS.
