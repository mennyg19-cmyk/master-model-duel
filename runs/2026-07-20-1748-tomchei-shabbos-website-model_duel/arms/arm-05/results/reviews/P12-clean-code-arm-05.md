# P12 Clean-code Review — arm-05 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Scope:** files added or modified by P12 initial build
**Rule:** `arms/arm-05/.cursor/rules/clean-code.mdc`
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P12
**Reviewer:** clean-code specialist (blind — no model names)
**Verdict:** findings only — no fixes

## Files in scope

- `lib/reporting.ts` (new, 180 lines)
- `app/api/admin/reports/route.ts` (new, 47 lines)
- `app/api/admin/test-console/route.ts` (new, 37 lines)
- `app/admin/reports/page.tsx` (new, 85 lines)
- `app/admin/test-console/page.tsx` (new, 37 lines)
- `scripts/smoke-p12.ts` (new, 103 lines)
- `vercel.json` (modified — 5 cron registrations confirmed)
- `app/admin/layout.tsx` (modified — test/live banner added)

---

## Findings

### F1 — Duplicated `normalizeEmail` (third copy added)
**Severity:** medium
**Location:** `lib/reporting.ts:25`
**Claim:** "One pattern per concern" requires one email-normalization approach. A canonical `normalizeEmail` is already exported from `lib/foundation.ts:16` and imported by `lib/newsletter.ts`, `lib/order-builder.ts`, and `app/api/staff/route.ts`. P12 adds a third private copy in `lib/reporting.ts` instead of importing the existing one. `lib/admin-operations.ts:29` has a pre-existing second copy (P6) — P12 extends the drift rather than consolidating.
**Evidence:** `lib/foundation.ts:16` `export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }`; `lib/reporting.ts:25` `function normalizeEmail(email: string) { return email.trim().toLowerCase() || undefined; }`. Same logic, divergent null-handling, no shared source of truth.

### F2 — Duplicated `formatMoney` in reports page
**Severity:** low
**Location:** `app/admin/reports/page.tsx:8`
**Claim:** `formatMoney` is already exported from `lib/foundation.ts:7` and imported by 7+ admin/storefront pages (`operations/page.tsx:5`, `pos/page.tsx:5`, `checkout-flow.tsx:4`, `order-builder.tsx:4`, `catalog-grid.tsx:4`, `account-dashboard.tsx:5`, `repeat-order-review.tsx:4`). The new reports page re-declares it locally instead of importing, breaking the established pattern.
**Evidence:** `lib/foundation.ts:7` `export function formatMoney(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }`; `app/admin/reports/page.tsx:8` re-declares the identical body. Rule of 2 is satisfied (7 call sites) — the helper exists and should be reused.

### F3 — Duplicated address normalizer with divergent behavior
**Severity:** medium
**Location:** `lib/reporting.ts:29` vs `lib/order-builder.ts:66`
**Claim:** `Address` has `@@unique([customerId, normalizedAddress])` (`prisma/schema.prisma:378`). Two functions produce that key with different logic: `addressKey` (order-builder, private) includes `line2` and normalizes whitespace via `replace(/\s+/g, " ")`; `normalizeAddress` (reporting, P12) ignores `line2`, does no whitespace normalization, and hardcodes `"us"`. A legacy-imported address and a fresh storefront order for the same physical location can produce different `normalizedAddress` strings → duplicate `Address` rows. UR-014 (address-book cleanup) is the stated goal of this phase; the divergence works against it.
**Evidence:** `lib/order-builder.ts:73-76` joins `[line1, line2, city, state, postalCode, "US"]` filtered, trimmed, lowercased, whitespace-collapsed; `lib/reporting.ts:30` joins `[row.line1, row.city, row.state, row.postal_code, "us"]` trimmed+lowercased only. Same column, two keys.

### F4 — Duplicated `parseCsv` with divergent validation
**Severity:** medium
**Location:** `lib/reporting.ts:12` vs `lib/admin-operations.ts:33`
**Claim:** Two CSV parsers now live in the codebase. `admin-operations.parseCsv` (P6) is Zod-validated and typed per kind; `reporting.parseCsv` (P12) is loose (`Record<string, string>`), lowercases headers, and validates via ad-hoc `validateLegacyRows`. The plan lists "import pipeline for messy legacy export" (R-186) and "staged atomic CSV import" (R-063) as related deliverables — one parser should serve both, or the legacy one should explicitly extend the existing one.
**Evidence:** `lib/admin-operations.ts:33` `export function parseCsv(csv: string, kind: "customers" | "products")` uses `importRowSchema.safeParse`; `lib/reporting.ts:12` `function parseCsv(csv: string)` returns `{ rows: LegacyRow[], errors }` with no schema. Two parsers, two validation strictness levels, same concern.

