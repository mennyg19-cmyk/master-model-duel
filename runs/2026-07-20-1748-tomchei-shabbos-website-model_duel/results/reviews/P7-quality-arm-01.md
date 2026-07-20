# P7 Quality Review — arm-01

Reviewer: Quality specialist (blind to model name)
Phase: P7 — Package engine live (grouping UI, statuses, print batches, cards)
Reference: `shared/phases/PHASE-P7-EXPECTED.md`, `kit/prompts/reviewer/review-quality.md`
Scope: `arms/arm-01/workspace/` P7 surface — `src/domain/package-operations.ts`, `src/domain/package-stage.ts`, `src/domain/package-grouping.ts`, `src/domain/print-batches.ts`, `src/app/(admin)/admin/fulfillment/page.tsx`, `src/components/fulfillment-board.tsx`, the three P7 API routes, the P7 migration, and `.scratch/PHASE-P7-SMOKE.md`.
Findings only — no fixes.

## Summary

Smoke (S1–S3) PASS and all six EXPECTED P7 invariants are observable in code. The defects below are correctness/robustness issues not exercised by the ASCII-only smoke fixtures or by the single-user happy path.

## Findings

### H1 — `renderArtifactPdf` strips all non-ASCII, blanking non-Latin names
`escapePdfText` does `normalize("NFKD")` then `replace(/[^\x20-\x7E]/g, "")` (`src/domain/print-batches.ts:234-239`). For a Purim site, Hebrew/non-Latin recipient names, greetings, or product names are silently deleted from slips, labels, greeting cards, and packing slips — the printed label shows a blank recipient. Smoke fixtures use ASCII-only names (`Recipient A/B`, `A freilichen Purim`), so S2/S3 cannot catch this. Severity: **High** (correctness; domain-specific).

### H2 — `materializeMissingFinalizedOrders` runs as a side effect of every fulfillment page load
`fulfillment/page.tsx:10` calls `materializeMissingFinalizedOrders(db)` on every GET of `/admin/fulfillment`, executing up to 200 sequential write transactions (`package-operations.ts:94-118`) per page render. A read-only staff dashboard triggering bulk package creation on every refresh is a performance and surprise-side-effect defect; any staff member opening the board triggers write transactions and audit rows. Severity: **High** (correctness/operations).

### M1 — `regroupPackages` has no row lock and no optimistic version check
`splitPackage` takes a `SELECT ... FOR UPDATE` lock (`package-operations.ts:134-136`), but `regroupPackages` (`:218-223`) does a plain `findMany` with no lock and no `expectedVersion` guard before mutating both rows. Two concurrent regroups on overlapping packages can double-move lines or double-deactivate the source; the `version: { increment: 1 }` writes are not checked against an expected value. Severity: **Medium** (concurrency).

### M2 — `regroupPackages` does not recompute the target `groupingKey`
Staff can regroup packages across different P2 grouping keys (different recipient/address/method/greeting). The target package retains its original `groupingKey` (`:256-263`) while its `lines` now describe a different group, so `Package.groupingKey` no longer represents contents. This violates the P2 grouping-engine invariant and can corrupt re-materialization / uniqueness assumptions. Severity: **Medium** (data integrity).

### M3 — `renderArtifactPdf` silently truncates to 48 lines
`print-batches.ts:263` slices the rendered lines to `.slice(0, 48)` with no overflow/continued indicator. Orders with many packages or products lose trailing items in the printed PDF with no signal to staff. Severity: **Medium** (correctness for large inputs).

### M4 — `bulkAdvancePackageStage` silently drops requests beyond 100
`package-operations.ts:291` does `requests.slice(0, 100)` before processing. The route schema already caps at 100, so the slice is dead code today, but it silently discards overflow if the cap ever changes — a masking hazard. Each request also opens its own `$transaction` (100 packages = 100 round-trips), no bulk path. Severity: **Medium** (robustness/performance).

### L1 — `loadPrintablePackages` uses string literals for stages
`print-batches.ts:19` uses `stage: { notIn: ["SENT", "PICKED_UP"] }` instead of `PackageStage.SENT`/`PackageStage.PICKED_UP`. Drift hazard if the enum changes. Severity: **Low**.

### L2 — `fulfillment-board.tsx` full-page reloads after every action
`fulfillment-board.tsx:49` calls `window.location.reload()` on every successful POST, losing scroll position, selection, and form state. Severity: **Low** (UX regression).

### L3 — No pagination on board / reprint-order list
`fulfillment/page.tsx:14` caps packages at `take: 200` and the reprint-order list at `orders.slice(0, 12)` (`fulfillment-board.tsx:287`) with no pagination. Large operations hide packages and make some orders unreachable for reprint via UI. Severity: **Low**.

### L4 — Regroup/split audit metadata is thin
`package.regrouped.source/target` metadata records only the other package ID (`package-operations.ts:264-279`); split metadata records quantity but not the resulting line states. The audit trail cannot reconstruct exact line movements. Severity: **Low** (audit completeness).

### L5 — Bulk-status UI offers invalid transitions
`fulfillment-board.tsx:102-106` exposes SENT/PICKED_UP in the bulk-stage dropdown for all selected packages including `NEW` ones, which `advancePackageStage` will reject (`package-stage.ts:6-11`). Predictable partial failures instead of pre-filtering valid target stages per current stage. Severity: **Low** (UX/correctness).

### L6 — `PrintArtifact.sourceArtifactId` column is dead schema
The migration (`migration.sql:23`) and schema (`schema.prisma:526`) define `sourceArtifactId` but no P7 code ever reads or writes it. Unused field. Severity: **Low**.

## Severity counts

- **High:** 2
- **Medium:** 4
- **Low:** 6
- **Total:** 12

## EXPECTED coverage (no findings — met)

- #1 Finalized → packages via P2 grouping: `materializeOrderPackages` + `groupLinesIntoPackages` ✓
- #2 Split / regroup / per-package status advance: `splitPackage`, `regroupPackages`, `advancePackageStage` ✓
- #3 Channel dashboard with bulk actions + savings: `fulfillment/page.tsx:39-53` ✓
- #4 Nightly batch, separate PDF per filing group, reprint group/order ✓
- #5 Greeting-card PDFs per group + per-order packing slip: `createArtifacts` ✓
- #6 Printing never auto-advances shipped: print path mutates no `Package.stage` ✓
