# P12 Quality Review — arm-05 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Scope:** Reports + margin reconciliation, CSV exports, Stripe reconcile, legacy import dry-run/commit, dress rehearsal, EXPECTED S1–S5.
**Mode:** Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 9 |
| Low | 8 |
| **Total** | **18** |

Smoke S1–S5 are reported as passed in `PHASE-P12-SMOKE.md`. The findings below are correctness/robustness gaps the smoke does not cover, plus two cases where the smoke's "passed" claim overstates what was actually exercised relative to the EXPECTED definition.

---

## High

### H1 — Test-console wipe/reset throws on the post-wipe audit write (FK violation)
- **Location:** `app/api/admin/test-console/route.ts` `POST` (lines 26–37); `prisma/schema.prisma` `AuditEvent.actor` (line 126); `prisma/seed.ts` (no StaffUser created)
- **Claim:** `wipe` and `reset` call `wipeTestData()` which `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` every public table including `StaffUser`. The route then runs `prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, ... } })` referencing the just-deleted staff row. The `AuditEvent.actor` relation is optional with default referential action, but the FK constraint still validates on INSERT that `actorId` references an existing `StaffUser`. The insert fails, the route has no try/catch, so the operator gets an unhandled 500 after the data has already been wiped. The destructive action completes with no audit trail, and `reset` (the dress-rehearsal reset mechanism EXPECTED S5 relies on) is broken end-to-end.
- **Evidence:** `wipeTestData()` (lines 13–17) truncates all `pg_tables` public tables except `_prisma_migrations`; `seed.ts` creates no `StaffUser` (only a `Customer` clerk link at line 142); the audit write at line 35 uses `authorization.staffMember.id` resolved before the wipe. The smoke `smoke-p12.ts` never calls `/api/admin/test-console`, so this path is unverified despite the S5 "wipe+reseed restores clean test season" claim.

---

## Medium

### M1 — S5 smoke does not exercise the dress rehearsal, nightly batch at 5k, or wipe+reseed
- **Location:** `scripts/smoke-p12.ts` `verifySmoke` (lines 69–82); `arms/arm-05/workspace/.scratch/PHASE-P12-SMOKE.md` S5
- **Claim:** EXPECTED S5 is "Full E2E with zero manual DB edits; nightly batch over 5k packages acceptable; wipe+reseed restores clean test season." The smoke only `createMany`s 1000 orders + 5000 packages, asserts counts, and checks `vercel.json` has 5 cron entries. It does not run the nightly print batch over the 5k packages, does not run a web→pay→package→print→ship/deliver/pickup→reroute→reports E2E, and does not invoke the test-console wipe/reset. The "S5 passed" line in the smoke file is honest about what it tests, but `PHASE-P12-SMOKE.md` records S5 as passed against the full EXPECTED definition.
- **Evidence:** Lines 70–78 insert scale rows directly via `prisma.order.createMany` / `prisma.package.createMany`; lines 80–81 read `vercel.json` and assert `crons.length === 5`. No `runPrintBatch`, no route/driver/POS flow, no `/api/admin/test-console` call.

### M2 — No Stripe reconciliation cron despite EXPECTED "run button + cron + matcher"
- **Location:** `lib/reporting.ts` `runStripeReconciliation` (lines 109–119); `vercel.json` (lines 2–8); `app/api/cron/` (5 routes, none for Stripe)
- **Claim:** Plan §P12 and EXPECTED item 2 call for "Stripe payment reconciliation — run button + cron + matcher (R-093)." Only the run button (reports POST `reconcile`) and a naive matcher (find `StripePaymentIntent` rows with `paymentId: null`) exist. No cron endpoint is registered; `vercel.json` lists only email-outbox, email-log-purge, pickup-expiry, payment-reminders, season-auto-flip.
- **Evidence:** `Grep` for `stripe.*reconcil|reconciliation.*cron` matches only `lib/reporting.ts` and `scripts/smoke-p12.ts`; no route under `app/api/cron/` calls `runStripeReconciliation`.

### M3 — Address-book cleanup (UR-014) missing validation flags and staff review queue
- **Location:** `lib/reporting.ts` `commitLegacyImport` (lines 154–173); plan §P12 UR-014
- **Claim:** UR-014 requires "address-book cleanup pass (dedupe, validation flags, staff review queue) so repeat-order works year one." The legacy import only upserts addresses by `customerId_normalizedAddress` (dedupe by normalized line). There is no validation-flag column, no staff review queue, and no UI surface for ambiguous addresses. A messy legacy contact with a partial/ambiguous address is silently committed with `"Unknown"` / `"NY"` / `"00000"` defaults.
- **Evidence:** `Address` upsert at lines 159–163 fills missing `line1`/`city`/`state`/`postalCode` with hardcoded fallbacks; no `Address` field for review state; `Grep` for `review.queue|validationFlag|staffReview` returns no matches in the workspace.

