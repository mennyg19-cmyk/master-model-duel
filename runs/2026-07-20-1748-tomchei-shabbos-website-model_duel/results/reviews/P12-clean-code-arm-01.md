# P12 Clean-code review — arm-01

**Reviewer specialist:** Clean-code
**Phase:** P12 (Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness)
**Tree reviewed:** `arms/arm-01/workspace/` — new/modified P12 files:
`src/domain/launch-exports.ts`, `src/domain/launch-reporting.ts`, `src/domain/legacy-import.ts`, `src/domain/stripe-reconciliation.ts`, `src/domain/test-console.ts`, `src/app/(admin)/admin/reports/page.tsx`, `src/components/launch-readiness-console.tsx`, and the new API routes under `src/app/api/admin/{exports,legacy-imports,legacy-imports/[batchId]/commit,reports,stripe-reconciliation,test-console,help}/route.ts` and `src/app/api/cron/stripe-reconciliation/route.ts`.
**Rule applied:** `arms/arm-01/.cursor/rules/clean-code.mdc` (focus: duplication, naming, god files, pattern drift, anti-AI-tics).
**Mode:** Findings only, no fixes. Blind to model identity.

---

## HIGH

### H1 — Competing HTTP response pattern (pattern drift)
All pre-existing admin API routes use `NextResponse.json` from `next/server` (e.g. `api/admin/customers/route.ts:2`, `api/admin/seasons/route.ts:2`, `api/admin/imports/route.ts:2`, `api/admin/imports/[batchId]/commit/route.ts:2`). Every new P12 route instead uses the global `Response.json`:
- `src/app/api/admin/exports/route.ts:17,21,48,58`
- `src/app/api/admin/legacy-imports/route.ts:65,83,86`
- `src/app/api/admin/legacy-imports/[batchId]/commit/route.ts:12,17,20`
- `src/app/api/admin/reports/route.ts:8,11`
- `src/app/api/admin/stripe-reconciliation/route.ts:26,29`
- `src/app/api/admin/test-console/route.ts:21,47,50,53`
- `src/app/api/admin/help/route.ts:14,29,32`
- `src/app/api/cron/stripe-reconciliation/route.ts:7,13`

Two response helpers for the same concern. Violates "one HTTP client / one response pattern per project."

### H2 — Control flow coupled to error-message text via regex
`src/app/api/admin/legacy-imports/[batchId]/commit/route.ts:19` chooses HTTP 409 by regex-matching the thrown `Error.message`:
```19:    if (error instanceof Error && /blocking|resumable/i.test(error.message)) {
```
`src/app/api/admin/test-console/route.ts:52` does the same:
```52:    if (error instanceof Error && /disabled outside/i.test(error.message)) {
```
HTTP status is derived from human-readable strings. Renaming a message changes routing. This diverges from the established typed-error pattern in `api/admin/imports/[batchId]/commit/route.ts:8` (`class ImportConflictError`) and the `AccessDeniedError` convention.

### H3 — Two sources of truth for the legacy document shape (type/schema drift)
`src/domain/legacy-import.ts:11-53` defines `LegacyAddress`, `LegacyCustomer`, `LegacyProduct`, `LegacyOrder`, `LegacyDocument` as the canonical types. `src/app/api/admin/legacy-imports/route.ts:6-58` re-declares the entire shape as an independent zod schema with no shared backing. The two already drift:
- Route allows empty `recipientName`, `line1`, `city` (`.max()` only, no `.min(1)`) while `inspectLegacyDocument` flags missing `displayName` (BLOCKING) and missing `city`/`postalCode` (REVIEW).
- Route permits `priceCents` to be any int (incl. negative is blocked only by `.int()`, no `.nonnegative()` on product — actually product schema omits `.nonnegative()`; order `totalCents` has it but product `priceCents` does not), while `inspectLegacyDocument:131-133` requires `priceCents >= 0`.
Validation lives in two layers that can evolve independently.

---

## MEDIUM

### M1 — `getExportRows` is a 5-branch god function
`src/domain/launch-exports.ts:34-162` handles `deliveries`, `year-end`, `year-metrics`, `item-sales`, `lapsed-customers` in one body — five distinct DB queries and five row-mapping shapes behind an if/else chain. Mixed concerns; each dataset should be its own function keyed off `ExportDataset`.

### M2 — Dataset list duplicated between domain and UI
`src/domain/launch-exports.ts:4-10` exports `exportDatasets`. `src/components/launch-readiness-console.tsx:162` re-types the same list as an inline literal:
```162:          {["deliveries", "year-end", "year-metrics", "item-sales", "lapsed-customers"].map(
```
Adding a dataset in the domain won't surface in the console. Drift.

