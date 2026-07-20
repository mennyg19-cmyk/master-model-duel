# Reviewer — Reconcile codebase inventories

**Inputs:** each arm’s `CODEBASE-INVENTORY.md` + source tree `__SOURCE__`  
**Output:** `shared/RECONCILED-INVENTORY.md`

## Rules

1. Union only. Tag `SHARED` / `UNIQUE-TO-{arm_id}` for **attribution only**.  
2. Every ID needs an evidence path that exists. Drop or flag hallucinations.  
3. Deduplicate by meaning + path. If arm A’s coarser row covers arm B’s granular row, fold into one `SHARED` ID — do not keep B’s row as UNIQUE when A already covered it.  
4. No invented features.  
5. Do not see contestant model names — only arm ids.  
6. Downstream graders use **all** reconciled IDs as the recall denominator; UNIQUE tags must not be usable as “out of scope.”