### M4 — Permission mismatch: Stripe reconcile gated by `imports.manage`
- **Location:** `app/api/admin/reports/route.ts` `POST` (line 35); `lib/permissions.ts` (lines 1–14)
- **Claim:** The reports POST gates all three actions (`reconcile`, `stage_legacy_import`, `commit_legacy_import`) behind `imports.manage`. Stripe reconciliation is a payment/finance action, not an import. A finance manager with `orders.refund` but not `imports.manage` cannot run reconciliation; conversely a staff importer with `imports.manage` can run payment reconciliation. The permission model conflates two unrelated concerns.
- **Evidence:** Line 35 `authorize(request, "imports.manage")` is the only permission check before the `reconcile` branch at line 41. There is no `payments.reconcile` or `finance.read` permission in `lib/permissions.ts`.

### M5 — Shipping-margin season totals computed but not rendered
- **Location:** `lib/reporting.ts` `shippingMarginReport` (lines 79–87); `app/admin/reports/page.tsx` `load` (lines 19–25) and render (lines 71–74)
- **Claim:** EXPECTED item 1 calls for "shipping-margin reconciliation view (charged vs paid per package, season totals)." `shippingMarginReport` returns `{ packages, totals }` where `totals` aggregates charged/paid/margin per season. The reports page sets `margins` to `body.margins.packages` only and renders per-shipment rows; the `totals` object is discarded. Season totals are not visible to the operator.
- **Evidence:** `setMargins(body.margins.packages)` at line 24; the render block maps `margins` (an array of shipment rows) with no totals section. `body.margins.totals` is never read.

### M6 — Export audit history fetched but not displayed
- **Location:** `app/api/admin/reports/route.ts` `GET` (lines 26–31); `app/admin/reports/page.tsx` (no `exports` state)
- **Claim:** EXPECTED item 2 calls for "CSV export center + audit history." The API returns the last 20 `report.exported` audit events as `exports`, but the reports page never reads `body.exports` and has no state for it. The audit history exists in the payload and in the DB but is invisible in the UI.
- **Evidence:** Route returns `{ performance, margins, exports }` at line 31; the page only declares `performance` and `margins` state (lines 13–14) and never references `exports`.

### M7 — CSV exports are not streamed; entire payload built in memory
- **Location:** `lib/reporting.ts` `exportCsv` (lines 90–107); `app/api/admin/reports/route.ts` `GET` (line 24)
- **Claim:** EXPECTED S2 calls for "large-result streaming." `exportCsv` loads every `OrderLine` / `ShipmentBox` / `Season` row into memory, builds a single string via `.map().join("\n")`, and returns it as one `Response`. At the 1k-order / 5k-package scale the phase targets, item-sales and shipping-margin exports are unbounded and unpaginated.
- **Evidence:** `exportCsv("item_sales")` does `prisma.orderLine.findMany({ include: { order: { include: { season: true } } } })` with no `take`/cursor, then `.join("\n")` on the full array. No `ReadableStream`, no `TextEncoder`, no chunked response.

### M8 — Legacy import order-number collisions not detected at dry-run
- **Location:** `lib/reporting.ts` `validateLegacyRows` (lines 33–43) and `commitLegacyImport` (lines 154–172); `prisma/schema.prisma` `Order` `@@unique([seasonId, orderNumber])` (line 421)
- **Claim:** Legacy order rows carry `order_number` from the source system. The dry-run validator only checks structural fields (kind, email, sku, integer total). It does not check that `order_number` is unique within the target season or against existing finalized orders. A collision causes the `order.create` inside the transaction to throw on the `@@unique([seasonId, orderNumber])` constraint, aborting the whole atomic commit — including all the customer/product rows that would otherwise have succeeded.
- **Evidence:** `validateLegacyRows` (lines 33–43) has no uniqueness query; `commitLegacyImport` line 166 sets `orderNumber: Number(row.order_number) || null` and relies on the DB constraint. The plan risk note calls for "order-number repair" and "source-to-target reconciliation"; neither is present.

### M9 — CSV export center covers 3 of the 5 datasets named in the plan
- **Location:** `lib/reporting.ts` `exportCsv` (lines 90–107); plan §P12 R-092
- **Claim:** Plan §P12 lists the export center as "deliveries, year-end, year metrics, item sales, lapsed customers (R-092)." The implementation exposes only `year_metrics`, `shipping_margin`, and `item_sales`. Deliveries and lapsed-customers exports are absent. The reports UI links only to the three implemented datasets.
- **Evidence:** `datasets` const at `route.ts` line 13 is `["year_metrics", "shipping_margin", "item_sales"]`; the page (lines 69–74) links to those three only. No `deliveries` or `lapsed` branch in `exportCsv`.

