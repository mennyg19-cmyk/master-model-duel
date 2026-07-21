# P12 clean-code review — arm-03

Phase: P12 (Reporting, migration, scale hardening, launch readiness)
Scope: P12 deliverables and their immediate support files under `src/lib/ops/`, `src/lib/reports/`, `src/lib/exports/`, `src/lib/payments/`, `src/lib/shipping/margin.ts`, `src/lib/audit.ts`, `src/lib/cron/`, `src/app/api/admin/{reports,exports,reconcile,imports,test-ops}/`, `src/app/api/cron/{payment-reconcile,stripe-reconcile}/`, `src/app/api/audit/`, and the matching `src/components/admin/*-client.tsx`.
Method: structural callers via `codegraph`, then targeted reads. Findings only — no fixes applied.

## Summary counts

- Total findings: 15
- Critical (dead code / divergent duplicates): 6
- Major (inconsistent patterns / correctness drift): 4
- Minor (naming, magic values, comments, anti-AI-tics): 5

## Findings

### 1. Dead code — duplicated report implementations (CRITICAL)
`src/lib/reports/performance.ts` and `src/lib/reports/margin.ts` are entirely dead. `codegraph` reports zero importers for `@/lib/reports/performance` and `@/lib/reports/margin`. The live implementations are `performanceReport` / `marginReport` in `src/lib/ops/reports.ts` (called by the reports route, exports, and `smoke-p12.mjs`). ~215 lines of dead code, plus a divergent `SeasonPerformance` shape (`seasonName` vs `name`, `byFulfillment` vs `byMethod`) that will mislead any future reader.

### 2. Dead code — duplicated export center (CRITICAL)
`src/lib/exports/center.ts` (288 lines) is entirely dead — zero importers of `@/lib/exports/center`. The live export path is `runCsvExport` / `listExportAudits` in `src/lib/ops/exports.ts`. Two parallel CSV-export implementations with different escaping (CRLF+BOM vs LF), different dataset shapes, and different audit meta keys (`auditId` vs `exportAuditId`).

### 3. Duplicated logic — two parallel payment-reconcile implementations (CRITICAL)
Both live, both wired to crons, divergent behavior:
- `src/lib/ops/reconcile.ts` → `runPaymentReconcile` → used by `api/admin/reconcile` route + `cron/payment-reconcile`.
- `src/lib/payments/reconcile.ts` → `runPaymentReconciliation` → used by `cron/stripe-reconcile`.

Divergences: orphan status filter (`succeeded|requires_capture|processing` vs `succeeded` only), fingerprint scheme (`orphan:${id}` literal vs sha256(`orphan_pi:${id}`).slice(0,40)), adjustment kind (`ORPHANED_PAYMENT_INTENT` vs `ORPHAN_PAYMENT_INTENT`), match logic (cached-payment flag + linked-payment reference vs POSTED-payment count + optional Stripe PI upsert). Two crons writing the same `paymentReconcileRun`/`paymentReconcileAdjustment` tables with different semantics — reports and idempotency will disagree depending on which cron ran last.

### 4. Dead code inside reconcile files (CRITICAL)
- `listReconcileRuns` is defined in BOTH `src/lib/ops/reconcile.ts` and `src/lib/payments/reconcile.ts`. `codegraph` reports zero callers for either — `api/admin/reconcile` route inlines its own `db.paymentReconcileRun.findMany` query.
- `seedOrphanPaymentIntent` in `src/lib/payments/reconcile.ts` has zero callers.

### 5. Duplicated logic — two parallel test-mode implementations (CRITICAL)
- `src/lib/ops/test-ops.ts` (LIVE): `TEST_MODE_KEY = "ops.testMode"`, `TestModeSetting = { enabled, env: "test"|"live" }`, `getTestMode`, `setTestMode({enabled, env?, staffId})` (also writes the alert-banner setting), `wipeTestFixtures`, `reseedTestSeason`.
- `src/lib/ops/test-console.ts`: imports `TEST_OPS_SETTINGS` + a different `TestModeSetting = { enabled, label? }` from `test-ops-keys.ts`; defines its own `setTestMode(enabled, staffId?)` (different signature, writes only `{enabled, label}` and skips the banner) and `wipeTestSeasonFixtures` (different wipe predicates). Both `setTestMode` and `wipeTestSeasonFixtures` are DEAD (route uses the `test-ops.ts` versions), but `runDressRehearsal` in the same file is LIVE.

Same setting key `ops.testMode` written by two functions with incompatible value shapes — a latent trap: if the dead `test-console.ts` `setTestMode` is ever called, `getTestMode().env` becomes undefined and the banner setting is never updated.

### 6. Dead code — `src/lib/ops/test-ops-keys.ts` (CRITICAL)
Only consumer is the dead `setTestMode` in `test-console.ts`. Once that is removed, this file is fully dead. It also redefines `TestModeSetting` with a third shape (`{ enabled, label? }`) — a third source of truth for the same concept.

