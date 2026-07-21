# P12 Aggregate Review — arm-01

**Phase:** P12 (Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness)
**Tree:** `arms/arm-01/workspace/`
**Inputs:** P12-security, P12-quality, P12-rules, P12-clean-code (arm-01)
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.
**Classification:** Blocker = High severity. Major = Medium. Minor = Low/Info.

## Counts

| Severity | Count |
|---|---|
| Blocker | 4 |
| Major | 21 |
| Minor | 21 |
| **Total** | **46** |

## BLOCKERS (4)

### B1 — CSRF on destructive/financial admin POST routes
**Source:** security H1
**Files:** `src/app/api/admin/test-console/route.ts`, `src/app/api/admin/legacy-imports/route.ts`, `src/app/api/admin/legacy-imports/[batchId]/commit/route.ts`, `src/app/api/admin/stripe-reconciliation/route.ts`, `src/app/api/admin/help/route.ts`
P12 adds destructive endpoints (test-console `wipe`/`seed`/`reset`/`setMode`, legacy-import `stage`/`commit`) and a financial endpoint (manual Stripe reconciliation). All authenticate via `requirePermission` (Clerk cookies, `getCurrentStaffUser`) with no CSRF token, no `Origin`/`Referer` validation, and no `SameSite=Strict` enforcement. A malicious third-party page can trigger cross-site POSTs that wipe production data and trigger financial reconciliation. Blast radius is now data-loss + financial.

### B2 — Competing HTTP response pattern (pattern drift)
**Source:** clean-code H1
All pre-existing admin API routes use `NextResponse.json` from `next/server`. Every new P12 route instead uses the global `Response.json` (`api/admin/exports`, `legacy-imports`, `legacy-imports/[batchId]/commit`, `reports`, `stripe-reconciliation`, `test-console`, `help`, `api/cron/stripe-reconciliation`). Two response helpers for the same concern — violates "one response pattern per project."

### B3 — Control flow coupled to error-message text via regex
**Source:** clean-code H2
`src/app/api/admin/legacy-imports/[batchId]/commit/route.ts:19` chooses HTTP 409 by `/blocking|resumable/i.test(error.message)`; `src/app/api/admin/test-console/route.ts:52` does the same with `/disabled outside/i`. HTTP status is derived from human-readable strings — renaming a message changes routing. Diverges from the typed-error pattern (`ImportConflictError`, `AccessDeniedError`).

### B4 — Two sources of truth for the legacy document shape (type/schema drift)
**Source:** clean-code H3
`src/domain/legacy-import.ts:11-53` defines canonical `Legacy*` types; `src/app/api/admin/legacy-imports/route.ts:6-58` re-declares the entire shape as an independent zod schema with no shared backing. The two already drift: route allows empty `recipientName`/`line1`/`city` (`.max()` only) while `inspectLegacyDocument` flags missing `displayName` (BLOCKING) and missing `city`/`postalCode` (REVIEW); route permits negative `priceCents` (no `.nonnegative()` on product) while `inspectLegacyDocument:131-133` requires `priceCents >= 0`.

## MAJORS (21)

### M1 — Legacy import payload unbounded in aggregate → resource exhaustion
**Source:** security M1
**Files:** `src/app/api/admin/legacy-imports/route.ts` (zod), `src/domain/legacy-import.ts`
Zod permits 25k customers × 25k addresses (625M entries), 25k products, 25k orders × 1k lines. Whole document is parsed, `JSON.stringify`-hashed, stored as a single JSONB `payload`, re-processed later. No request body-size cap at the route. A single authorized `settings:manage` user can exhaust Node memory, Postgres storage, and parser time.

### M2 — `commitLegacyImport` runs the entire import in one serializable transaction
**Source:** security M2
**File:** `src/domain/legacy-import.ts` (`commitLegacyImport`, isolation `Serializable`)
Full document (up to 25k orders × 1k lines + customer/address/product upserts) committed inside a single `$transaction` with `Serializable` isolation, no chunking. Holds locks for minutes, blocking other writers — self-inflicted DoS amplified by M1.

### M3 — Customer dedup silently grafts legacy records onto live customers
**Source:** security M3
**File:** `src/domain/legacy-import.ts` (`commitLegacyImport`, customer lookup)
Existing customers matched by `legacySourceId` OR `emailNormalized` OR `phoneNormalized`. If a legacy customer's email/phone matches a live customer with a different `legacySourceId`, the import reuses that customer and attaches legacy addresses and historical finalized orders without confirmation. `inspectLegacyDocument` does not flag this cross-boundary merge.

