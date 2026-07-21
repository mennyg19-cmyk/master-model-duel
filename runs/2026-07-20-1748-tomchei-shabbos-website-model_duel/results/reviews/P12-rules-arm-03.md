# P12 Rules Review — arm-03 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** adherence to selected catalog rules. Findings only — no fixes.
**Smoke:** 5/5 PASS (functional coverage is complete; this review is rule adherence, not functionality).

## Summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 4 |
| Low | 2 |
| **Total** | **9** |

The phase delivers all five EXPECTED items and passes smoke. The rule violations cluster around one pattern: **the same concern was implemented twice**, with one copy left dead or shadow-cronned. Three P12 areas (reports, exports, reconcile) each have a parallel dead/competing module, and test-ops has two overlapping modules plus two setting-key files plus two divergent `TestModeSetting` types. Reconcile is the most serious because both copies are live and write the same Prisma tables with different logic.

## Findings

### H1 — Two live reconcile implementations for one business operation
**Rules:** clean-code (duplicated logic, inconsistent patterns), ponytail (never silently choose business logic)
**Files:**
- `src/lib/ops/reconcile.ts` → `runPaymentReconcile` (used by `/api/admin/reconcile` and `/api/cron/payment-reconcile`)
- `src/lib/payments/reconcile.ts` → `runPaymentReconciliation` (used by `/api/cron/stripe-reconcile`)

Both create `paymentReconcileRun` + `paymentReconcileAdjustment` rows for the same operation, but with different rules:
- Orphan status whitelist: `ops` accepts only `succeeded`; `payments` accepts `succeeded | requires_capture | processing`.
- Adjustment `kind` string: `"ORPHAN_PAYMENT_INTENT"` (ops) vs `"ORPHANED_PAYMENT_INTENT"` (payments).
- Fingerprint format: `sha256("orphan_pi:"+id).slice(0,40)` (ops) vs `"orphan:"+id` (payments).
- Match logic: `ops` matches on `order.payments` POSTED total or linked payment; `payments` matches on `paymentStatusCached===PAID || postedTotal>=amount` plus optional `mockIntents` injection.

Two code paths for one reconciliation means business rules are silently chosen per route. `ponytail.mdc` explicitly forbids silently choosing business logic; `clean-code.mdc` requires one pattern per concern.

### H2 — Duplicate cron route for reconciliation; `stripe-reconcile` unregistered in vercel.json
**Rules:** clean-code (inconsistent patterns), EXPECTED P12 §4 ("all crons registered with secret auth")
**Files:** `src/app/api/cron/payment-reconcile/route.ts`, `src/app/api/cron/stripe-reconcile/route.ts`, `vercel.json`

`vercel.json` registers 6 crons (`season-auto-flip`, `pickup-expiry`, `payment-reminder`, `outbox-sweep`, `purge-email-log`, `payment-reconcile`). There are 7 cron route files — `stripe-reconcile` is not registered, so it never runs in production, yet it duplicates `payment-reconcile`. Both apply `requireCronBearer` (auth is fine; smoke confirms 401×6). The finding is registration drift + duplicate cron for one job, not auth.

### H3 — `src/lib/ops/import.ts` is a god file (702 lines, mixed concerns)
**Rules:** clean-code (split when >500 lines or mixed concerns), ponytail (god files)
**File:** `src/lib/ops/import.ts` (702 lines)

One file mixes: a hand-rolled CSV parser, three `classify*Rows` functions (customers/products/orders), three `commit*Row` functions, plus `stageImport`/`commitImport`/`getImportBatch` orchestration. Exceeds the 500-line split trigger and bundles multiple concerns (parsing, per-kind classification, per-kind commit, orchestration).

### M1 — Dead duplicate reports module
**Rules:** clean-code (dead code, duplicated logic, type/schema drift)
**Files:** `src/lib/reports/margin.ts` (`buildMarginReport`), `src/lib/reports/performance.ts` (`buildPerformanceReport`, `stageCountsBySeason`)

No import of `@/lib/reports/margin` or `@/lib/reports/performance` anywhere in `src/` (grep returned zero matches); the symbols are only ever defined, never referenced. The live path is `src/lib/ops/reports.ts` (`performanceReport`, `marginReport`), used by `/api/admin/reports`. The dead module returns incompatible shapes (`byFulfillment: Array` vs `byMethod: Record`, `seasonName` vs `name`, season-totals map vs flat report). Dead code + duplicated logic + type/schema drift on the same domain.

### M2 — Dead duplicate exports module
**Rules:** clean-code (dead code, duplicated logic, inconsistent patterns, schema drift)
**File:** `src/lib/exports/center.ts` (`runExport`, `listExportHistory`)

