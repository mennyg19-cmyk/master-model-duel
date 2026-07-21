# P12 Clean-Code Review — arm-03 (blind)

**Phase:** P12 — reports / exports / import / reconcile surface
**Scope:** `src/lib/ops/{reports,exports,import,reconcile}.ts`, `src/lib/payments/reconcile.ts`, `src/lib/exports/center.ts`, `src/app/api/admin/{reports,exports,imports,reconcile}/route.ts`, `src/app/api/admin/imports/prior-year-stub/route.ts`, `src/app/api/cron/{payment-reconcile,stripe-reconcile}/route.ts`, `src/components/admin/{reports,imports,exports,reconcile}-client.tsx`, `src/app/(admin)/admin/{reports,exports,imports,reconcile}/page.tsx`
**Posture:** Findings only — no fixes.

## Summary counts

| Category | Count |
|---|---|
| Duplication | 8 |
| Naming | 5 |
| God files | 1 |
| Pattern drift | 13 |
| Dead code | 2 |
| Type/schema drift | 3 |
| **Total** | **32** |

Severity legend: 🔴 high · 🟡 medium · 🟢 low.

---

## Duplication

### D1 🔴 Two parallel export libraries
- `src/lib/ops/exports.ts` — `runCsvExport`, `listExportAudits`, `buildDataset`. Used by `api/admin/exports/route.ts`.
- `src/lib/exports/center.ts` — `runExport`, `listExportHistory`, `rowsForDataset`. **No callers anywhere in `src/`** (see DC1).

Both files implement the same concern (CSV export over `ExportDataset`) with the same shape (`try` → build rows → `toCsv` → sha256 checksum → `exportAudit` + `writeAudit` in a `$transaction` → `ok`). Two sources of truth for one domain concept.

### D2 🔴 Two parallel reconcile libraries, both live
- `src/lib/ops/reconcile.ts` — `runPaymentReconcile`. Called by `api/admin/reconcile/route.ts` and `api/cron/payment-reconcile/route.ts`.
- `src/lib/payments/reconcile.ts` — `runPaymentReconciliation`. Called by `api/cron/stripe-reconcile/route.ts`.

Both create a `paymentReconcileRun`, iterate intents, detect orphans, write a `paymentReconcileAdjustment` with a fingerprint, then `writeAudit(RECONCILE_RUN)`. Two cron routes (`payment-reconcile`, `stripe-reconcile`) run the same job against the same tables on different schedules. This is the single biggest clean-code defect on the P12 surface.

### D3 🟡 `listReconcileRuns` defined twice with identical body
`src/lib/ops/reconcile.ts:159` and `src/lib/payments/reconcile.ts:255` both export `listReconcileRuns` with the same query shape (only difference: `adjustments: true` vs `adjustments: { take: 50, orderBy: { createdAt: "desc" } }`). Same name, two homes, divergent include shape.

### D4 🟡 `csvEscape` + `toCsv` duplicated verbatim
`src/lib/ops/exports.ts:8-18` and `src/lib/exports/center.ts:13-26`. The only difference is the line terminator (`\n` vs `\r\n` + BOM). No shared `lib/csv` helper.

### D5 🟡 `money(cents)` formatter duplicated 3+ times
`src/components/admin/reports-client.tsx:31`, `src/app/(admin)/admin/page.tsx`, `src/lib/email/order-emails.ts` all define `function money(cents) { return \`$${(cents / 100).toFixed(2)}\`; }`. No `lib/format/money.ts`.

### D6 🟡 Three `classify*Rows` in `import.ts` share the same skeleton
`classifyCustomerRows` (85), `classifyProductRows` (137), `classifyOrderRows` (196) all follow: `if (rows.length < 2) return []` → `headerMap(rows[0])` → `db.season.findFirst(...)` (where applicable) → loop → build `raw` → push `errors[]` → compute `targetKey` → `seen` Set duplicate check → `db.*.findFirst` existence check → push `StagedRow`. The skeleton is duplicated three times with field-level variations. Rule-of-2 is met twice over.

### D7 🟡 Three `commit*Row` in `import.ts` share the P2002 catch pattern
`commitCustomerRow` (347), `commitProductRow` (383), `commitOrderRow` (421) each wrap a `create` in `try/catch (createError) { if P2002 return "duplicate"; throw createError; }`. The first two are byte-identical blocks; the third does not catch P2002 (it throws `Product missing at commit` instead) — so the pattern is duplicated *and* inconsistently applied.

### D8 🟡 `reconcile/route.ts` GET inlines the `listReconcileRuns` query
`src/app/api/admin/reconcile/route.ts:11-18` hand-rolls `db.paymentReconcileRun.findMany({ orderBy, take: 20, include: { adjustments: true, staff } })` — the exact query `listReconcileRuns` (in both lib files) already provides. The route bypasses its own lib's helper.

---

## Naming

