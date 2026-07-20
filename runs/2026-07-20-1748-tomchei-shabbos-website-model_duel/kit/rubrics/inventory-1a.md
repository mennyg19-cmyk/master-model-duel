# Rubric — Test 1a Codebase inventory

**Arm:** ____  
**Max:** 7 points (when grill on) or 15 (grill off — scale ×15/7)

## Hard rule (denominator)

**Denominator = every ID in `shared/RECONCILED-INVENTORY.md`.**  
`SHARED` / `UNIQUE-TO-{arm}` tags are **attribution only** (who found it). They do **not** shrink the denominator and do **not** excuse an arm for missing peer-unique rows.

Wrong: “expected = SHARED + this arm’s UNIQUE”  
Right: “expected = all reconciled IDs; coverage = how many of those the arm covered with real evidence”

If a coarser arm row truly subsumes a granular peer row, the **reconciler** must tag it `SHARED` (or fold). Leaving it `UNIQUE-TO-peer` means the other arm did **not** cover it — count as a miss for recall.

## Recall (0–4)

| Score | Meaning |
|---:|---|
| 4 | ≥90% of **all** reconciled IDs covered with real evidence |
| 3 | 75–89% |
| 2 | 50–74% |
| 1 | 25–49% |
| 0 | <25% or mostly wrong |

Publish: `covered / total_reconciled` (integers) before the band score.

## Precision (0–3)

| Score | Meaning |
|---:|---|
| 3 | ≤5% junk / unevidenced IDs |
| 2 | ≤15% junk |
| 1 | ≤30% junk |
| 0 | >30% junk or fabricated paths |

**Junk list:**  
**Total 1a:** __ / 7 (or scaled)
