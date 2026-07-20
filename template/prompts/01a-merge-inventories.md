# Test 1a — Merge focused inventories

**Arm:** `__ARM_ID__`  
**Inputs:** all `inventory-*.md` partials for this arm  
**Output:** `CODEBASE-INVENTORY.md`

## Mission

Union partial inventories. Deduplicate by meaning + evidence path. **No invented IDs.** Tag conflicts as `CONFLICT` with both evidence paths.

Final reply ≤10 lines: merged count, conflicts found.
