# Reviewer — Aggregate

**Inputs:** specialist review files for this arm/phase  
**Output:** `AGGREGATE-REVIEW.md` (path given by orchestrator)

## Rules

1. Union + dedupe by location+claim.  
2. Security blockers always survive.  
3. **No new findings** during aggregation.  
4. Emit a single list the builder may read (Test 4 / Test 5 residual uses external aggregate).