---

## Low

### L1 — S1 smoke asserts only season 2026 despite "multi-season totals" claim
- **Location:** `scripts/smoke-p12.ts` (line 34); `.scratch/PHASE-P12-SMOKE.md` S1
- **Claim:** S1 is recorded as "multi-season totals ... matched the seeded ledger." The seed has two seasons (2025 archived, 2026 open), but the assertion only checks `performance.some(entry => entry.year === 2026 && entry.grossCents >= 5000)`. The 2025 season totals are returned by the report but never asserted.
- **Evidence:** Line 34 `assert.ok(performance.some((entry) => entry.year === 2026 && entry.grossCents >= 5000))` — no 2025 check.

### L2 — S2 smoke does not test unauthorized export rejection
- **Location:** `scripts/smoke-p12.ts` (lines 33–44); EXPECTED S2 "unauthorized rejected"
- **Claim:** EXPECTED S2 requires "unauthorized rejected." The smoke only generates CSVs and runs reconciliation; it never exercises the `orders.read` permission gate with a non-authorized staff member.
- **Evidence:** Lines 33–44 call `exportCsv` and `runStripeReconciliation` directly via the lib, bypassing the route's `authorize(request, "orders.read")` check.

### L3 — S3 smoke does not assert the `legacy_import.committed` audit event
- **Location:** `scripts/smoke-p12.ts` (lines 56–61); `.scratch/PHASE-P12-SMOKE.md` S3 ("audit evidence")
- **Claim:** S3 is recorded as "committed atomically with audit evidence." The smoke asserts the imported order exists and is `FINALIZED`, but never checks that a `legacy_import.committed` audit event was written.
- **Evidence:** Lines 59–61 assert `imported.status === "FINALIZED"`; no `prisma.auditEvent.count({ where: { action: "legacy_import.committed" } })`.

### L4 — Legacy import forces all orders to DELIVERY fulfillment
- **Location:** `lib/reporting.ts` `commitLegacyImport` (line 170)
- **Claim:** The legacy CSV has no fulfillment-method column. Every imported order is created with `fulfillmentMethod: { connect: { code: "DELIVERY" } }`. Historical pickup or shipping orders lose their original method, which affects repeat-order defaults in P10.
- **Evidence:** Line 170 hardcodes the DELIVERY connect; no `method` column in the fixture or `validateLegacyRows`.

### L5 — Staged legacy import batches never expire
- **Location:** `lib/reporting.ts` `stageLegacyImport` (lines 121–129); `commitLegacyImport` (line 175)
- **Claim:** A staged batch is stored in `AppSetting` under `legacy-import:${batchId}`. If the operator never commits (or the commit throws), the row persists forever. There is no TTL, no cleanup cron, and no list-and-cancel UI.
- **Evidence:** `prisma.appSetting.create` at line 126; the only delete is inside the commit transaction at line 175. No expiry sweep exists.

### L6 — Dry-run validation is structural only; referential integrity deferred to commit
- **Location:** `lib/reporting.ts` `validateLegacyRows` (lines 33–43)
- **Claim:** The plan risk note calls for "dry-run reports, human mapping for ambiguous rows, source-to-target reconciliation." `validateLegacyRows` only checks field presence and integer parsing. It does not verify the referenced season/customer/product will exist at commit, so a "clean" dry-run can still throw at commit time on `findUniqueOrThrow`.
- **Evidence:** Lines 33–43 contain no DB queries; `commitLegacyImport` lines 155–157 use `findUniqueOrThrow` for season/customer/product.

### L7 — `shippingMarginReport` folds orphaned shipments into "Unassigned" totals
- **Location:** `lib/reporting.ts` `shippingMarginReport` (lines 69–87)
- **Claim:** If a `ShipmentBox.package` was deleted (`packageId` is nullable, relation optional), `entry.season` falls back to `"Unassigned"` and its charged/paid/margin is added to a `"Unassigned"` total bucket shown to the operator with no signal that it represents orphaned rows.
- **Evidence:** Line 73 `season: shipment.package?.order.season.name ?? "Unassigned"`; the totals reducer (lines 79–86) keys on `entry.season` with no special-casing of `"Unassigned"`.

### L8 — Export audit `details` records only `{ dataset }`, no row count or byte size
- **Location:** `app/api/admin/reports/route.ts` `GET` (line 23)
- **Claim:** The `report.exported` audit event stores `{ dataset }` only. There is no row count, byte size, or recipient, limiting the usefulness of the audit history for reconciliation.
- **Evidence:** Line 23 `details: { dataset: exportDataset }` — no length/size capture before returning the response.