### F5 — Duplicated phone normalization with divergent behavior
**Severity:** low
**Location:** `lib/reporting.ts:141,142` vs `lib/foundation.ts:20`
**Claim:** `normalizePhone` is exported from `lib/foundation.ts:20` as `phone.replace(/\D/g, "").replace(/^1/, "")` (strips leading country code). The legacy import inlines `row.phone?.replace(/\D/g, "")` twice — without the leading-1 strip — so imported phone numbers keep a leading `1` that the canonical normalizer would have removed. Same field, two normalizations → dedupe misses.
**Evidence:** `lib/foundation.ts:20` `export function normalizePhone(phone: string) { return phone.replace(/\D/g, "").replace(/^1/, ""); }`; `lib/reporting.ts:141` `phoneNormalized: row.phone?.replace(/\D/g, "") || null` and `:142` `phoneNormalized: row.phone?.replace(/\D/g, "") || undefined`.

### F6 — Mixed concerns in `lib/reporting.ts` (god-file)
**Severity:** medium
**Location:** `lib/reporting.ts` (180 lines, 6 concerns)
**Claim:** The clean-code rule "split files by concern, not by line count — split when mixed concerns" triggers on mixed concerns even under 500 lines. `lib/reporting.ts` owns: (a) multi-season performance report, (b) shipping-margin report + totals aggregation, (c) CSV export for three datasets, (d) Stripe orphan reconciliation, (e) legacy import staging, (f) legacy import atomic commit. The plan lists these as distinct deliverables (R-091 reports, R-092 exports, R-093 reconciliation, R-186 migration). A split along `lib/reporting/{performance,shipping-margin,exports,reconciliation,legacy-import}.ts` would let each concern be read and tested independently.
**Evidence:** `lib/reporting.ts:45-61` performanceReport; `:63-88` shippingMarginReport; `:90-107` exportCsv; `:109-119` runStripeReconciliation; `:121-129` stageLegacyImport; `:131-179` commitLegacyImport. Six separable concerns in one module.

### F7 — Mixed concerns in reports route (reports + exports + reconciliation + migration)
**Severity:** medium
**Location:** `app/api/admin/reports/route.ts` (whole file, 47 lines)
**Claim:** One route handles four distinct concerns: GET returns the report hub JSON (`performanceReport` + `shippingMarginReport` + audit history); GET with `?export=` returns CSV; POST `reconcile` runs Stripe reconciliation; POST `stage_legacy_import`/`commit_legacy_import` run legacy migration. A dedicated `app/api/admin/imports/route.ts` already exists for staged customer/product imports — the legacy import (which also stages and commits rows) should live there or in its own `legacy-import` route, not bolted onto the reports endpoint. Two import flows now live in two routes with overlapping concerns.
**Evidence:** `app/api/admin/reports/route.ts:7-11` discriminated union mixes `reconcile` with `stage_legacy_import`/`commit_legacy_import`; `:19-25` GET doubles as CSV export via `?export=`; `app/api/admin/imports/route.ts:7-10` already handles `stage`/`commit` for the other import flow.

### F8 — Unbounded `findMany` in all three report/export queries
**Severity:** medium
**Location:** `lib/reporting.ts:46-51`, `lib/reporting.ts:64-68`, `lib/reporting.ts:98`
**Claim:** The plan's G-024 baseline is 1,000+ orders / 5,000+ packages and P12 explicitly calls for "bounded, concurrency-aware list queries" and "indexes/query fixes as found." Three P12 queries have no `take` and load full tables into memory: `performanceReport` loads every finalized order across every season (deep select); `shippingMarginReport` loads every `ShipmentBox` with `include: { package: { include: { order: { include: { season: true } } } } }`; `exportCsv("item_sales")` loads every `OrderLine` with order+season includes. At the seeded 5k-package scale these are unbounded row loads plus N+1-shaped deep includes.
**Evidence:** `lib/reporting.ts:46` `prisma.season.findMany({ ... include: { orders: { where: { status: "FINALIZED" }, ... } } })` — no `take`; `:64` `prisma.shipmentBox.findMany({ ... orderBy: { createdAt: "desc" } })` — no `take`; `:98` `prisma.orderLine.findMany({ include: { order: { include: { season: true } } } })` — no `take`. Aggregation is then done in JS (`reduce` at `:57-58`, `:79-86`), not in the DB.

