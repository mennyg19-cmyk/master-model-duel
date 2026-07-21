# P12 Quality Review — arm-03

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Source:** `shared/phases/PHASE-P12-EXPECTED.md` vs `arms/arm-03/workspace/`
**Smoke result:** 4/5 PASS (S3 FAIL) — per `arms/arm-03/results/PHASE-P12-SMOKE.json`
**Scope:** findings only. No fixes applied.

## Summary counts

- Total findings: **11**
- Blockers (gate-failing / data-integrity): **2**
- High (drift / correctness risk): **3**
- Medium (duplication / dead code): **4**
- Low (polish / observability): **2**

By category: dead code 2 · duplicated logic 2 · duplicated routes 2 · schema 1 · test isolation 1 · correctness 2 · observability 1.

## Findings

### B1 — S3 legacy-import dry-run produces 0 valid rows (BLOCKER, test isolation)

`PHASE-P12-EXPECTED.md` S3 requires "Dry-run messy fixture; mapping + atomic commit; resume after interruption; dedupe rules applied." Smoke evidence (`PHASE-P12-SMOKE.json` S3):

```json
{ "drySummary": { "total": 5, "valid": 0, "duplicate": 4, "invalid": 1 },
  "dryCommitted": 0, "interrupted": false, "resumed": "COMMITTED" }
```

Zero valid rows means the dry-run commit path is never exercised against a real row; "mapping + atomic commit" is unverified. Root cause is test-state pollution: `commitOrderRow` marks imported orders as `OrderStatus.PAID` with `draftRef: D-<year>-imp<orderNumber>` (`src/lib/ops/import.ts:484`), and `classifyOrderRows` flags any order already in the DB as `DUPLICATE` ("order exists", `src/lib/ops/import.ts:257`). Re-running the smoke against the same season reclassifies every fixture row as duplicate before the dry-run can commit anything.

`wipeTestFixtures` (`src/lib/ops/test-ops.ts:60-77`) only deletes orders whose `checkoutSnapshot.scaleFixture` is `p6`/`p12` or whose `draftRef` starts with `p12-dress-`/`p12-wipe-`. Imported orders' `D-<year>-imp…` draftRef matches none of those patterns, so legacy imports survive the wipe and poison every subsequent S3 run. The S3 fixture needs either a wipe hook that clears `draftRef` starting `D-*-imp*` or a per-run unique orderNumber prefix.

### B2 — Two parallel Stripe reconcile implementations with divergent fingerprints (BLOCKER, correctness)

Two matchers coexist for the same R-093 concern:

- `src/lib/ops/reconcile.ts` — `runPaymentReconcile`, fingerprint `orphan:${intent.stripePaymentIntentId}` (line 94). Used by `api/admin/reconcile` (manual button) and `api/cron/payment-reconcile`.
- `src/lib/payments/reconcile.ts` — `runPaymentReconciliation`, fingerprint `sha256("orphan_pi:" + id).slice(0,40)` (lines 15-19). Used by `api/cron/stripe-reconcile`.

Both write `PaymentReconcileAdjustment` rows but under non-overlapping fingerprint schemes, so the unique constraint does not protect across implementations. If both crons are registered (S5 evidence shows 6 crons returning 401, implying a populated cron table), the same orphaned PaymentIntent produces two adjustment rows — one per matcher — double-counting orphans and breaking the "rerun without duplicate adjustments" guarantee that S2 claims to verify. The two implementations also disagree on orphan detection: `lib/payments` counts `requires_capture`/`processing` as success-like (`lib/ops/reconcile.ts:62-64`), `lib/ops` only matches `succeeded` plus a posted-total comparison (`lib/ops/reconcile.ts:67-85`). Pick one; delete the other.

### H1 — Wipe fingerprint filter does not match either reconcile scheme (HIGH, correctness)

`src/lib/ops/test-ops.ts:79-81`:

```ts
await db.paymentReconcileAdjustment.deleteMany({
  where: { fingerprint: { startsWith: "orphan:pi_orphan_p12" } },
});
```

`lib/ops/reconcile` emits `orphan:<pi>` (e.g. `orphan:pi_orphan_p12_abc`) — this filter would match it. `lib/payments/reconcile` emits a 40-char hex hash — this filter cannot match it. So wipe only cleans one of the two implementations' adjustments. Combined with B2, the reconcile audit trail is not reliably reset between smoke runs, which can mask double-counting in S2's "recon2: created=0, skipped=2" assertion.

### H2 — `lib/reports/performance.ts` and `lib/reports/margin.ts` are dead code (HIGH, dead code)

Grep across `src/` shows `buildPerformanceReport`, `buildMarginReport`, and `stageCountsBySeason` are referenced only inside their own files. The live report path is `src/lib/ops/reports.ts` (`performanceReport` / `marginReport`), called by `api/admin/reports/route.ts`. The `lib/reports/` directory duplicates logic, drifts on the revenue formula (`lib/reports/performance.ts:67` falls back to `expectedTotalCents` unconditionally; `lib/ops/reports.ts:84` only falls back when `paid`), and ships an unused `stageCountsBySeason` helper. Delete `lib/reports/`.

### H3 — Two address-cleanup endpoints (HIGH, duplicated routes)

Both expose `runAddressCleanup`:

- `src/app/api/admin/addresses/cleanup/route.ts` — `POST` discriminated union: `cleanup` + `merge`.
- `src/app/api/admin/address-cleanup/route.ts` — `POST` `cleanup` only (no merge).