### M4 — CSV formula-injection guard bypassable via leading whitespace
**Source:** security M4
**File:** `src/domain/launch-exports.ts` (`protectSpreadsheetCell`)
`protectSpreadsheetCell` only prefixes `'` when the cell starts with `= + - @ \t \r`. Spreadsheet apps trim leading whitespace before evaluating formulas, so `" =2+2"` or `" \t=HYPERLINK(...)"` bypasses the guard. User-controlled fields (`recipient`, `customer`, `email`, `recipientName` snapshots) flow into exports.

### M5 — Cron Stripe reconciliation writes no audit-log entry
**Source:** security M5
**File:** `src/app/api/cron/stripe-reconciliation/route.ts`
Manual admin route records `stripe_reconciliation.completed` in `AuditLog`; the cron route does not. Automated daily reconciliation (financial operation) leaves no auditable trail of who/when/what — only the `ReconciliationRun` row with no actor attribution.

### M6 — Reconciliation only reads the first 100 Stripe PaymentIntents
**Sources:** security M6, quality M2, rules L3, clean-code L4
**File:** `src/domain/stripe-reconciliation.ts` (`readProviderIntents:14`)
`stripe.paymentIntents.list({ limit: 100 })` is not paginated. `ORPHAN_PROVIDER_INTENT` detection only covers the most recent 100 intents; anything older is invisible and the run can report a false-clean reconciliation. Inconsistent with the 5k-package scale the phase claims to harden.

### M7 — `matchedCount` can go negative and is semantically wrong
**Sources:** quality M1, rules M1, clean-code L5
**File:** `src/domain/stripe-reconciliation.ts:128`
`matchedCount: storedIntents.length - findings.length`. `findings` includes `ORPHAN_PROVIDER_INTENT` rows that are NOT stored intents, so they are subtracted from a count they were never part of. In the S2 smoke (1 stored intent + 1 orphan), `matchedCount = 1 - 2 = -1`. Persisted to `ReconciliationRun.matchedCount` and the `stripe_reconciliation.completed` audit row. Smoke asserts `findingCount` and idempotency but never `matchedCount`.

### M8 — `getLaunchReports` loads the entire finalized order graph unbounded
**Source:** quality M3
**File:** `src/domain/launch-reporting.ts:7`
`db.season.findMany` with no `take`, pulling every FINALIZED order with all lines and packages into JS for in-memory aggregation. `getExportRows` caps at `take: 25_000`, but the reports endpoint (page + API) has no cap and no season filter. Unbounded memory on a real multi-season DB; passes the 5k rehearsal only because the fixture is small.

### M9 — Legacy commit does O(n²) customer/address lookups per order line
**Sources:** quality M4, rules M5, clean-code M6
**File:** `src/domain/legacy-import.ts:374-401`
For every order line, the mapping does `document.customers.find(...)` and, when `line.addressId` is set, `document.customers.flatMap(c => c.addresses ?? []).find(...)`, rebuilding/scanning the customer array per line. At the documented caps (25k customers, 25k orders, 1k lines/order) this is quadratic and dominates commit time. Build `Map<sourceId, customer>` and `Map<addressId, recipientName>` once before the order loop.

### M10 — Smoke does not verify export audit history persistence (S2)
**Source:** quality M5
**File:** `scripts/p12-smoke.ts:236-246`
EXPECTED S2 requires "CSV export center + audit history." Smoke asserts 403/200, body contains customer, and `x-export-run-id` is present — but never queries `db.exportRun` or `db.auditLog` to confirm rows persisted. The narrative claims persistence; the test does not enforce it. A regression dropping the `ExportRun`/`AuditLog` writes would still pass S2.

### M11 — Smoke does not verify the orphan PaymentIntent is flagged as an orphan finding (S2)
**Source:** quality M6
**File:** `scripts/p12-smoke.ts:276-285`
Asserts total finding count is 2 across `[intent.stripePaymentIntentId, pi_orphan_${runKey}]`, but does not assert the orphan's `findingType === "ORPHAN_PROVIDER_INTENT"` nor that the succeeded intent's `findingType === "SUCCEEDED_WITHOUT_PAYMENT"`. A bug that mis-classifies finding types would pass.

### M12 — `/api/admin/reports` route has no caller (dead code, Rule of 2)
**Source:** rules M2
**File:** `src/app/api/admin/reports/route.ts`
Exposes `GET /api/admin/reports` requiring `audit:view`, but no UI, smoke, or doc references it. `admin/reports/page.tsx` is a server component that calls `getLaunchReports(db)` directly; `launch-readiness-console.tsx` calls reconciliation/legacy/test-console/help routes, never `/api/admin/reports`. Competing read path duplicating the page's domain call with no consumer.

