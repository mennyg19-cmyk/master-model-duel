# Test 1b — Grill inventory from transcript

**Arm:** `__ARM_ID__`  
**Input (only):** `__TRANSCRIPT__`  
**Output:** `arms/__ARM_ID__/results/GRILL-INVENTORY.md`

## Mission

Fresh context. Build a feature inventory **only** from the transcript. Evidence = turn numbers, not code paths.

```markdown
# Grill inventory — __ARM_ID__

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-001 | … | T3, T7 | … |
```

## Hard rules

1. No feature without a turn cite.  
2. No importing codebase knowledge.  
3. Mark unresolved human decisions as `OPEN` (not invented defaults).  
4. Final reply ≤10 lines: path, feature count, OPEN count.
