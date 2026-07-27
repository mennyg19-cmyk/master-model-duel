# P12 Quality review — arm-04 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Reviewer:** Quality specialist
**Mode:** Blind (model name unknown). Findings only, no fixes.
**Scope:** `arms/arm-04/workspace/` against `shared/phases/PHASE-P12-EXPECTED.md`.

## What was read

- `prisma/schema/reporting.prisma`, `prisma/schema/migration.prisma`, `prisma/migrations/20260727060000_p12_reporting_migration_launch/migration.sql`
- `src/lib/reports/{season-performance,margin-report,export-service,datasets,csv-write}.ts`
- `src/lib/payments/reconciliation.ts`
- `src/lib/migration/{legacy-import,legacy-rows,address-cleanup}.ts`
- `src/lib/imports/prior-year-orders.ts`
- `src/lib/cron/{authorize,job-run}.ts`, `src/app/api/cron/payment-reconciliation/route.ts`
- `src/app/api/admin/exports/[slug]/route.ts`
- `src/app/(admin)/admin/reports/{page,reports-tabs,season-picker,[seasonId]/page,margin/page,exports/page,payments/page,payments/actions}.tsx`
- `src/app/(admin)/admin/migration/{page,actions,[runId]/page,cleanup/page}.tsx`
- `src/app/(admin)/admin/settings/testing/{page,actions}.tsx`, `src/lib/testing/{test-mode,console}.ts`
- `src/lib/help/tours.ts`, `vercel.json`
- `tests/reports.test.ts`, `tests/migration.test.ts`, `scripts/smoke-p12.ts`, `scripts/smoke-p12-fixtures.ts`

## Verdict vs EXPECTED

| EXPECTED | Status | Notes |
|---|---|---|
| 1. Multi-season performance reports + shipping-margin reconciliation | PASS (with caveats) | Season table, drill-down, and margin view all present; margin counts purchased parcels only and separates unpriced. See F3, F4. |
| 2. CSV export center + audit history; Stripe reconciliation (run button + cron + matcher) | PASS (with caveats) | Five datasets, streamed, dual-recorded (ExportLog + audit). Recon cron + manual button + matcher behind bearer secret. See F2, F5. |
| 3. Legacy import: dry-run, normalization, staged atomic commits, address-book cleanup (UR-014) | PASS | Dry-run writes nothing; chunked atomic commits with guarded claim; NEEDS_MAPPING gate; cleanup queue with merge/keep that sticks. See F6. |
| 4. Scale dress rehearsal at 1k/5k; test console + banner; crons registered with secret auth | PASS (with caveats) | `vercel.json` registers all six crons; test-mode banner + locked console; scale fixtures scripted. See F1, F7. |
| 5. End-to-end dress rehearsal: web order → pay → package → print → ship/deliver/pickup → reroute → reports reconcile | PASS | `dressRehearsal` in `smoke-p12.ts` walks the full chain over HTTP with no DB writes; rehearsal order lands on year-end export. |

Smoke script `scripts/smoke-p12.ts` maps S1–S5 (plus S5d2, S5d3) to concrete checks and recomputes every figure from the database. However, see F1 for the missing evidence files.

## Findings

### F1 — Missing `.scratch/PHASE-P12-STATUS.md` and `.scratch/PHASE-P12-SMOKE.md` [MEDIUM]

The `arms/arm-04/workspace/.scratch/` folder does not exist. EXPECTED states: "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P12-SMOKE.md`". The smoke script is thorough (S1a–S5g, ten-staff concurrency, help-centre tour counts, wipe/reseed), but no recorded run output or per-phase status file was produced. This is a process/evidence gap, not a code defect, but it blocks the phase gate per `workflow.mdc` expectation-file discipline. Same shape as the P11 finding for this arm.

### F2 — `writeFindings` findUnique-then-create is not atomic; concurrent sweeps can P2002 [MEDIUM]

`src/lib/payments/reconciliation.ts:178-202` does `findUnique` on the fingerprint, then `create` if absent. Two concurrent sweeps (manual button + nightly cron, or two manual presses) can both find no existing flag and both `create`; the unique index on `fingerprint` makes the second throw `P2002`, which is not caught here. `runCronJobBody` catches it, records the run as FAILED, and rethrows → 500 to the caller. The flag itself is written once (by the winner), so correctness holds, but the loser's run row is marked FAILED for a race that is not really a failure, and the manual button would surface a 500 flash rather than "checked N, 0 new". EXPECTED S2 ("rerun without duplicate adjustments") is satisfied for sequential reruns (S2d proves it); the gap is only the concurrent case, which the smoke does not exercise.

### F3 — `MISSING_INTENT` finding sets `expectedCents: 0` while a payment is recorded [LOW]

`reconciliation.ts:155-164`: for a `MISSING_INTENT` (a `Payment` row quoting a Stripe reference with no intent on file), `amountCents` is the payment's amount and `expectedCents` is `0`. The reconciliation page (`payments/page.tsx:80-81`) renders "Gateway" = `amountCents` and "Recorded" = `expectedCents`. So a payment that *is* recorded shows "Recorded = $0.00", which reads as "the ledger has nothing" when the ledger actually has the payment — the disagreement is that there is no checkout *intent*, not that there is no recorded money. The note text is correct ("quotes a gateway reference with no checkout attempt on file"), but the column pairing is semantically backwards for this kind. `ORPHANED_INTENT` and `AMOUNT_MISMATCH` pair the columns correctly.