### M3 — Repeated fetch→json→setMessage pattern in the console
`src/components/launch-readiness-console.tsx` repeats the same shape five times (`reconcile` 68-78, `stageLegacyImport` 80-105, `commitLegacyImport` 107-118, `testAction` 120-128, `completeTour` 130-138): `fetch` → `response.json()` → `setMessage(response.ok ? success : payload.error)`. Rule of 2 exceeded; extract a helper.

### M4 — Local money formatter duplicates `lib/currency.ts`
`src/app/(admin)/admin/reports/page.tsx:8-13` defines `dollars` with `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` (default 2 fraction digits). `src/lib/currency.ts:7` already exports `formatCurrency` with `minimumFractionDigits: 0`. Two formatters for the same concern, and they disagree on fraction digits — a silent display drift across screens.

### M5 — Test-console-enabled guard duplicated
`src/domain/test-console.ts:5-12` (`assertTestConsoleEnabled`) and `src/app/(admin)/admin/reports/page.tsx:87-90` inline the same `NODE_ENV !== "production" && ENABLE_TEST_AUTH === "true"` check. Two sources of truth for "is the test console available"; changing the rule requires edits in both.

### M6 — O(n²) recipient-name resolution in legacy commit
`src/domain/legacy-import.ts:388-395` resolves `recipientNameSnapshot` per order line via:
```388:                  recipientNameSnapshot: line.addressId
389:                    ? document.customers
390:                        .flatMap((customer) => customer.addresses ?? [])
391:                        .find((address) => address.id === line.addressId)
392:                        ?.recipientName
393:                    : document.customers.find(
394:                        (customer) => customer.id === sourceOrder.customerId,
395:                      )?.displayName,
```
A `flatMap`+`find` runs for every line of every order. Precompute an `addressId → recipientName` map alongside the existing `customerMap`/`addressMap`.

### M7 — Nesting depth exceeds the 3-level rule in `commitLegacyImport`
`src/domain/legacy-import.ts:215-437` reaches `transaction → for-order → lines.map → ternary/if` nesting (e.g. around 374-401), past the "more than 3 levels of nesting" threshold in `clean-code.mdc`. The per-line snapshot builder should be extracted.

### M8 — Recovering an index by splitting a composed ID string
`src/domain/test-console.ts:113`:
```113:    const orderIndex = Number(orderPackage.orderId.split("-").at(-1));
```
Parses `p12-scale-order-${index}` to recover `index`. Fragile — a prefix change silently breaks the join. Track `orderIndex` directly when building `packages` instead of round-tripping it through the ID.

### M9 — Inline fixture data in the component
`src/components/launch-readiness-console.tsx:5-54` embeds a ~50-line `sampleLegacyDocument` JSON literal inside the component module. Mixed concerns; fixture/sample data should live in its own module/constant.

---

## LOW

### L1 — Repeated magic cap `25_000`
`src/domain/launch-exports.ts:63,91,153` and the `25_000` caps in `api/admin/legacy-imports/route.ts:23,34,52` repeat the same limit literal. Named constant.

### L2 — `countDocument` / totals reduce computed twice
`src/domain/legacy-import.ts:68-82` (`countDocument`) and the `sourceTotals`/`importedTotals` reduce (lines 172-178 and 407-413) run the same logic in both `inspectLegacyDocument` and `commitLegacyImport`. Minor duplication.

### L3 — Misleading REVIEW message wording
`src/domain/legacy-import.ts:121`: message reads "Address needs city or postal-code review." (implies "or") but the condition at line 116 fires when **either** city or postalCode is missing. Wording drift.

### L4 — Provider intent fetch is unpaged; caps at 100
`src/domain/stripe-reconciliation.ts:14` calls `stripe.paymentIntents.list({ limit: 100 })` with no pagination loop. At the 5k-package scale this phase claims to harden, orphan intents beyond the first 100 are silently missed. Scale claim vs. implementation gap.

### L5 — `matchedCount` can undercount
`src/domain/stripe-reconciliation.ts:128` computes `matchedCount: storedIntents.length - findings.length`, but `findings` includes `ORPHAN_PROVIDER_INTENT` rows that are not from `storedIntents`. The metric is misleading and can go negative in shape. Misleading metric, not just style.

### L6 — Loose `outcome: unknown` and inconsistent response shape
`src/app/api/admin/test-console/route.ts:23,47` uses `let outcome: unknown` and returns `{ outcome }`, an inconsistent shape vs. other routes that return the entity directly. Loose typing.

### L7 — Single `message` string overwrites all action state
`src/components/launch-readiness-console.tsx:66` stores one `message` string overwritten on every action with no loading/error/loading distinction; concurrent or rapid actions clobber each other. Minor UX/consistency.

---

## Summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 9 |
| Low | 7 |
| **Total** | **19** |

No clean-code rule was found to be N/A; `clean-code.mdc` is in force for arm-01 and was applied. Findings are limited to P12 new/modified files; pre-existing files were consulted only as pattern baselines (H1, H2, M4).
