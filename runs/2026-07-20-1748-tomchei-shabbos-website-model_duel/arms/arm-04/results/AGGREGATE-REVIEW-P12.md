# P12 Aggregate Review — arm-04 (blind)

**Phase:** P12 — Reporting, exports, Stripe reconciliation, legacy import, address-book cleanup, test console, cron registration, dress rehearsal
**Inputs:** `P12-security-arm-04.md`, `P12-quality-arm-04.md`, `P12-rules-arm-04.md`, `P12-clean-code-arm-04.md`
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings introduced. Mapping: security Medium → major; quality Medium → major; rules Medium → major; clean-code Major → major; Critical/High → blocker (none present). No model names — arm id only.

## Counts after dedupe

| Bucket | Count |
|---|---|
| Blockers | 0 |
| Majors | 6 |
| Minors (Low) | 12 |
| Minors (Info) | 6 |
| **Total** | **24** |

Raw inputs: 5 (security) + 9 (quality) + 8 (rules) + 5 (clean-code) = 27. Three duplicates removed: rules M1 ≡ clean-code m2 (addressProblem/STATE_CODE); rules M2 ≡ clean-code M2 (legacy-import.ts god file); rules L1 ≡ clean-code m1 (Figure duplication). The higher severity survives each merge.

## Prioritized fix list (builder-readable)

### Majors (fix before phase gate)

1. **SEC-1 — Export audit row skipped on mid-stream error** — `src/lib/reports/export-service.ts:39–62`. `recordExport` runs inside the stream `try`; a client disconnect after the first page leaves a partial PII download with no audit row. Record the egress event at request/first-byte time, amend row count on completion. (Security Medium → major.)
2. **F1 — Missing `.scratch/PHASE-P12-STATUS.md` and `.scratch/PHASE-P12-SMOKE.md`** — `.scratch/` folder absent. EXPECTED requires per-arm evidence files; smoke script is thorough but no recorded run output. Process/evidence gap blocking the phase gate. (Quality Medium → major.)
3. **F2 — `writeFindings` findUnique-then-create is not atomic; concurrent sweeps P2002** — `src/lib/payments/reconciliation.ts:178–202`. Manual + cron (or two manual presses) both find no flag, both `create`; unique index throws P2002, uncaught here → run marked FAILED / 500 flash. Use `upsert` or catch P2002 as a non-failure. (Quality Medium → major.)
4. **Rules M1 / clean-code m2 — `addressProblem` + `STATE_CODE` duplicated with drifted ZIP validation** — `src/lib/migration/legacy-rows.ts:177–188` vs `src/lib/migration/address-cleanup.ts:54–63, 257–263`. Parser rejects `^\d{5}$`, cleanup accepts `^\d{5}(-\d{4})?$`: same donor flagged on import, silently un-flagged on next cleanup scan. Extract one `addressProblem` + one `STATE_CODE`/`ZIP_CODE` to `lib/core/addresses.ts` (or `lib/migration/`). (Rules Medium / clean-code Minor → major.)
5. **Rules M2 / clean-code M2 — `legacy-import.ts` is a 603-line god file with mixed concerns** — `src/lib/migration/legacy-import.ts`. Trips both >500 lines and mixed-concerns triggers: verdict/matching (418–548), chunking/counting (551–580), commit/write (221–365, 367–416). Split into `legacy-verdicts.ts` + `legacy-commit.ts` (each <300 lines, single concern); dry-run orchestrator imports both. (Rules Medium / clean-code Major → major.)
6. **Clean-code M1 — `ReportTabs` is a third copy of the tab-nav pattern** — `src/app/(admin)/admin/reports/reports-tabs.tsx:13–36`, mirroring `settings-tabs.tsx` and `email-tabs.tsx` (~108 lines duplicated across three sites). Extract `<TabNav items active ariaLabel testId />` in `components/ui/`. (Clean-code Major → major.)

### Priority Minors (Low) — fix when touching the area