### N1 🔴 `runPaymentReconcile` vs `runPaymentReconciliation`
Two functions doing the same job, named differently, in two files (`lib/ops/reconcile.ts` vs `lib/payments/reconcile.ts`). Callers must remember which file exports which spelling. The cron routes even import different spellings for the same operation.

### N2 🟡 Export API naming drift
`runCsvExport` vs `runExport`; `listExportAudits` vs `listExportHistory`; `buildDataset` vs `rowsForDataset`. Same concept, three paired-name mismatches across the two export libs.

### N3 🟡 Adjustment `kind` string drift
`lib/ops/reconcile.ts:105` writes `kind: "ORPHANED_PAYMENT_INTENT"`; `lib/payments/reconcile.ts:113` writes `kind: "ORPHAN_PAYMENT_INTENT"`. One has the `-ED` suffix, the other does not. Same enum concept, two string literals — and neither is a typed constant, so the drift is invisible to the compiler.

### N4 🟡 Fingerprint scheme drift
`lib/ops/reconcile.ts:94` uses `fingerprint = \`orphan:${intent.stripePaymentIntentId}\`` (raw string). `lib/payments/reconcile.ts:15-20` uses `sha256("orphan_pi:" + id).slice(0,40)`. Two different fingerprint schemes for the same idempotency concept against the same unique column. A row written by one implementation will not be detected as a duplicate by the other.

### N5 🟡 Staff-id access pattern drift across admin routes
- `api/admin/imports/route.ts:23` — `staff.effectiveStaff.id`
- `api/admin/exports/route.ts:30` — `staff.effectiveStaff.id`
- `api/admin/reconcile/route.ts:35` — `staff.effectiveStaff.id`
- `api/admin/imports/prior-year-stub/route.ts:15` — `ctx.staff.id`

`requirePermission` returns a context whose staff id is reached two different ways inside the same P12 surface.

---

## God files

### G1 🔴 `src/lib/ops/import.ts` — 703 lines, 7 mixed concerns
One file holds: a hand-rolled CSV parser (`parseCsv`), header mapping (`headerMap`/`cell`), the `StagedRow` type, three row classifiers, three row committers, `stageImport` orchestration, `commitImport` orchestration with cursor/resume logic, and the `getImportBatch` reader. Per `clean-code.mdc` the >500-line + mixed-concerns threshold is crossed. Natural split: `lib/ops/import/csv.ts`, `lib/ops/import/classify/{customers,products,orders}.ts`, `lib/ops/import/commit/{customers,products,orders}.ts`, `lib/ops/import/stage.ts`, `lib/ops/import/commit.ts`.

---

## Pattern drift

### P1 🔴 Two reconcile implementations produce different result shapes
`lib/ops/reconcile.ts` `ReconcileResult.orphans[]` = `{ stripePaymentIntentId, orderId, amountCents, status }`. `lib/payments/reconcile.ts` `orphans[]` = `{ stripePaymentIntentId, amountCents }`. The admin UI (`reconcile-client.tsx`) only reads the first shape; the cron using the second shape returns less. One domain, two contracts.

### P2 🔴 Two export implementations emit different CSV columns for the same dataset
For `ExportDataset.DELIVERIES`:
- `lib/ops/exports.ts:42-49` → `route, sequence, recipient, status, orderNumber, deliveredAt`
- `lib/exports/center.ts:44-54` → `packageId, orderNumber, year, recipient, city, state, postal, method, stage`

For `SHIPPING_MARGIN` and `LAPSED_CUSTOMERS` the column sets also differ. A consumer switching between the two libs gets a different file for the same `dataset` enum value.

### P3 🟡 Default-case error handling diverges
`lib/ops/exports.ts:160-162` `buildDataset` default returns `{ headers: ["error"], rows: [["unknown dataset"]] }` — error-as-data, swallowed silently into the CSV. `lib/exports/center.ts:217-218` `rowsForDataset` default returns `{ headers: [], rows: [] }` — empty. Same unknown-dataset case, two different behaviors, neither signals `err(...)`.

### P4 🟡 `reports/route.ts` returns a redundant envelope
`api/admin/reports/route.ts:29-35` returns `{ ok, kind, seasons, totals, report: { seasons, totals } }`. The same `seasons` and `totals` are serialized twice. `reports-client.tsx:56` only reads `pj.seasons` and recomputes `totals` locally (line 64-69) — the server `totals` and `report` wrapper are dead bytes on the wire.

### P5 🟡 Zod schema placement inconsistent across admin routes
- `api/admin/exports/route.ts:18` — `postSchema` declared at module top, before `POST`.
- `api/admin/reconcile/route.ts:25` — `postSchema` declared at module top.
- `api/admin/imports/route.ts:8` — `stageSchema` at top, but `commitSchema:53` interleaved *between* `POST` and `PATCH` handlers.

Same surface, two conventions for where schemas live.