### F9 — `runStripeReconciliation` read-then-write race
**Severity:** low
**Location:** `lib/reporting.ts:113-115`
**Claim:** Anti-AI-tics bans "just-in-case code" and the codebase already uses idempotent `upsert` for the same dedupe pattern elsewhere. Here a `findFirst` is used to check whether a `stripe.reconciliation_flagged` audit row exists, then a separate `create` writes it if not. Two recon runs racing on the same orphan can both pass the `findFirst` and both `create`. The smoke S2 relies on the dedupe (`assert.equal(...count..., 1)`) but the implementation is racy, not idempotent.
**Evidence:** `lib/reporting.ts:113` `if (!await prisma.auditEvent.findFirst({ where: { action: "stripe.reconciliation_flagged", subjectId } })) { await prisma.auditEvent.create({ ... }) }`. A single `upsert` with `where: { action_subjectId: { ... } }` (or a unique constraint on `(action, subjectId)`) would remove the race.

### F10 — Sequential `await` in for-loop over reconciliation orphans
**Severity:** low
**Location:** `lib/reporting.ts:111-116`
**Claim:** `runStripeReconciliation` iterates orphaned PaymentIntents with `await` inside a `for` loop — one `findFirst` + one `create` per orphan, serially. Orphans should be rare in production, but the pattern is the same one flagged in P11 F11: no batching, no concurrency. At a messy migration boundary the orphan count can spike.
**Evidence:** `lib/reporting.ts:111` `for (const intent of orphaned) { ... await prisma.auditEvent.findFirst(...); await prisma.auditEvent.create(...); }`. A single `createMany` of the not-yet-flagged subjects (computed from one `findMany` of existing flags) would collapse N+N queries to 2.

### F11 — Sequential `await` in for-loop inside legacy commit transaction
**Severity:** low
**Location:** `lib/reporting.ts:137-174`
**Claim:** `commitLegacyImport` runs per-row `await transaction.customer.upsert`, `transaction.product.upsert`, `transaction.order.create` inside a `for...of` loop within a single `$transaction`. For a large legacy fixture (the plan calls out "messy legacy export" with potentially thousands of rows) this serializes every row. Some of this is inherent to transactional ordering, but customer/product upserts could be batched ahead of the order loop.
**Evidence:** `lib/reporting.ts:137` `for (const [index, row] of stage.rows.entries()) { ... await transaction.customer.upsert(...); ... await transaction.product.upsert(...); ... await transaction.order.create(...) }`. Same anti-pattern as P11 F11 (`sendCampaign`), now in the migration path.

### F12 — `marginCents` fallback is just-in-case code
**Severity:** low
**Location:** `lib/reporting.ts:76`
**Claim:** `ShipmentBox.marginCents` is `Int?` (`prisma/schema.prisma:720`) and is populated by P8's margin engine on label purchase. The report computes `shipment.marginCents ?? (chargedCents ?? 0) - (labelCostCents ?? 0)` — a fallback that re-derives the margin for rows where P8 should already have written it. Either the P8 invariant holds (drop the fallback) or it doesn't (fix P8 / backfill). Shipping the fallback hides the gap.
**Evidence:** `lib/reporting.ts:76` `marginCents: shipment.marginCents ?? (shipment.chargedCents ?? 0) - (shipment.labelCostCents ?? 0),`. The smoke S1 (`scripts/smoke-p12.ts:32`) always sets `marginCents: 400` explicitly, so the fallback path is never exercised in tests.

### F13 — Reports page over-fetches `totals` it never displays
**Severity:** low
**Location:** `app/api/admin/reports/route.ts:26-31`, `app/admin/reports/page.tsx:24`
**Claim:** Anti-AI-tics: "every line must have a reason." `shippingMarginReport()` returns `{ packages, totals }` and the GET ships both. The reports page only consumes `body.margins.packages` — `totals` is fetched and discarded. The plan calls for "season totals" in the margin report (UR-003 report); either display them or stop returning them.
**Evidence:** `lib/reporting.ts:87` `return { packages, totals };`; `app/api/admin/reports/route.ts:28` `shippingMarginReport()` returns both; `app/admin/reports/page.tsx:24` `setMargins(body.margins.packages)` — `body.margins.totals` is never read.