They share `listAddressReviewQueue` for `GET`. Two URLs for the same concern invites client drift and audit ambiguity (the `EXPORT_RUN`/`ADDRESS_REVIEW_FLAGGED` audit rows won't reveal which endpoint was hit). Keep `addresses/cleanup` (it has merge); remove `address-cleanup`.

### M1 — Two cron routes for payment reconcile (MEDIUM, duplicated routes)

`api/cron/stripe-reconcile` and `api/cron/payment-reconcile` both wrap a reconcile matcher with identical `beginCronRun`/`finishCronRun` scaffolding. They differ only in which matcher (B2) they call. One cron should exist for R-093. Two registered crons double the scheduler surface and let the divergent fingerprints silently produce different audit rows.

### M2 — Reports API returns redundant envelope (MEDIUM, polish)

`src/app/api/admin/reports/route.ts:29-35` returns `seasons`, `totals`, and `report: { seasons, totals }` — the same data twice. `ReportsClient` reads `pj.seasons` and ignores `report`, so the duplicate is dead payload. Drop the `report` key (or drop the flat keys and have the client read `report`).

### M3 — `performanceReport` excludes `DISCARDED` inconsistently (MEDIUM, correctness)

`src/lib/ops/reports.ts:50` filters `status: { not: OrderStatus.DRAFT }` — so `DISCARDED` orders are counted in `orderCount`/`byMethod`. `src/lib/reports/performance.ts:29` (the dead-code twin) and the export center (`src/lib/exports/center.ts:79`) both exclude `DRAFT` and `DISCARDED`. The margin report and the export agree on the exclusion set; the live performance report does not. Either discarded orders should count everywhere or nowhere — pick one and centralize.

### M4 — `reseedTestSeason` is a count, not a reseed (MEDIUM, observability)

`src/lib/ops/test-ops.ts:99-139` is named `reseedTestSeason` but only counts orders/packages on the open season and writes an audit row. It creates no fixtures. S5 smoke reports `reseed.orderCount: 164, packageCount: 136` — those are pre-existing counts, not freshly seeded rows. The EXPECTED S5 line "wipe+reseed restores clean test season" is only half-verified (wipe deletes; reseed does not plant). Rename to `countOpenSeason` or actually reseed.

### L1 — `commitImport` re-fetches customer after commit (LOW, polish)

`src/lib/ops/import.ts:625-644` re-queries `db.customer.findFirst` by email right after `commitOrderRow` already resolved the customer inside the transaction. The extra round-trip can race and is unnecessary — `commitOrderRow` could return the `customerId` it used.

### L2 — `imports-client` default CSV is customers, not the messy orders fixture (LOW, observability)

`src/components/admin/imports-client.tsx:31-34` defaults the textarea to a customers CSV. The P12 S3 fixture is the orders one (`MESSY_ORDERS`, line 21). A reviewer opening the page sees the wrong fixture; the smoke harness must switch the dropdown to ORDERS to exercise S3. Default to `ORDERS` for P12, or auto-select the kind matching the last failed smoke.

## Phase-EXPECTED coverage

| EXPECTED item | Status | Evidence |
|---|---|---|
| 1. Multi-season perf + margin reconciliation view | DONE | `lib/ops/reports.ts`, `api/admin/reports`, `reports-client.tsx`; S1 PASS |
| 2. CSV export center + audit; Stripe reconcile (button + cron + matcher) | DONE w/ defect | `lib/exports/center.ts`, `api/admin/exports`, reconcile clients; S2 PASS, but see B2/H1 |
| 3. Legacy import: dry-run, normalization, staged atomic commits, address cleanup (UR-014) | PARTIAL | Pipeline present (`lib/ops/import.ts`, `address-cleanup.ts`); S3 FAIL — dry-run commits 0 rows (B1) |
| 4. Scale dress rehearsal 1k/5k; test console + banner; crons secret-auth | DONE w/ concern | test-ops + 6 crons 401 w/o secret (S5); `scalePackages: 0` and `nightlyMs: 88` suggest the 1k/5k load was not actually generated — only the print batch over existing packages was timed |
| 5. E2E dress rehearsal: web order → pay → package → print → ship/deliver/pickup → reroute → reports reconcile | DONE | S5 PASS; printBatch.artifacts=104, pickup=stamped, labels=13 |

## Files inspected

- `prisma/migrations/20260722060000_p12_reports_exports/migration.sql`
- `src/lib/reports/performance.ts`, `src/lib/reports/margin.ts` (dead)
- `src/lib/ops/reports.ts`, `src/lib/ops/reconcile.ts`, `src/lib/ops/import.ts`, `src/lib/ops/address-cleanup.ts`, `src/lib/ops/test-ops.ts`
- `src/lib/payments/reconcile.ts`
- `src/lib/exports/center.ts`
- `src/app/api/admin/{reports,exports,reconcile,imports,test-ops}/route.ts`
- `src/app/api/admin/addresses/cleanup/route.ts`, `src/app/api/admin/address-cleanup/route.ts`
- `src/app/api/admin/imports/prior-year-stub/route.ts`
- `src/app/api/cron/{stripe-reconcile,payment-reconcile}/route.ts`, `src/lib/cron/auth.ts`
- `src/components/admin/{reports,exports,reconcile,imports,test-ops}-client.tsx`
- `src/app/(admin)/admin/{reports,imports}/page.tsx`
- `results/PHASE-P12-SMOKE.{md,json}`, `results/PHASE-P12-STATUS.md`