### P6 🟢 `reconcile/route.ts` POST has a single-value `action` enum
`api/admin/reconcile/route.ts:25-27` — `z.object({ action: z.enum(["run"]).default("run") })`. The field has exactly one legal value with a default; the schema validates nothing meaningful and the `action` is never read after parse. Indirection without effect.

### P7 🟢 `reports/route.ts` `kind` param unvalidated
`api/admin/reports/route.ts:10` — `const kind = url.searchParams.get("kind") ?? "performance"`; only `=== "margin"` is branched, everything else silently falls through to performance. No 400 on unknown `kind`. Compare to `exports/route.ts` which uses `z.nativeEnum(ExportDataset)` for the equivalent concept.

### P8 🟡 `reports-client.tsx` redefines lib types with drift
`reports-client.tsx:6-29` defines local `SeasonRow` (no `slug`) and `MarginReport` (no `seasonId`, no `orderId` on packages) that mirror `lib/ops/reports.ts` `SeasonPerformance` and `MarginReport`. The lib types exist and are exported; the client hand-copies a subset. See T1.

### P9 🟡 `imports-client.tsx` redefines `ImportKind` as string literals
`imports-client.tsx:29` — `useState<"CUSTOMERS" | "PRODUCTS" | "ORDERS">`. The `ImportKind` prisma enum already exists and is used by the route. The client re-declares the union and casts (`as "CUSTOMERS" | "PRODUCTS" | "ORDERS"`) on every change. If the enum gains a value, the client silently drops it.

### P10 🟡 `exports-client.tsx` `DATASETS` literal duplicates `ExportDataset` enum
`exports-client.tsx:6-13` — a `const DATASETS = ["DELIVERIES", ...] as const`. The `ExportDataset` prisma enum is the source of truth; this array will drift if the enum changes. The route already validates with `z.nativeEnum(ExportDataset)`, so the client list is decorative duplication.

### P11 🟡 Test fixtures embedded in production component
`imports-client.tsx:21-26` — `MESSY_ORDERS` CSV fixture (with `ABC-broken`, `bad-email`, `MISSING-SKU` rows) is a module-level constant in the shipped client bundle. `imports-client.tsx:31-33` — the default `csvText` state is also a seeded fixture (`Valid Import`, `Dup Import`, `Bad Row`). These belong in `scripts/` or a test seed, not in the admin UI bundle.

### P12 🟢 `ReconcileResult` has redundant fields
`lib/ops/reconcile.ts:14-17` — `adjustedCount` and `createdAdjustments` are both returned and set to the same value (`createdAdjustments` at line 57, `adjustedCount: createdAdjustments` at line 149). Two names for one number.

### P13 🟢 `reports-client.tsx` error paths leave stale state
`reports-client.tsx:48-55` — on `!p.ok` or `!m.ok` the function returns without clearing `seasons` / `margin`. A failed refresh after a successful load leaves the old data on screen with no indication that it is stale (only `error` is set).

---

## Dead code

### DC1 🔴 `src/lib/exports/center.ts` is unreachable
`grep` across `src/` finds zero importers of `@/lib/exports/center`, `runExport`, or `listExportHistory`. The entire 288-line file (csv helpers, `rowsForDataset`, `runExport`, `listExportHistory`) duplicates `lib/ops/exports.ts` and is never called. Per `clean-code.mdc`: delete, don't comment out.

### DC2 🟢 `reports/route.ts` response fields `totals` and `report` are unused
See P4 — the client never reads `totals` or `report` from the performance response. They are serialized on every request for nothing.

---

## Type / schema drift

### T1 🟡 `MarginReport` type split across lib and client
`lib/ops/reports.ts:20-34` `MarginReport.packages[]` = `{ packageId, orderId, chargedCents, purchasedCents, marginCents, carrier }`. `reports-client.tsx:22-28` `MarginReport.packages[]` = `{ packageId, chargedCents, purchasedCents, marginCents, carrier }` — `orderId` dropped. The client type is a subset copy; the lib type is exported and available.

### T2 🔴 Two reconcile result types for one domain
`lib/ops/reconcile.ts` `ReconcileResult` vs `lib/payments/reconcile.ts` inline return type — different field sets (`adjustedCount`+`createdAdjustments` vs only `adjustedCount`; `orphans[].orderId`+`status` vs neither). One domain, two contracts, both live (see P1).

### T3 🟡 Client-side enum redefinitions
`ImportKind` (P9) and `ExportDataset` (P10) are both re-declared as string-literal unions / arrays in the clients instead of importing the prisma enum. Two sources of truth per enum.

---

## Notes

- The `lib/ops` vs `lib/payments` / `lib/exports` split suggests an earlier refactor was started (ops/) and not finished — the old homes still exist, the new ones are wired, and one old home (`lib/exports/center.ts`) lost all callers while another (`lib/payments/reconcile.ts`) kept its cron. The P12 surface is mid-migration.
- No fixes applied. File not modified.
