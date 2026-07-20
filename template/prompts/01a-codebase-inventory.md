# Test 1a — Codebase inventory

**Arm:** `__ARM_ID__`  
**Workspace:** `__WORKSPACE__` (optional scratch only — do not modify source)  
**Source (read-only):** `__SOURCE__`

## Mission

Read the source codebase and write a **feature inventory** to:

`arms/__ARM_ID__/results/CODEBASE-INVENTORY.md`

(If that folder does not exist, write under `workspace/.scratch/CODEBASE-INVENTORY.md` and tell the orchestrator.)

## Required format

```markdown
# Codebase inventory — __ARM_ID__

## Proof-of-read
- Rules files read: N
- Top-level dirs sampled: …

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | … | path/to/file | … |
```

## Hard rules

1. **Every ID needs an evidence path** in the source tree. No invented features.  
2. Prefer user-visible / behavioral features over every helper function.  
3. Do not read other arms, prior duel trees, or the web for this product.  
4. Final reply ≤10 lines: path written, feature count, any blocked areas.

## If focused specialist mode

Your **job** is: `__INVENTORY_JOB__` (orchestrator fills). Only inventory that job’s slice. Write `inventory-__INVENTORY_JOB__.md`. A merge agent will union later.
