# P12 fix pass — arm-04

One pass against `results/AGGREGATE-REVIEW-P12.md` (0 blockers, 6 majors, 18 minors). All 6 majors fixed,
10 of the 12 priority minors fixed, 2 deferred with reasons, the 6 info items left alone as the review
intended. No new features; nothing outside the aggregate list.

## Fixed — majors

| ID | What changed |
|---|---|
| **SEC-1** — export audit skipped on mid-stream error | `src/lib/reports/export-service.ts` now writes the `ExportLog` row and the `report.exported` audit event **before** the response starts (`beginExport`), and amends the row with the rows and bytes that actually left when the stream closes (`finishExport`). A download the browser abandoned therefore leaves a row rather than nothing. New nullable `ExportLog.completedAt` (migration `20260727100000_p12_review_fixes`) is what separates "finished" from "stopped part way", and the export centre prints exactly that instead of a size. |
| **F1** — missing `.scratch` evidence files | `.scratch/PHASE-P12-SMOKE.md` (written by `npm run smoke:p12` itself) and `.scratch/PHASE-P12-STATUS.md` are both present and were regenerated from a real run after these fixes: **28/28 checks pass**. |
| **F2** — `writeFindings` not atomic | `src/lib/payments/reconciliation.ts` uses one `upsert` per finding keyed on the unique `fingerprint`, so two sweeps starting together can no longer both insert and fail the second on P2002. The count of new findings is read once, before the writes; in that race a finding can be reported as new by both sweeps, which is a generous number rather than a failed run. |
| **Rules M1 / clean-code m2** — duplicated `addressProblem`, drifted ZIP rule | New `src/lib/core/addresses.ts` owns `STATE_CODE`, `ZIP_CODE` and `addressProblem`. `legacy-rows.ts` and `address-cleanup.ts` both call it, and `delivery-area.normalizePostalCode` now uses the same `ZIP_CODE` — one ZIP rule in the app. **Business rule chosen and flagged:** ZIP+4 counts as a ZIP (the laxer of the two), because the forms already normalise `08701-1234` to `08701` and a decade of un-normalised legacy rows would otherwise be flagged as broken addresses that are in fact deliverable. Message and the test that pins it updated; a ZIP+4 assertion added to `tests/migration.test.ts`. |
| **Rules M2 / clean-code M2** — `legacy-import.ts` god file (603 lines) | Split by concern: `legacy-import.ts` (209) is the staging run, the questions and the discards; `legacy-verdicts.ts` (200) decides what each line is and assigns chunks; `legacy-commit.ts` (260) writes the history down. Callers updated (`migration/actions.ts`, `migration/[runId]/page.tsx`, `tests/migration.test.ts`); the `LEGACY_*` codes stay in `legacy-import.ts` and are imported one way, so there is no cycle. |
| **Clean-code M1** — third copy of the tab nav | New `src/components/ui/tab-nav.tsx`. `reports-tabs.tsx`, `settings-tabs.tsx` and `email-tabs.tsx` keep their own tab list, typed `active` and test id — that is per-hub configuration, and 13 call sites keep the type safety — but the markup exists once. |

## Fixed — priority minors

| ID | What changed |
|---|---|
| **SEC-2** | `mapLegacyRow` now refuses a customer id that is not one of the row's own staged candidates, so the candidate list is enforced in the service and not only in the `<select>`. |
| **SEC-3** | `mapLegacyRowAction` guards `lineNumber` with `Number.isInteger`, matching `seasonYear` in the same file. |
| **F3** | A `MISSING_INTENT` finding now carries the money on the recorded side (`expectedCents`) and zero on the gateway side, so the reconciliation table reads "Gateway $0.00 / Recorded $39.00" — the intent is what is missing, not the money. |
| **F4** | `MARGIN_SUMMARY_ONLY` replaces the bare `readMarginReport(seasonId, 0)`; the "no table rows, full summary" contract is named where it is used. |
| **F5** | `finishRun` fails loudly if the season was deleted mid-commit instead of silently reconciling the run at $0.00 against a file worth thousands. |
| **F6** | The `itemSales` count is a `groupBy` on the name alone rather than building every export row to take `.length`. |
| **F7** | The wipe now clears `PaymentReconciliationRun` with the flags, so no run header describes a queue that has been emptied. What survives on purpose — audit trail, export history, cron run log — is documented on the function: they are records of what people and schedules did to the deployment, not of the rehearsal data. |
| **Rules L1 / clean-code m1** | `src/components/ui/figure.tsx` is the one label-over-number card (`label value note? tone? testId?`), used by the season report, the margin view and the import run page. The unrelated fulfillment card is renamed `Kpi`; its `data-testid`s are unchanged. |
| **Rules L2** | `METRIC_ROW_COUNT` sits directly above the `yearMetrics` rows it counts. |
| **Clean-code m3** | `countedOrderFilter(seasonId)` is exported from `season-performance.ts` and used by `datasets.ts`, the drill-down and `margin-report.ts` — one spelling of "orders that count". |

## Deferred

| ID | Why |
|---|---|
| **SEC-4** — `dryRunLegacyImport` holds the whole upload | Chunking the dry run the way the commit path is chunked is a redesign of the staging write, not a fix. The bounds the review credited are still in place (`MAX_UPLOAD_BYTES` 8 MB, `CSV_MAX_ROWS`, `NAME_LOOKUP_BATCH` 100) and the caller is an authenticated manager, so this is a memory-shape concern rather than an exposure. Left for a phase that can re-run the scale rehearsal against it. |
| **Rules L3** — local `formatBytes` | The review itself says Rule of 2 means leaving it today. Left, and it is still the only caller. |

Info items 19–24 (SEC-5, F8, F9, Rules I1–I3) needed no code change, per the review.

## Verification

All run after the last edit, against web 3104 / db 4104.

| What | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **226/226 pass**, 0 fail (includes the updated ZIP message assertion and the new ZIP+4 case) |
| `npm run smoke:p12` | **28/28 checks pass**; rewrote `.scratch/PHASE-P12-SMOKE.md`. S2c (five datasets, `ExportLog` + audit event each), S2d (one flag across two sweeps), S3f (cleanup queue now quoting the shared ZIP message) and S5f (wipe + reseed) all still green with the changed code. |
| `npx prisma migrate deploy` | `20260727100000_p12_review_fixes` applied; `npm run db:guard` inside `npm run ci` is clean |
| SEC-1 in the running app (`.scratch/verify-export-audit.ts`) | A deliveries export whose body is cancelled without being read leaves `ExportLog` row `da61fa00…` with `completedAt` null and audit event `f0ea3aa3…` behind it — under the old code that request left no record at all. The full download that follows records 2 rows / 329 bytes with `completedAt` set, against a CSV with exactly 2 data rows. |

Not started: Test 5 / P13.
