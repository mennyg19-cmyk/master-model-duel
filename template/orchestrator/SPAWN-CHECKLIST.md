# Spawn checklist (orchestrator)

Before each spawn:

1. [ ] Correct model slug (contestant vs reviewer family check already done at kickoff)  
2. [ ] Frozen prompt from `template/prompts/` (or run copy under `runs/.../kit/prompts/`) with placeholders filled  
3. [ ] Arm workspace / rules present  
4. [ ] Blind: reviewer does not see model names  
5. [ ] COST-LEDGER row reserved / will append after  
6. [ ] RUN-STATE.md `next_action` matches this spawn  

## Test 1b interleave

Do **not** finish all turns for arm-01 then arm-02 if the same human answers. Prefer:

`arm-01 Turn N` → user answers → `arm-02 Turn N` → user answers → …

Log order in RUN-STATE. If impractical, note fatigue risk in DEVIATIONS.