No import of `@/lib/exports/center` anywhere (grep returned zero matches). The live path is `src/lib/ops/exports.ts` (`runCsvExport`, `listExportAudits`), used by `/api/admin/exports` and `exports-client.tsx`. The two diverge on the same dataset enum:
- CSV line endings: `center.ts` emits CRLF + UTF-8 BOM; `ops/exports.ts` emits LF, no BOM.
- `DELIVERIES` columns differ entirely: `center.ts` → `route,sequence,recipient,status,orderNumber,deliveredAt`; `ops/exports.ts` → `packageId,orderNumber,year,recipient,city,state,postal,method,stage`.
- Audit meta key: `auditId` (center) vs `exportAuditId` (ops).
- `LAPSED_CUSTOMERS` logic: open-season diff (center) vs 1-year-cutoff (ops).

Dead code + duplicated logic + inconsistent patterns + schema drift.

### M3 — Two duplicate address-cleanup routes
**Rules:** clean-code (duplicated logic, inconsistent patterns)
**Files:** `src/app/api/admin/address-cleanup/route.ts`, `src/app/api/admin/addresses/cleanup/route.ts`

Both call the same `runAddressCleanup` / `listAddressReviewQueue` from `src/lib/ops/address-cleanup.ts`. The `addresses/cleanup` variant adds a `merge` action (discriminated union) and forces `limit=100`; the `address-cleanup` variant is cleanup-only with default limit. Neither route is referenced by any UI component (grep for the paths returned no matches), so both are API-only — but they expose two different request shapes for one concern. Callers must know which route supports merge.

### M4 — Two parallel test-ops modules + two setting-key files + two `TestModeSetting` types
**Rules:** clean-code (duplicated logic, type/schema drift, dead code)
**Files:**
- `src/lib/ops/test-ops.ts` (`getTestMode`, `setTestMode(obj)`, `wipeTestFixtures`, `reseedTestSeason`) — live, used by `/api/admin/test-ops`.
- `src/lib/ops/test-console.ts` (`setTestMode(positional)`, `wipeTestSeasonFixtures`, `runDressRehearsal`) — only `runDressRehearsal` is used; `setTestMode` and `wipeTestSeasonFixtures` are dead (route imports only `runDressRehearsal` from this module).
- `src/lib/ops/settings-keys.ts` → `OPS_SETTINGS.testMode = "ops.testMode"`, `TestModeSetting = { enabled, env: "test"|"live" }`.
- `src/lib/ops/test-ops-keys.ts` → `TEST_OPS_SETTINGS.testMode = "ops.testMode"`, `TestModeSetting = { enabled, label? }`.

Same setting key string (`"ops.testMode"`) defined in two constant files. Two different `TestModeSetting` types for one setting. The live writer stores `{ enabled, env }`; the dead writer stores `{ enabled, label }` — reviving the dead code would corrupt the setting shape. Two wipe filters also diverge (`scaleFixture=p6/p12` + draftRef prefixes vs `scaleFixture=p6` + `dressRehearsal/p12Fixture`).

### L1 — Reports API response shape is asymmetric across `kind`
**Rules:** clean-code (inconsistent patterns)
**File:** `src/app/api/admin/reports/route.ts`

For `kind=performance` the response returns `seasons` and `totals` both at top level **and** duplicated inside `report: { seasons, totals }`. For `kind=margin` it returns only `{ ok, kind, report }` (no top-level duplication). One route, two shapes depending on a query param — inconsistent pattern.

### L2 — Missing workflow expectation-file artifacts
**Rules:** workflow (Expectation Files, Run checkpoint)
**Path:** `arms/arm-03/workspace/.scratch/`

`.scratch/` contains per-phase `PHASE-P*-SMOKE.md` / `PHASE-P*-STATUS.md` only. No `phase-plan.md` (workflow requires a rolling phase plan with EXPECTED blocks written **before** each todo, observable items) and no `run-state.md` (workflow requires it for multi-phase/rebuild runs, updated on every gate pass). Gate evidence exists (smoke/status), but the pre-committed expectation discipline the rule describes is absent.

## What was checked and found clean

- **Cron bearer auth:** all 7 cron routes call `requireCronBearer`; smoke confirms 401 without auth. (H2 is about registration, not auth.)
- **Dependency discipline:** `package.json` pins exact versions, no floating ranges, no convenience deps. OK.
- **Codegraph:** `.codegraph/codegraph.db` present; `.scratch/cg-files.json`, `cg-files2.json`, `cg-explore-admin.txt` show the graph was used for structural lookup. No codegraph-rule finding.
- **Comment quality:** comments are mostly constraint/intent (`// UTF-8 BOM for Excel-friendly quoting (R-092).`); no narration pile-up worth a finding.

## Output

- Written: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P12-rules-arm-03.md`
- Findings: **9** (3 high, 4 medium, 2 low)