7. **SEC-2 — `mapLegacyRow` accepts any customer id, not just the row's candidates** — `src/lib/migration/legacy-import.ts:158–187`, `src/app/(admin)/admin/migration/actions.ts:66–78`. Candidate list enforced only in UI; a hand-crafted POST can map a row to any customer. Add the candidate-membership check in the service. (Security Low.)
8. **SEC-3 — `lineNumber` form input not integer-validated** — `src/app/(admin)/admin/migration/actions.ts:66–78`. `Number(...)` yields `NaN` for non-numeric input; no `Number.isInteger` guard (inconsistent with `seasonYear` in the same file) and no try/catch. Add the guard. (Security Low.)
9. **SEC-4 — `dryRunLegacyImport` loads full upload + all verdicts in one request** — `src/lib/migration/legacy-import.ts:79–137`, `src/app/(admin)/admin/migration/actions.ts:28–48`. Bounds exist (`MAX_UPLOAD_BYTES`, `CSV_MAX_ROWS`, `NAME_LOOKUP_BATCH`) and caller is authorised, so not external DoS — but a manager repeating max-size uploads holds the full payload and issues one large insert each time. Consider chunking the dry run like the commit path. (Security Low.)
10. **F3 — `MISSING_INTENT` finding sets `expectedCents: 0` while a payment is recorded** — `src/lib/payments/reconciliation.ts:155–164`, rendered at `src/app/(admin)/admin/reports/payments/page.tsx:80–81`. Column pairing reads "Recorded = $0.00" for a payment that *is* recorded; the disagreement is the missing *intent*, not missing money. Fix the column semantics for this finding kind. (Quality Low.)
11. **F4 — `readMarginReport(seasonId, 0)` relies on a non-obvious `limit=0` contract** — `src/lib/reports/datasets.ts:178`, `src/lib/reports/margin-report.ts:107`. `limit=0` means "no table rows, full summary" — a hidden contract the year-metrics export depends on. Make the contract explicit (separate function or named sentinel). (Quality Low.)
12. **F5 — `finishRun` uses `season?.id`; a deleted season silently yields `importedTotalCents: 0`** — `src/lib/migration/legacy-import.ts:332–349`. Mid-commit season deletion → aggregate matches nothing → false discrepancy on the run page. Guard or fail loudly. (Quality Low.)
13. **F6 — `itemSales` export `count` loads all groups into memory** — `src/lib/reports/datasets.ts:206–208`. `count` calls `itemSalesRows` (full `groupBy`) just to return `.length`; `page` calls it again. Small by construction, but the paging interface is presentational for this dataset. Use a `count()` aggregate or `_count`. (Quality Low.)
14. **F7 — `wipeTransactionalData` leaves `PaymentReconciliationRun`, `ExportLog`, `CronRunLog`, `AuditEvent` behind** — `src/lib/testing/console.ts:116–134`. Surviving recon runs reference cleared flags; "last run" header shows a run whose flags were wiped. Either cascade-delete recon runs or document the survivorship. (Quality Low.)
15. **Rules L1 / clean-code m1 — `Figure` component duplicated in three P12 pages with drifting props** — `src/app/(admin)/admin/reports/[seasonId]/page.tsx:149–156`, `margin/page.tsx:118–138`, `migration/[runId]/page.tsx:173–195`. Three prop shapes (`note?` vs `tone?` vs none) for the same "warning adornment" concept. Extract `<Figure label value note? tone? testId? />` (or colocate in `reports/Figure.tsx`); rename the unrelated fulfillment `Figure`. (Rules Low / clean-code Minor.)
16. **Rules L2 — `METRIC_ROW_COUNT = 13` declared after the object that uses it** — `src/lib/reports/datasets.ts:198` (declaration), `:171` (use). The 27-line gap hides the coupling between the constant and the `yearMetrics.page` array length. Lift the constant above `yearMetrics` or derive it as `yearMetricsRows().length`. (Rules Low.) Distinct from F9 (which flags the hardcoded drift risk, not the placement).
17. **Rules L3 — `formatBytes` is a local helper next to reused `lib/core` formatters** — `src/app/(admin)/admin/reports/exports/page.tsx:111–113`. Page already imports `formatDateTime`/`formatCents` from `lib/core/*`; a future second caller would miss this one. Rule of 2 says leave it today; flagged for consistency only. (Rules Low.)
18. **Clean-code m3 — `countedOrder` filter shape duplicated three ways** — `src/lib/reports/datasets.ts:33–36` (function, + inlined at 250, 268), `season-performance.ts:139` (local const), `margin-report.ts:55` (inline literal). Three spellings of "orders that count" across files importing the same `COUNTED_ORDER_STATUSES`. Export `countedOrderFilter(seasonId)` from `season-performance.ts` and reuse. (Clean-code Minor.)