### F14 — Reports page re-declares return types instead of importing them
**Severity:** low
**Location:** `app/admin/reports/page.tsx:5-6`
**Claim:** Type/schema drift. `lib/reporting.ts` exports six functions and zero types. The reports page declares its own `Performance` and `Margin` types that approximate the lib's return shapes — but `Margin` omits `packageId` (which the lib returns at `lib/reporting.ts:71`) and `Performance` omits `seasonId` (lib `:53`). Any field added to the lib return silently falls out of the UI's type. The lib should export its return types (or the page should infer them via `Awaited<ReturnType<typeof performanceReport>>`).
**Evidence:** `app/admin/reports/page.tsx:5` `type Performance = { season: string; year: number; orders: number; grossCents: number; fulfillmentCents: number; paidOrders: number };` — no `seasonId`; `lib/reporting.ts:53` returns `seasonId: season.id`. `:6` `type Margin = { shipmentId: string; orderNumber: number | null; season: string; carrier: string; chargedCents: number; paidCents: number; marginCents: number };` — no `packageId`; `lib/reporting.ts:71` returns `packageId: shipment.packageId`.

### F15 — Magic value: 200+ char default CSV string inlined in `useState`
**Severity:** low
**Location:** `app/admin/reports/page.tsx:16`
**Claim:** The default `legacyCsv` state is a 3-row CSV fixture inlined as a single string literal inside a `useState` initializer. It is unreadable, hard to edit, and duplicates the header row that `lib/reporting.ts:51` (smoke fixture) and `lib/reporting.ts:12` (parser) both reference. A named constant (or a small `defaultLegacyCsv` export colocated with the parser) would make the contract between the textarea default and the parser explicit.
**Evidence:** `app/admin/reports/page.tsx:16` `useState("kind,year,email,first_name,last_name,sku,product_name,price_cents,total_cents,order_number,recipient_name,line1,city,state,postal_code\ncustomer,,legacy@example.test,Legacy,Customer,,,,,,,,,,\nproduct,2025,,,,LEGACY-BOX,Legacy Box,4200,,,,,,,\norder,2025,legacy@example.test,,,LEGACY-BOX,,,4200,1001,Legacy Customer,1 Archive Way,Brooklyn,NY,11201")`. The header must stay in sync with `lib/reporting.ts:37` (`row.kind`, `row.first_name`, etc.) by hand.

### F16 — Inconsistent staged-import storage key scheme
**Severity:** low
**Location:** `lib/reporting.ts:126,132,175` vs `lib/admin-operations.ts:26,75,82,123`
**Claim:** Two staged-import flows now use two different `appSetting` key namespaces for the same concept (a staged batch): `import.batch:${batchId}` (admin-operations, P6) and `legacy-import:${batchId}` (reporting, P12). Both store a `{ actorId, rows, errors, createdAt }` stage object, both read it back to commit, both delete on commit. A shared `importBatchKey(batchId)` helper (and a shared `StagedImport` shape) would make the two flows impossible to drift further.
**Evidence:** `lib/admin-operations.ts:26` `function importKey(batchId: string) { return \`import.batch:${batchId}\`; }`; `lib/reporting.ts:126` `await prisma.appSetting.create({ data: { key: \`legacy-import:${batchId}\`, value: stage } })`; `:132` `findUnique({ where: { key: \`legacy-import:${batchId}\` } })`; `:175` `delete({ where: { key: \`legacy-import:${batchId}\` } })`. Same pattern, two key namespaces, no shared helper.

---

## Summary counts

| Severity | Count |
|---|---|
| medium | 5 |
| low | 11 |
| high | 0 |
| **Total** | **16** |

**By category:**
- Pattern drift / one-pattern-per-concern: F1, F3, F4, F5, F7
- God file / mixed concerns: F6, F7
- Duplicated logic / ignored existing helper: F1, F2, F4, F5, F16
- Type/schema drift: F3, F5, F14
- Unbounded query / over-verbose at scale: F8
- Anti-pattern (read-then-write race): F9
- Sequential await in loop (perf pattern): F10, F11
- Anti-AI-tics / just-in-case code: F12, F13
- Magic value / readability: F15
- Naming / key-scheme inconsistency: F16

No high-severity findings. No naming violations from the banned list (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) observed in P12 code — `stage`, `entry`, `report`, `totals`, `packages` are all descriptive. No narration or change-explanation comments in the new code. The test-mode banner in `app/admin/layout.tsx:23` follows the existing layout pattern.
