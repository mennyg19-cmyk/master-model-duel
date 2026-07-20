# Reviewer — Reconcile codebase inventories

**Inputs:** each arm’s `CODEBASE-INVENTORY.md` + source tree `__SOURCE__`  
**Output:** `shared/RECONCILED-INVENTORY.md`

## Rules

1. Union only. Tag `SHARED` / `UNIQUE-TO-{arm_id}`.  
2. Every ID needs an evidence path that exists. Drop or flag hallucinations.  
3. Deduplicate by meaning + path.  
4. No invented features.  
5. Do not see contestant model names — only arm ids.
