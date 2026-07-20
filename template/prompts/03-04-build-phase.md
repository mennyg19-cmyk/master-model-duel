# Test 3 / 4 — Build phase

**Arm:** `__ARM_ID__`  
**Workspace:** `__WORKSPACE__`  
**Merged plan:** `__PLAN__`  
**Phase:** `__PHASE_ID__`  
**EXPECTED:** `__PHASE_EXPECTED__`  
**Ports:** web `__WEB_PORT__` db `__DB_PORT__`  
**Mode:** `__BUILD_MODE__`  (`no_feedback` | `with_review`)

## Mission

Implement **only** this phase from the merged plan. Write EXPECTED checklist items as you go; smoke must pass before you claim done.

## If mode = with_review and AGGREGATE provided

You may receive `__AGGREGATE_REVIEW__` for a **single** fix pass after the phase grade. Do not start the next phase until smoke passes after the fix.

## Hard rules

1. Absolute greenfield — no old apps, no sibling arms, no web harvest of the product.  
2. Do not git. Do not touch `results/` at run root.  
3. Evidence: smoke output path + short note in `workspace/.scratch/PHASE-__PHASE_ID__-STATUS.md`.  
4. Final reply ≤10 lines: what shipped, smoke proof, blockers.