### M13 — `getLaunchReports` ships a per-label `packages` list the reports page never renders
**Source:** rules M6
**File:** `src/domain/launch-reporting.ts:142-153`
Builds `shippingMargin.packages` — one entry per `PURCHASED` label with ~10 fields. `reports/page.tsx` only renders `reports.shippingMargin.totals` (per-season aggregates); `shippingMargin.packages` is serialized into the server-component payload and the `/api/admin/reports` response but never consumed. At the 5k-package rehearsal this is thousands of unused rows on every `/admin/reports` load.

### M14 — `getExportRows` is a 5-branch god function
**Source:** clean-code M1
**File:** `src/domain/launch-exports.ts:34-162`
Handles `deliveries`, `year-end`, `year-metrics`, `item-sales`, `lapsed-customers` in one body — five distinct DB queries and five row-mapping shapes behind an if/else chain. Mixed concerns; each dataset should be its own function keyed off `ExportDataset`.

### M15 — Export dataset list duplicated between domain and client component
**Sources:** rules M4, clean-code M2
**Files:** `src/domain/launch-exports.ts:4-10`, `src/components/launch-readiness-console.tsx:162`
Domain exports `exportDatasets = ["deliveries","year-end","year-metrics","item-sales","lapsed-customers"]`; the client component re-hardcodes the same array for the link buttons. Adding a dataset requires editing both files or the UI silently drops it. `launch-exports.ts` has only type-only Prisma imports (erased at build), so `exportDatasets` is safe to import into the client component.

### M16 — Repeated fetch→json→setMessage pattern in the console
**Source:** clean-code M3
**File:** `src/components/launch-readiness-console.tsx`
Same shape repeated five times (`reconcile` 68-78, `stageLegacyImport` 80-105, `commitLegacyImport` 107-118, `testAction` 120-128, `completeTour` 130-138): `fetch` → `response.json()` → `setMessage(response.ok ? success : payload.error)`. Rule of 2 exceeded; extract a helper.

### M17 — Local money formatter duplicates `lib/currency.ts`
**Sources:** rules M3, clean-code M4
**File:** `src/app/(admin)/admin/reports/page.tsx:8-13`
Declares `function dollars(cents)` with `Intl.NumberFormat` (default 2 fraction digits). `src/lib/currency.ts:7` already exports `formatCurrency` with `minimumFractionDigits: 0`. Two formatters for the same concern, disagreeing on fraction digits — reports renders `$21,000.00` where every other admin screen renders `$21,000`.

### M18 — Test-console-enabled guard duplicated
**Source:** clean-code M5
**Files:** `src/domain/test-console.ts:5-12`, `src/app/(admin)/admin/reports/page.tsx:87-90`
Both inline the same `NODE_ENV !== "production" && ENABLE_TEST_AUTH === "true"` check. Two sources of truth for "is the test console available"; changing the rule requires edits in both.

### M19 — Nesting depth exceeds the 3-level rule in `commitLegacyImport`
**Source:** clean-code M7
**File:** `src/domain/legacy-import.ts:215-437`
Reaches `transaction → for-order → lines.map → ternary/if` nesting (around 374-401), past the "more than 3 levels of nesting" threshold in `clean-code.mdc`. The per-line snapshot builder should be extracted.

### M20 — Recovering an index by splitting a composed ID string
**Sources:** clean-code M8, quality L6
**File:** `src/domain/test-console.ts:113`
`const orderIndex = Number(orderPackage.orderId.split("-").at(-1))` parses `p12-scale-order-${index}` to recover `index`. Fragile — a prefix change silently breaks the join. Track `orderIndex` directly when building `packages` instead of round-tripping it through the ID.

### M21 — Inline fixture data in the component
**Source:** clean-code M9
**File:** `src/components/launch-readiness-console.tsx:5-54`
Embeds a ~50-line `sampleLegacyDocument` JSON literal inside the component module. Mixed concerns; fixture/sample data should live in its own module/constant.

## MINORS (21)

### m1 — `x-cron-run-key` header attacker-controllable and used as DB unique key
**Source:** security L1
**File:** `src/app/api/cron/stripe-reconciliation/route.ts`
Cron route accepts `x-cron-run-key` verbatim as `runKey` (no length/charset validation) and stores it. A caller with `CRON_SECRET` can pre-empt a future day's default runKey (`stripe-reconciliation:YYYY-MM-DD`) to pre-create a `COMPLETED` run and suppress that day's real reconciliation. Mitigated by `CRON_SECRET` gating.

