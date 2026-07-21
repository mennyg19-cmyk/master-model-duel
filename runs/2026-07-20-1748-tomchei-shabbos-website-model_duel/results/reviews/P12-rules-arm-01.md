# P12 Rules Review — arm-01

Reviewer specialist: Rules. Blind to model name.
Scope: P12 changes under `arms/arm-01/workspace/` (launch readiness — multi-season reports, shipping-margin reconciliation, audited CSV exports, Stripe reconciliation, legacy JSON import pipeline, scale dress rehearsal, test console, guided tours, cron registration).
Rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol` (per `arms/arm-01/ARM.md`). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 6 |
| Low | 8 |
| **Total** | **14** |

Strengths: domain is split by concern (`launch-reporting.ts`, `launch-exports.ts`, `legacy-import.ts`, `stripe-reconciliation.ts`, `test-console.ts`) with route handlers thin and delegating to domain. CSV export has spreadsheet-injection hardening (`protectSpreadsheetCell` + BOM). Legacy import uses a SHA-256 checkpoint, a single serializable transaction, a `COMMITTING` claim guard for resume, and blocking/REVIEW issue separation — matching `docs/LEGACY-ENTITY-MAP.md`. Stripe reconciliation is idempotent on `runKey` and `identityKey` (smoke S2 confirms replay produces no duplicate findings). Test-console destructive ops are gated by `assertTestConsoleEnabled` (env + `ENABLE_TEST_AUTH`) and return 404 in production. Cron route reuses the existing `isAuthorizedCronRequest` (`timingSafeEqual`) pattern; `vercel.json` registers all six crons. README § P12 and `docs/LEGACY-ENTITY-MAP.md` document the new surface. Migration is additive (no destructive drops). `zod` validates the legacy document and test-console action.

## Medium findings

### M1 — `matchedCount` subtracts orphan findings and can go negative (clean-code: correctness; workflow: never silently choose business logic)
`src/domain/stripe-reconciliation.ts:128` — `matchedCount: storedIntents.length - findings.length`. `findings` mixes stored-intent findings (`SUCCEEDED_WITHOUT_PAYMENT`, `AMOUNT_MISMATCH`) with `ORPHAN_PROVIDER_INTENT` rows that are *not* stored intents. Subtracting the orphan count undercounts matches and can produce a negative number. In the smoke fixture: 1 stored intent (succeeded, no payment → 1 finding) + 1 orphan = `findings.length=2`, so `matchedCount = 1 - 2 = -1`, which is then written to `ReconciliationRun.matchedCount` and to the `stripe_reconciliation.completed` audit row. The smoke suite asserts `findingCount` and idempotency but never asserts `matchedCount`, so the defect slips through. Matched count should be `storedIntents.length - (findings about stored intents)`.

### M2 — `/api/admin/reports` route has no caller (clean-code: dead code, Rule of 2)
`src/app/api/admin/reports/route.ts` exposes `GET /api/admin/reports` requiring `audit:view`, but no UI, smoke, or doc references it. `src/app/(admin)/admin/reports/page.tsx` is a server component that calls `getLaunchReports(db)` directly and renders the result; `launch-readiness-console.tsx` calls the reconciliation/legacy/test-console/help routes, never `/api/admin/reports`. Grep across `src/` and `scripts/` finds zero `api/admin/reports` references. The route is a competing read path that duplicates the page's domain call with no consumer.

### M3 — Reports page defines a local `dollars` instead of reusing `formatCurrency` (clean-code: one pattern per concern; duplicated logic)
`src/app/(admin)/admin/reports/page.tsx:8-13` declares `function dollars(cents) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }`. The rest of the app (catalog, POS, orders, collections) imports `formatCurrency` from `@/lib/currency`. The only behavioral difference is fraction digits (`dollars` keeps 2, `formatCurrency` forces 0), so the new reports screen renders `$21,000.00` where every other admin screen renders `$21,000` — a competing currency pattern in the same concern.

### M4 — Export dataset list duplicated between domain and client component (clean-code: duplicated logic; type/schema drift)
`src/domain/launch-exports.ts:4-10` exports `exportDatasets = ["deliveries","year-end","year-metrics","item-sales","lapsed-customers"]`. `src/components/launch-readiness-console.tsx:162` re-hardcodes the same `["deliveries","year-end","year-metrics","item-sales","lapsed-customers"]` array for the link buttons. Adding a dataset requires editing both files or the UI silently drops it. `launch-exports.ts` only has type-only Prisma imports (erased at build), so `exportDatasets` is safe to import into the client component; the duplication is avoidable.

### M5 — Legacy commit does O(lines) document scans per line (ponytail: efficiency; clean-code: inconsistent patterns)
`src/domain/legacy-import.ts:374-401` — inside the per-order/per-line loop, each line calls `document.products.find(p => p.id === line.productId)` and `document.customers.flatMap(c => c.addresses ?? []).find(a => a.id === line.addressId)`. The `flatMap` re-allocates the full address list for every line. At the documented 25k-order / up-to-1k-lines cap this is O(lines × (products + customers×addresses)). The module already builds `customerMap`/`productMap`/`addressMap` for IDs; a parallel `Map<string, LegacyProduct>` and `Map<string, string>` (addressId → recipientName) built once would make the loop O(lines).

### M6 — `getLaunchReports` ships a per-label `packages` list the reports page never renders (ponytail: YAGNI; efficiency)
`src/domain/launch-reporting.ts:142-153` builds `shippingMargin.packages` — one entry per `PURCHASED` label with ~10 fields. `reports/page.tsx` only renders `reports.shippingMargin.totals` (per-season aggregates); `shippingMargin.packages` is serialized into the server-component payload and the `/api/admin/reports` response but never consumed. At the 5k-package dress-rehearsal scale this is thousands of unused rows on every `/admin/reports` load.

## Low findings

### L1 — `25_000` cap is a repeated magic value (clean-code: magic values)
`src/domain/launch-exports.ts:63,91,153` use `take: 25_000`, and `src/app/api/admin/legacy-imports/route.ts:23,25,34,52` use `.max(25_000)` for customers/products/orders/addresses. No named constant ties the export cap to the import cap; raising one without the other changes the implied contract silently.

### L2 — Export run + audit written as two non-transactional awaits (clean-code: consistency)
`src/app/api/admin/exports/route.ts:22-38` — `db.exportRun.create` then `db.auditLog.create` as separate awaits, and `ExportRun.completedAt` defaults to `now()` at creation, before the streamed response is actually consumed. A crash between the two awaits leaves an export run with no audit row; a client disconnect still shows the run as completed.

### L3 — `readProviderIntents` caps at 100 with no pagination or comment (clean-code: anti-hallucination; workflow: verify)
`src/domain/stripe-reconciliation.ts:14` — `stripe.paymentIntents.list({ limit: 100 })` fetches only the 100 most recent intents, no `created` filter, no pagination, no `ponytail:` comment explaining the daily-cadence assumption. A busy day exceeding 100 new intents would leave older unsettled intents unreconciled with no signal.

### L4 — Resumed commit produces order-number gaps (workflow: expectation vs. behavior)
`src/domain/legacy-import.ts:339-358` — `nextNumberBySeason` increments for every order in the loop, including already-committed orders whose `upsert` is a no-op (`update: {}`). After a crash and resume, the counter advances past committed orders, so newly-committed orders receive numbers above the gap. `docs/LEGACY-ENTITY-MAP.md` promises "deterministically resequenced" numbers; the resume path is deterministic but gapped.

### L5 — Two warning palettes for test mode (clean-code: UI consistency)
`src/app/(admin)/admin/layout.tsx:50-54` renders the TEST MODE banner in `bg-red-700 … text-white`. `src/components/launch-readiness-console.tsx:205-216` renders the test-console section in `bg-amber-50 border-amber-300 … text-amber-950 border-amber-800`. Both signal "test/destructive," but the two surfaces disagree on the warning token set.

### L6 — `test_console.*` audit action is camelCase while siblings are snake_case (clean-code: consistency)
`src/app/api/admin/test-console/route.ts:41` writes `action: \`test_console.${parsed.data.action}\`` → `test_console.setMode` / `test_console.seed`. Other P12 audits use snake_case verbs: `legacy_import.committed`, `legacy_import.staged`, `stripe_reconciliation.completed`, `export.completed`. The discriminated-union `setMode` literal leaks straight into the audit string.

### L7 — Help-tour completion is the only unaudited admin write (clean-code: consistency)
`src/app/api/admin/help/route.ts:16-29` upserts `HelpTourProgress` for `session.effective.id` with no `auditLog` row. Every other P12 admin mutation (exports, legacy stage/commit, reconciliation, test console) writes an audit row. Low-stakes, but it is the one admin write in the phase with no audit trail.

### L8 — `lapsed-customers` selects `id` it never uses (clean-code: anti-AI-tics)
`src/domain/launch-exports.ts:132-134` — the no-`seasonId` branch does `db.season.findFirst({ …, select: { id: true, year: true } })`, but only `selectedSeason.year` is read afterwards (the `if (!selectedSeason) return []` check needs no field). The `id: true` select is dead.

## Severity tally

- High: 0
- Medium: 6 (M1–M6)
- Low: 8 (L1–L8)
- Total: 14