### Minors (Info) — noted, no fix required

19. **SEC-5 — `wipeTransactionalData` erases migration and cleanup history; only `AuditEvent` survives** — `src/lib/testing/console.ts:116–134`. Intended behaviour for rehearsal reset; gates are correct (`settings.manage` + `requireTestMode` + `WIPE` word). Residual is operational: test mode is a DB setting, so a deployment left in test mode keeps the wipe button live. Worth a runbook line, not a code change. (Security Info.)
20. **F8 — `readSeasonPerformance` issues three extra queries per season (N+1)** — `src/lib/reports/season-performance.ts:55–73`. Season count bounded (~dozen), not a scale problem; N+1 in shape only. (Quality Info.)
21. **F9 — `METRIC_ROW_COUNT = 13` is hardcoded** — `src/lib/reports/datasets.ts:198` vs `page` at `:180–194`. Adding/removing a metric requires updating both; they are adjacent, so drift is unlikely, but the constant is a manual invariant. (Quality Info.) Pairs with L2 (placement) — both kept because the claims differ.
22. **Rules I1 — `codegraph` adherence not verifiable from artifacts** — no `.codegraph/` directory; fallback applied. P12 code reuses existing helpers consistently; no grep-for-symbol violation observed. (Rules Info.)
23. **Rules I2 — `vocabulary`, UI Consistency, Dependency Discipline, Anti-Hallucination, Error Handling, Security Basics, Shell, Expectation Files, Tone — not flagged** — no `refactor`/`tidy`/`rebuild` vocabulary commands mid-phase; UI reuses `Card`/`Button`/`Badge`/`Label`/`Select`/`FlashMessages`; no new deps; no invented APIs; no swallowed errors; crons registered and gated; no PowerShell written; comments plain English. (Rules Info.)
24. **Rules I3 — `ORDERS_PER_CHUNK = 5` and `MAX_CHUNKS_PER_COMMIT = 3` are business rules with comments but no DECISION-LOG entry** — `src/lib/migration/legacy-import.ts:50, 58`. DECISION-LOG not in tree (gitignored/absent); comments carry the reasoning. (Rules Info.)

## Notes on what is solid (carried forward, not findings)

- Export authorisation (`requirePermission('reports.view')` before anything else; slug resolved against a fixed five-entry list; `seasonId` validated). No IDOR.
- Cron bearer auth (empty `CRON_SECRET` refuses all; `timingSafeEqual` on SHA-256 digests; GET=POST aliasing sound; `vercel.json` registers all six).
- Import dry-run vs commit auth (`migration.manage` manager-only on all four actions; dry-run writes only staging; commit chunked with guarded `committedChunkCount` claim preventing double-write).
- Test-console destructive routes gated in the service (`requireTestMode`), not just the page; `WIPE` confirmation word checked with `rejectWith: never`.
- Reconciliation writes flags only, never payments; fingerprint idempotency; sequential reruns proven non-duplicative (S2d).
- CSV formula injection escaped at the single write point (`csv-write.ts`); import parser deliberately does not escape on the way in — correct split.
- Audit trail shape (`report.exported`, `migration.*`, `cleanup.*`, `testing.console_ran`, etc.) carries no instrument/intent-id/card detail; actor is the real signed-in human even under impersonation.
- Stripe webhook signature verified over raw body; P12 did not touch this path.
- Reconciliation idempotency, chunk grouping by order reference, `finishRun` recompute-from-orders, streaming export paging at 500 rows, help tours permission-gated, scale dress rehearsal over HTTP with no hand-written DB rows — all solid.