### m2 — Cron reconciliation race on the default per-day runKey
**Source:** security L2
**Files:** `src/app/api/cron/stripe-reconciliation/route.ts`, `src/domain/stripe-reconciliation.ts`
Default `runKey` is `stripe-reconciliation:${day}`. Two concurrent invocations both pass the `existing?.status === "COMPLETED"` short-circuit, both upsert to `RUNNING`, both execute. Findings dedupe by `identityKey`, but `matchedCount`/`findingCount` and the `RUNNING`→`COMPLETED` transition can race. No advisory lock or unique claim guard.

### m3 — Exports silently truncate at 25,000 rows
**Source:** security L3
**File:** `src/domain/launch-exports.ts` (every dataset uses `take: 25_000`)
All export queries cap at 25,000 rows with no overflow flag, so a season larger than the cap produces an export that omits rows without indication. Evidence completeness for audit/finance is silently degraded.

### m4 — Export "streaming" materializes the full CSV in memory first
**Sources:** security L4, quality L2
**File:** `src/app/api/admin/exports/route.ts:40-47`
`getExportRows` loads all rows, `encodeCsv` builds the entire CSV string in memory, then it is chunked into a `ReadableStream`. No `content-length` set. Streaming is cosmetic; peak memory holds the full CSV. Fine at 25k rows, but the "stream" label misrepresents the memory profile.

### m5 — Test-console `wipe` deletes customers by order association, not by ID prefix
**Source:** security L5
**File:** `src/domain/test-console.ts` (`wipeScaleFixture`)
Scale orders identified by `draftReference startsWith "p12-scale-"`, customers deleted by `id in orders.map(order => order.customerId)`. If a scale order ever references a real customer id (e.g. via a future seed change), `wipe` would delete the real customer. Gated to non-production (`assertTestConsoleEnabled`), but the deletion predicate is fragile.

### m6 — CSV injection guard mangles legitimate negative numbers
**Source:** quality L1
**File:** `src/domain/launch-exports.ts:15`
`/^[=+\-@\t\r]/` prefixes any cell starting with `-` with `'`. Cents fields are non-negative today so impact is nil, but `String(value)` on a future negative field would render as text in spreadsheets. Worth scoping the guard to `= + @ \t \r` only.

### m7 — `year-end` export with no `seasonId` returns every finalized order across all seasons
**Source:** quality L3
**File:** `src/domain/launch-exports.ts:80-92`
`where: { status: "FINALIZED", seasonId }` with `seasonId` undefined returns all seasons. "Year-end" semantically implies a single year; the UI always passes a seasonId, but the API allows an unbounded cross-season dump.

### m8 — Legacy address upsert does not back-fill `legacySourceId` on a pre-existing address
**Source:** quality L4
**File:** `src/domain/legacy-import.ts:287-317`
When a real (non-legacy) address already exists at that `customerId_normalizedKey`, the update branch sets greeting/validation only, not `legacySourceId`. The source address ID is still mapped for the order lines, but the existing address is never marked as legacy-origin, so later "where did this come from" audits lose the link.

### m9 — Scale `orderNumber` range (`1_900_000 + index`) can collide with real orders
**Source:** quality L5
**File:** `src/domain/test-console.ts:74`
Hardcodes scale order numbers at 1.9M. If the real season already has order numbers in that range, `createMany` fails on the unique constraint. Low risk but not isolated by prefix or by a season-scoped offset.

### m10 — Reconciliation treats non-succeeded intent with a matching-amount POSTED payment as "matched"
**Source:** quality L7
**File:** `src/domain/stripe-reconciliation.ts:74-95`
Only `SUCCEEDED_WITHOUT_PAYMENT` and `AMOUNT_MISMATCH` produce findings. A `PROCESSING`/`REQUIRES_ACTION` intent that already has a POSTED `Payment` of the same amount produces no finding, so a payment posted against a non-succeeded intent is silently treated as reconciled. May be intentional, but EXPECTED S2 frames reconciliation as "charged vs paid," and this state is a real discrepancy.

### m11 — `25_000` cap is a repeated magic value
**Sources:** rules L1, clean-code L1
**Files:** `src/domain/launch-exports.ts:63,91,153`, `src/app/api/admin/legacy-imports/route.ts:23,25,34,52`
`take: 25_000` for exports and `.max(25_000)` for import customers/products/orders/addresses. No named constant ties the export cap to the import cap; raising one without the other changes the implied contract silently.