### F4 — `readMarginReport(seasonId, 0)` relies on a non-obvious `limit=0` contract [LOW]

`datasets.ts:178` calls `readMarginReport(seasonId, 0)` for the year-metrics export. In `margin-report.ts:107`, `rows: rows.slice(0, limit)` with `limit=0` returns `[]`, while `summary` is computed from the full `rows` array (line 104). So `limit=0` means "no table rows, full summary" — a hidden contract that the year-metrics export depends on. A future caller passing `0` expecting "no limit" would get an empty table and a correct summary, which is a confusing pair. The summary is correct for the export; the issue is the implicit contract, not the numbers.

### F5 — `finishRun` uses `season?.id`; a deleted season silently yields `importedTotalCents: 0` [LOW]

`legacy-import.ts:332-349`: `finishRun` looks up the season by year, then aggregates orders `where: { seasonId: season?.id, importedOrderReference: { in: ... } }`. If the season was deleted between the commit starting and finishing, `season?.id` is `undefined`, the aggregate matches nothing, and `importedTotalCents` is written as `0`. The run page (`[runId]/page.tsx:79-84`) then shows a non-zero `sourceTotalCents` against `importedTotalCents: 0` and flags "this needs explaining before the season opens" — a false discrepancy. The migration cannot run without a season (`priorYearContext` refuses), but a mid-commit season deletion is not guarded. Edge case, but silent.

### F6 — `itemSales` export `count` loads all groups into memory, defeating the paged contract [LOW]

`datasets.ts:206-208`: `itemSales.count` calls `itemSalesRows(seasonId)` which runs `db.orderLine.groupBy` and loads every product group into memory just to return `.length`. `page` then calls `itemSalesRows` again. The dataset is small by construction (the docblock says "tens of rows"), so this is not a scale problem in practice, but it is the one export whose `count` and `page` both materialize the full result set — the paging interface is presentational rather than functional for this dataset. `deliveries`, `yearEnd`, and `lapsedCustomers` page properly at the database level.

### F7 — `wipeTransactionalData` leaves `PaymentReconciliationRun`, `ExportLog`, `CronRunLog`, and `AuditEvent` behind [LOW]

`console.ts:116-134` deletes orders, customers, routes, print batches, notification logs, legacy import runs, address cleanup flags, and payment reconciliation *flags* — but not payment reconciliation *runs*, export logs, cron run logs, or audit events. The docblock only claims "every order, household, route, print batch and message", so this is by design (audit-style rows survive). However, surviving `PaymentReconciliationRun` rows reference `PaymentReconciliationFlag` rows that no longer exist after a wipe, so the reconciliation page's "last run" header would show a run whose flags were cleared. The smoke S5f does not assert on recon run counts after wipe. Minor consistency gap.

### F8 — `readSeasonPerformance` issues three extra queries per season (N+1) [INFO]

`season-performance.ts:55-73`: for each season, it runs `customer.count`, `package.count`, and `paymentRefund.aggregate` separately. Season count is bounded (a dozen or so), so this is not a scale problem, but it is N+1 in shape. The grouped order aggregate is the right pattern; the per-season distinct-customer and package counts cannot come out of it, which the comment acknowledges.

### F9 — `METRIC_ROW_COUNT = 13` is hardcoded [INFO]

`datasets.ts:198` hardcodes the year-metrics row count to 13, while `page` (line 180-194) constructs 13 rows. If a metric is added or removed in `page` without updating the constant, `count` drifts silently and the streaming loop would either under- or over-report. The two are adjacent in the same file, which makes the drift unlikely, but the constant is a manual invariant.

## Severity counts

- Medium: 2 (F1, F2)
- Low: 5 (F3, F4, F5, F6, F7)
- Info: 2 (F8, F9)
- Total: 9

## Notes on what is solid

- Reconciliation idempotency via unique `fingerprint` + `firstSeenAt`/`lastSeenAt` stamps is the right shape; sequential reruns provably produce no duplicate flags (S2d). Closing fixed findings as `RESOLVED` rather than deleting preserves the audit trail.
- Legacy import chunking groups by order reference before slicing, so a chunk is always a whole number of orders; the guarded `committedChunkCount` claim prevents two concurrent commits from double-writing a chunk; `MAX_CHUNKS_PER_COMMIT` bounds request time and the resume path reads `committedChunkCount` to continue. The reconciliation at `finishRun` recomputes from the orders themselves rather than accumulating counters, so a double-written chunk would surface as a difference.
- CSV writer escapes formula starters (`= + @ \t \r` and `-` non-numbers) and quotes commas/quotes/newlines; unit tests cover the round trip and the `=SUM(1,2)` donor case. Streaming export pages at 500 rows rather than building the whole string in memory.
- Cron auth hashes both sides before `timingSafeEqual`; empty secret refuses all; GET and POST both gated. `vercel.json` registers all six crons with schedules.
- Test mode is a setting (not an env flag), gated in the service layer (`requireTestMode`) not just the screen, and the destructive buttons are disabled both client- and server-side. Banner asserted on storefront and admin.
- Help tours are permission-gated (`toursFor`), so staff without `migration.manage`/`settings.manage` are not shown the migration or rehearsal tours (S5d3).
- Scale dress rehearsal runs the full E2E chain over HTTP with no hand-written DB rows, then runs `npm run fixtures:scale` for 1k/5k and re-checks page timings under 5s and the nightly batch under 120s.
