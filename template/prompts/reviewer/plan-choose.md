# Reviewer — Choose / merge plans

**Inputs:** all arm `BUILD-PLAN.md` files + frozen inventory  
**Output:** `shared/MERGED-BUILD-PLAN.md`

## Rules

1. Merge from the union of plans. Cite source `arm_id` per major choice.  
2. No silent invention past the plan union + inventory.  
3. Orchestrator will cut equal phase IDs afterward — keep phases mergeable.