### m12 — Export run + audit written as two non-transactional awaits
**Source:** rules L2
**File:** `src/app/api/admin/exports/route.ts:22-38`
`db.exportRun.create` then `db.auditLog.create` as separate awaits, and `ExportRun.completedAt` defaults to `now()` at creation, before the streamed response is actually consumed. A crash between the two awaits leaves an export run with no audit row; a client disconnect still shows the run as completed.

### m13 — Resumed commit produces order-number gaps
**Source:** rules L4
**File:** `src/domain/legacy-import.ts:339-358`
`nextNumberBySeason` increments for every order in the loop, including already-committed orders whose `upsert` is a no-op (`update: {}`). After a crash and resume, the counter advances past committed orders, so newly-committed orders receive numbers above the gap. `docs/LEGACY-ENTITY-MAP.md` promises "deterministically resequenced" numbers; the resume path is deterministic but gapped.

### m14 — Two warning palettes for test mode
**Source:** rules L5
**Files:** `src/app/(admin)/admin/layout.tsx:50-54`, `src/components/launch-readiness-console.tsx:205-216`
TEST MODE banner renders in `bg-red-700 … text-white`; the test-console section renders in `bg-amber-50 border-amber-300 … text-amber-950 border-amber-800`. Both signal "test/destructive," but the two surfaces disagree on the warning token set.

### m15 — `test_console.*` audit action is camelCase while siblings are snake_case
**Source:** rules L6
**File:** `src/app/api/admin/test-console/route.ts:41`
Writes `action: \`test_console.${parsed.data.action}\`` → `test_console.setMode` / `test_console.seed`. Other P12 audits use snake_case verbs: `legacy_import.committed`, `legacy_import.staged`, `stripe_reconciliation.completed`, `export.completed`. The discriminated-union `setMode` literal leaks straight into the audit string.

### m16 — Help-tour completion is the only unaudited admin write
**Source:** rules L7
**File:** `src/app/api/admin/help/route.ts:16-29`
Upserts `HelpTourProgress` for `session.effective.id` with no `auditLog` row. Every other P12 admin mutation (exports, legacy stage/commit, reconciliation, test console) writes an audit row. Low-stakes, but it is the one admin write in the phase with no audit trail.

### m17 — `lapsed-customers` selects `id` it never uses
**Source:** rules L8
**File:** `src/domain/launch-exports.ts:132-134`
The no-`seasonId` branch does `db.season.findFirst({ …, select: { id: true, year: true } })`, but only `selectedSeason.year` is read afterwards (the `if (!selectedSeason) return []` check needs no field). The `id: true` select is dead.

### m18 — `countDocument` / totals reduce computed twice
**Source:** clean-code L2
**File:** `src/domain/legacy-import.ts:68-82`, `172-178`, `407-413`
`countDocument` and the `sourceTotals`/`importedTotals` reduce run the same logic in both `inspectLegacyDocument` and `commitLegacyImport`. Minor duplication.

### m19 — Misleading REVIEW message wording
**Source:** clean-code L3
**File:** `src/domain/legacy-import.ts:121`
Message reads "Address needs city or postal-code review." (implies "or") but the condition at line 116 fires when **either** city or postalCode is missing. Wording drift.

### m20 — Loose `outcome: unknown` and inconsistent response shape
**Source:** clean-code L6
**File:** `src/app/api/admin/test-console/route.ts:23,47`
Uses `let outcome: unknown` and returns `{ outcome }`, an inconsistent shape vs. other routes that return the entity directly. Loose typing.

### m21 — Single `message` string overwrites all action state
**Source:** clean-code L7
**File:** `src/components/launch-readiness-console.tsx:66`
Stores one `message` string overwritten on every action with no loading/error/loading distinction; concurrent or rapid actions clobber each other. Minor UX/consistency.

## Dedupe map

- M6 (100-intent cap): security M6 + quality M2 + rules L3 + clean-code L4
- M7 (matchedCount negative): quality M1 + rules M1 + clean-code L5
- M9 (O(n²) legacy lookups): quality M4 + rules M5 + clean-code M6
- M15 (dataset list dup): rules M4 + clean-code M2
- M17 (money formatter dup): rules M3 + clean-code M4
- M20 (split ID string): clean-code M8 + quality L6
- m4 (CSV in-memory): security L4 + quality L2
- m11 (25_000 magic): rules L1 + clean-code L1

No new findings introduced. Security blockers (H1) preserved as B1.
