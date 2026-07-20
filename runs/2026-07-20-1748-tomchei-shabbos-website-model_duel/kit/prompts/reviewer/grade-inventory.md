# Reviewer — Grade codebase inventory (1a)

**Arm:** `__ARM_ID__` (blind)  
**Arm inventory:** `__ARM_INVENTORY__`  
**Reconciled:** `shared/RECONCILED-INVENTORY.md`  
**Output:** `results/reviews/inventory-grade-__ARM_ID__.md`

Use rubric `template/rubrics/inventory-1a.md` (or `kit/rubrics/inventory-1a.md` in a run).

## Scoring rules (mandatory)

1. **Denominator = full reconciled list.** Count every reconciled ID once.  
2. **`UNIQUE-TO-*` is attribution, not a filter.** Do **not** exclude peer-unique rows when scoring this arm.  
3. **Recall** = (# reconciled IDs this arm covered with real evidence) / (total reconciled IDs). Map that % to the recall band table.  
4. **Precision** = junk / unevidenced IDs in the arm inventory (fabricated paths hurt).  
5. Write integers: `covered=N`, `total_reconciled=T`, `coverage_pct=…`, then band scores.  
6. No model names — arm ids only.

## Forbidden rationales

- “Out of scope because UNIQUE-TO-arm-02”  
- “Expected = SHARED + own unique only”  
- Giving 4/4 recall when coverage of the full reconciled set is clearly below 90%

Score recall + precision. List junk IDs.
