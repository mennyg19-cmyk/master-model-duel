# Reviewer specialist — Quality

**Arm:** `arm-01`
**Tree / phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Output:** `results/reviews/P12-quality-arm-01.md`
**Scope:** findings only, no fixes. Blind to model name.

## Summary

P12 ships the full launch-readiness surface: multi-season reports + shipping-margin, audited CSV export center, Stripe reconciliation (manual + cron), legacy import (dry-run → atomic commit), scale test console, test-mode banner, help tours, and a 1k/5k dress rehearsal. Smoke (S1–S5) is reported PASS and the script is substantive. The findings below are correctness, scale-hardening, and smoke-coverage gaps — not feature gaps.

## Findings

### M1 — `matchedCount` can go negative and is semantically wrong
`src/domain/stripe-reconciliation.ts:128` sets `matchedCount: storedIntents.length - findings.length`. `findings` includes `ORPHAN_PROVIDER_INTENT` rows that are NOT stored intents, so they are subtracted from a count they were never part of. In the S2 smoke (1 stored intent that is SUCCEEDED_WITHOUT_PAYMENT + 1 orphan), `matchedCount = 1 - 2 = -1`. The metric is also wrong whenever any orphan findings exist. Persisted to `ReconciliationRun.matchedCount` and returned to the UI/cron response.

### M2 — `readProviderIntents` fetches only the first 100 intents, no pagination
`src/domain/stripe-reconciliation.ts:14` calls `stripe.paymentIntents.list({ limit: 100 })` and returns `page.data` with no `hasMore`/pagination loop. Any account with >100 PaymentIntents will silently miss orphans and report a false clean reconciliation. The cron is daily, but orphans can be older than the latest 100. Scale-hardening phase explicitly tolerates 5k packages; 100-intent cap is inconsistent with that bar.

### M3 — `getLaunchReports` loads the entire finalized order/line/package graph unbounded
`src/domain/launch-reporting.ts:7` runs `db.season.findMany` with no `take`, pulling every FINALIZED order with all lines and packages into JS for in-memory aggregation. `getExportRows` caps every dataset at `take: 25_000`, but the reports endpoint (page + API) has no cap and no season filter. On a real multi-season DB this is unbounded memory; on the 5k-package rehearsal it passes only because the fixture is small.

### M4 — Legacy commit does O(n²) customer/address lookups per order line
`src/domain/legacy-import.ts:376-395` — for every order line, the mapping does `document.customers.find(...)` and, when `line.addressId` is set, `document.customers.flatMap(c => c.addresses ?? []).find(...)`, rebuilding/ scanning the customer array per line. With the documented caps (25k customers, 25k orders, 1k lines/order) this is quadratic and will dominate commit time on a real migration. Build a `Map<sourceId, customer>` and a `Map<addressId, recipientName>` once before the order loop.

### M5 — Smoke does not verify export audit history persistence (S2)
EXPECTED S2 requires "CSV export center + audit history." The smoke script (`scripts/p12-smoke.ts:236-246`) asserts the unauthorized request is 403, the authorized request is 200, the body contains the customer, and `x-export-run-id` is present — but it never queries `db.exportRun` or `db.auditLog` to confirm the rows were persisted. The narrative in `.scratch/PHASE-P12-SMOKE.md` claims persistence; the test does not enforce it. A regression that drops the `ExportRun`/`AuditLog` writes would still pass S2.

### M6 — Smoke does not verify the orphan PaymentIntent is flagged as an orphan finding (S2)
`scripts/p12-smoke.ts:276-285` asserts the total finding count is 2 across `[intent.stripePaymentIntentId, pi_orphan_${runKey}]`, but it does not assert the orphan's `findingType === "ORPHAN_PROVIDER_INTENT"` nor that the succeeded intent's `findingType === "SUCCEEDED_WITHOUT_PAYMENT"`. A bug that mis-classifies finding types (e.g., both as generic) would pass.

### L1 — CSV injection guard mangles legitimate negative numbers
`src/domain/launch-exports.ts:15` — `/^[=+\-@\t\r]/` prefixes any cell starting with `-` with `'`. Cents fields are non-negative today so impact is nil, but `String(value)` on a future negative field would render it as text in spreadsheets. Worth scoping the guard to `= + @ \t \r` only.

### L2 — CSV "streaming" is not actually streamed
`src/app/api/admin/exports/route.ts:40-47` builds the entire CSV string in memory via `encodeCsv`, then slices it into 64k chunks in a `ReadableStream`. No `content-length` is set. For 25k rows this is fine; the "stream" label is misleading and the route holds the full payload in memory before the first byte.

### L3 — `year-end` export with no `seasonId` returns every finalized order across all seasons
`src/domain/launch-exports.ts:80-92` — `where: { status: "FINALIZED", seasonId }` with `seasonId` undefined returns all seasons. "Year-end" semantically implies a single year; the UI always passes a seasonId, but the API allows an unbounded cross-season dump.

### L4 — Legacy address upsert does not back-fill `legacySourceId` on a pre-existing address
`src/domain/legacy-import.ts:287-317` — when a real (non-legacy) address already exists at that `customerId_normalizedKey`, the update branch sets greeting/validation only, not `legacySourceId`. The source address ID is still mapped for the order lines, but the existing address is never marked as legacy-origin, so later "where did this come from" audits lose the link.

### L5 — Scale `orderNumber` range (`1_900_000 + index`) can collide with real orders
`src/domain/test-console.ts:74` hardcodes the scale order numbers at 1.9M. If the real season already has order numbers in that range, `createMany` fails on the unique constraint. Low risk but not isolated by prefix or by a season-scoped offset.

### L6 — Scale `packageLine` order-index parsing is fragile
`src/domain/test-console.ts:113` derives the order index from `orderPackage.orderId.split("-").at(-1)`. It works because IDs are `p12-scale-order-${index}`, but it couples package-line wiring to an ID string format instead of carrying the index explicitly.

### L7 — Reconciliation treats non-succeeded intent with a matching-amount POSTED payment as "matched"
`src/domain/stripe-reconciliation.ts:74-95` — only `SUCCEEDED_WITHOUT_PAYMENT` and `AMOUNT_MISMATCH` produce findings. A `PROCESSING`/`REQUIRES_ACTION` intent that already has a POSTED `Payment` of the same amount produces no finding, so a payment posted against a non-succeeded intent is silently treated as reconciled. May be intentional, but EXPECTED S2 frames reconciliation as "charged vs paid," and this state is a real discrepancy.

## Severity counts

- **Critical / Blocker:** 0
- **Medium:** 6 (M1–M6)
- **Low:** 7 (L1–L7)

Total: 13 findings. No broken flows or stubs; smoke S1–S5 reported PASS. The medium findings cluster around (a) reconciliation metrics/provider pagination and (b) unbounded report aggregation + legacy-import quadratic lookups, plus two smoke-coverage gaps on audit persistence and finding-type classification.
