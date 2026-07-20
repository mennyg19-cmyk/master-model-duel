# Inventory grade — Test 1a — arm-02 (blind) — RE-GRADE

**Rubric:** `kit/rubrics/inventory-1a.md` (grill on, max 7)
**Arm inventory:** `arms/arm-02/results/CODEBASE-INVENTORY.md` (165 features)
**Reconciled baseline:** `shared/RECONCILED-INVENTORY.md` — ALL 192 rows (R-001..R-192)
**Source root:** `.scratch/sources/tomche-shabbos-website`
**Correction:** Prior grade used denominator 188 (excluded 4 UNIQUE-TO-arm-01). Corrected denominator = 192 for BOTH arms; UNIQUE tags are attribution only.

## Scores

| Dimension | Score | Band |
|---|---:|---|
| Recall (0-4) | 4 | ≥90% covered |
| Precision (0-3) | 3 | ≤5% junk |
| **Total** | **7 / 7** | grill on |

## Recall: 4 / 4 — covered 188 / 192 (97.9%)

Denominator = all 192 reconciled IDs. arm-02 covers 188; 4 genuinely missed (see Missed IDs).

- **136 SHARED rows** — every one traces to an arm-02 row, either as kept primary ID or explicitly folded into a coarser arm-02 row. Folds are documented per-row in the reconciled Notes column (e.g. R-008→F-001, R-031→F-013, R-121→F-021, R-126→F-043, R-128→F-054/SEC-026).
- **52 UNIQUE-TO-arm-02 rows** — map 1:1 to arm-02 IDs (R-010, R-014, R-025, R-036, R-044..R-047, R-054, R-071, R-081, R-087, R-104..R-106, R-117, R-118, R-134..R-136, R-144..R-165, R-170, R-171, R-184..R-185, R-187..R-192).
- **4 UNIQUE-TO-arm-01 rows** — re-evaluated under corrected rubric. arm-02 cites the same evidence file for R-015/R-016/R-017 (packages-grid.tsx under F-003) but its row description ("grid + loading skeleton") does NOT surface the category-filter, price-sort, or sold-out behaviors; the behavior half is uncovered. R-114's profile-update half is covered by F-032 (cites account/profile/route.ts) but the Clerk→Customer identity-linking half (customer.ts/ensureCustomer.ts) is not cited anywhere in arm-02. All 4 count as missed.

Coverage 188/192 = 97.9% → score 4 (≥90% band).

### Missed IDs (4)

| ID | Name | Why missed |
|---|---|---|
| R-015 | Package category filters | arm-02 F-003 cites `packages-grid.tsx` but describes only "grid + loading skeleton"; the category-filter behavior (lines 27-74) is not surfaced. |
| R-016 | Package price sorting | Same file cited under F-003; price-sort behavior (lines 28, 38-42, 76-84) not described by arm-02. |
| R-017 | Catalog sold-out handling | Same file cited under F-003; sold-out badge/SOLD OUT rendering (lines 147-150) not described by arm-02. |
| R-114 | Customer identity linking + owned profile updates | Profile-update half covered by F-032 (cites `account/profile/route.ts`); Clerk→Customer linking half (`customer.ts`, `ensureCustomer.ts`) not cited anywhere in arm-02. |

## Precision: 3 / 3

Spot-checked ~30 evidence paths against the source tree (order-builder components, inventory server, integrations, auth server, cron routes, scripts, tokens.css, error.tsx, hero.png, DATA-MIGRATION-INVENTORY.md, vercel.json, packages-grid.tsx, customer.ts, ensureCustomer.ts). All resolve to real files. No fabricated paths, no invented features. The 2 conflicts (SEC-004 role count; INT-029 Stripe client packages) are honestly tagged CONFLICT with both evidence paths. Merge method is transparent: 288 partial rows → 165 merged, with absorbed IDs listed per row and a counts table; no new IDs invented.

### Junk list

- **D-055** — cites `scripts/migrate-from-old.ts` which does NOT exist in tree. arm-02 self-flagged this as documentation-only evidence (primary evidence `DATA-MIGRATION-INVENTORY.md` does exist). Retained as honest caveat, not junk. No other hallucinations.

Junk rate ≈ 0.6% (1 caveat out of 165, and it is self-flagged doc-only) → score 3 (≤5% band).

## Rationale

1. Corrected denominator = 192; arm-02 covers 188 → 97.9%, recall 4 (≥90% band).
2. The 4 missed rows are the arm-01-unique storefront-grid sub-behaviors (R-015/R-016/R-017 — file cited but behaviors not described) and the Clerk→Customer linking half of R-114 (customer.ts/ensureCustomer.ts never cited).
3. All 136 SHARED + 52 own-unique rows map cleanly to arm-02 IDs; folds are explicit and traceable.
4. Evidence verifies against source: 30/30 spot-checked files exist; only missing path (migrate-from-old.ts) is self-flagged doc-only.
5. No invented features, no fabricated paths, no inflated counts (288→165 dedup reproducible from notes).
6. Two genuine conflicts surfaced and tagged (role-count, Stripe client pkgs) — adds to precision.
7. Reviewer saw arm id only; no model names.
