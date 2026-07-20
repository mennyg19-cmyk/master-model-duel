# Inventory grade — Test 1a — arm-01 (blind) — CORRECTED

**Rubric:** `kit/rubrics/inventory-1a.md` (grill on, max 7)  
**Correction:** 2026-07-20 — prior grade illegally shrunk denominator to SHARED + UNIQUE-TO-arm-01 (140). Protocol requires **all 192** reconciled IDs.

**Arm inventory:** `arms/arm-01/results/CODEBASE-INVENTORY.md` (173 features)  
**Reconciled:** `shared/RECONCILED-INVENTORY.md` (192 features: 136 SHARED, 4 UNIQUE-TO-arm-01, 52 UNIQUE-TO-arm-02)  
**Source verified against:** `.scratch/sources/tomche-shabbos-website`

## Coverage integers (mandatory)

| Metric | Value |
|---|---:|
| `total_reconciled` | 192 |
| `covered` (per prior grade’s own claim of SHARED+own) | 140 |
| `missed` (UNIQUE-TO-arm-02 rows left UNIQUE by reconciler) | 52 |
| `coverage_pct` | 140/192 ≈ **72.9%** |

## Scores

| Dimension | Score | Max | Notes |
|---|---:|---:|---|
| Recall | **2** | 4 | 50–74% band |
| Precision | **3** | 3 | unchanged — no junk found |
| **Total** | **5** | **7** | was incorrectly 7/7 |

## Recall rationale (2/4)

arm-01 covers the 136 SHARED + 4 UNIQUE-TO-arm-01 rows with mapped evidence. The reconciler left **52** rows as UNIQUE-TO-arm-02 (schema detail, design-system, integrations, order machine, etc.), which means those were **not** folded as covered by arm-01. Under the full-denominator rule those are misses.

Wrong prior rationale: “140/140 expected; 52 UNIQUE-TO-arm-02 appropriately absent.”  
Correct: expected = 192; absent peer-unique rows count against recall.

## Precision rationale (3/3)

Unchanged from prior grade: no fabricated/orphaned IDs; spot-checks against source passed; junk list empty.

## Junk list

None.

## Total

**5 / 7**