### 7. Inconsistent pattern / correctness — `performanceReport` over-counts vs export (MAJOR)
`src/lib/ops/reports.ts:50` filters orders `status: { not: OrderStatus.DRAFT }` — includes `DISCARDED`. `runCsvExport` YEAR_END/YEAR_METRICS (`src/lib/ops/exports.ts:79`) and the dead `buildPerformanceReport` both filter `notIn: [DRAFT, DISCARDED]`. Same metric reported with different denominators between the reports UI and the CSV export — numbers will not tie out in reconciliation.

### 8. Duplicated logic — near-identical cron route handlers (MAJOR)
`src/app/api/cron/payment-reconcile/route.ts` and `src/app/api/cron/stripe-reconcile/route.ts` are copy-paste identical except for `jobKey` and the inner reconcile import. Both define the same `runXxxCron` wrapper (bearer check → `beginCronRun` → try/`finishCronRun`/catch) and the same GET+POST pair. Extract a `cronReconcileHandler(jobKey, fn)` helper.

### 9. Redundant payload — `/api/admin/reports` performance branch (MAJOR)
`src/app/api/admin/reports/route.ts:29-35` returns `seasons`, `totals`, AND `report: { seasons, totals }`. The client (`reports-client.tsx`) reads only `pj.seasons` (it recomputes totals locally at lines 64-69) and `mj.report` for the margin branch. Top-level `totals` and the `report` wrapper are unused. Same route also recomputes `totals` server-side for nothing.

### 10. Inconsistent pattern — `/api/audit` inlines audit query (MAJOR)
`src/app/api/audit/route.ts` runs its own `db.auditLog.findMany` with a hand-rolled `include`, while `src/lib/audit.ts` exports `listAudit({})` (used by the audit page and the order detail route) that already encapsulates the same query with the same includes. Two query paths for the same admin audit list; the inline one bypasses the `MAX_AUDIT_LIMIT` clamp and the shared shape.

### 11. Naming drift across duplicates (MINOR)
`SeasonPerformance` in `src/lib/ops/reports.ts` uses `name` + `byMethod: Record<string,number>`. The dead twin in `src/lib/reports/performance.ts` uses `seasonName` + `byFulfillment: Array<{code,packages,revenueCents}>`. Same concept, three field names. Resolve by deleting the dead twin (finding 1).

### 12. Magic values (MINOR)
- `src/lib/ops/import.ts:226` — literal `800000` for repaired order numbers; `:487` — hardcoded `"2025-03-01T12:00:00Z"` for `placedAt` on imported historical orders.
- `src/lib/ops/test-ops.ts:63-66,80,83` — string literals `"p6"`, `"p12"`, `"p12-dress-"`, `"p12-wipe-"`, `"orphan:pi_orphan_p12"` used as JSON-path predicates and `startsWith` filters. Scattered across `test-ops.ts` and `test-console.ts` with no shared constants — wipe predicates in the two files target different path keys (`scaleFixture`/`dressRehearsal`/`p12Fixture` vs `scaleFixture`/`p12`/`draftRef` prefixes), which is also why finding 5's two wipe functions behave differently.

### 13. Comment quality (MINOR)
- `src/lib/ops/import.ts:225` `// Repair broken order numbers — assign provisional from row.` narrates the next two lines.
- `src/lib/ops/import.ts:240` `const hardErrors = errors.filter((e) => e !== "orderNumber_repaired");` needs the comment that is missing (why "orderNumber_repaired" is a soft error), while the adjacent narration comment is the one that should go.
- `src/lib/audit.ts:50` `// JSON predicates in Postgres — no global take-then-filter window.` is acceptable (explains a non-obvious tradeoff).

### 14. Anti-AI-tics / nesting (MINOR)
`src/lib/ops/import.ts:542-553` — nested ternary across four lines to pick `season` for PRODUCTS vs ORDERS vs CUSTOMERS. Three levels of conditional; hard to read. Replace with an early-return helper or two explicit branches.

### 15. Redundant assertions (MINOR)
`src/lib/shipping/margin.ts:60-61` — `let chargeRate = perCarrier[0]!; let buyRate = perCarrier[0]!;` use non-null assertions immediately after the `eligible.length === 0` throw guarantees the array is non-empty. The `!` is the kind of assertion the rule flags; `perCarrier[0] ?? throw` or a single `const first = perCarrier[0]; if (!first) throw ...` is cleaner.

## Notes

- Dead-code claims (findings 1, 2, 4, 6, and the dead halves of 5) were verified with `codegraph` importers/callers queries — zero external importers for the listed files/symbols.
- The two-reconcile and two-test-mode duplications (findings 3, 5) are the highest-risk items: both halves are live, writing the same tables/settings with different semantics.
- No fixes applied — findings only.
