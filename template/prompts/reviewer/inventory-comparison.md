# Reviewer — Inventory comparison (user-facing)

**Inputs:** per-arm CODEBASE-INVENTORY + GRILL-INVENTORY (+ optional reconciled both)  
**Output:** `shared/INVENTORY-COMPARISON.md`

## For each arm

| Bucket | IDs |
|---|---|
| Only in codebase | … |
| Only in grill | … |
| In both | … |
| Contradictions | … |

Plain English: what changed and why it matters for the rebuild. No model names.

End with: **User action required** — edit/approve into `shared/USER-RESOLVED-INVENTORY.md` before Test 2.
