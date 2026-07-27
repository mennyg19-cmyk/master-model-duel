# P12 Rules Review — arm-05

Reviewer specialist: Rules (blind — no model names).
Scope: always-on rules adherence in P12 code (`lib/reporting.ts`, `app/api/admin/reports/`, `app/admin/reports/`, `app/api/admin/test-console/`, `app/admin/test-console/`, `scripts/smoke-p12.ts`, `vercel.json`, admin test-mode banner).
Rules graded: `workflow.mdc`, `vocabulary.mdc`, `codegraph.mdc`, `ponytail.mdc`, `clean-code.mdc` (all always-on).
Findings only — no fixes.

## Summary counts

- Critical: 1
- High: 4
- Medium: 5
- Low: 5
- Total: 15

## Findings

### C1 — Critical — UR-014 address cleanup not implemented
- **Location:** `lib/reporting.ts` lines 159-163 (commitLegacyImport address upsert); `prisma/schema.prisma` lines 359-380 (Address model).
- **Claim:** The P12 plan (`shared/MERGED-BUILD-PLAN.md` § P12, UR-014) requires an "address-book cleanup pass (dedupe, validation flags, staff review queue) so repeat-order works year one." The Address model has no validation-flag / needs-review / review-queue field, and the legacy importer silently creates addresses with placeholder strings whenever a column is missing.
- **Evidence:** `lib/reporting.ts:161` writes `line1: row.line1 || "Unknown"`, `city: row.city || "Unknown"`, `state: row.state || "NY"`, `postalCode: row.postal_code || "00000"` with no flag. `schema.prisma:359-380` defines Address with no review/flag column. The plan deliverable is missing entirely. Violates `workflow.mdc` ("Implement attached plans verbatim") and the expectation-file discipline ("expectation items must be observable").

### H1 — High — Duplicated `formatMoney` in reports page
- **Location:** `app/admin/reports/page.tsx` lines 8-10.
- **Claim:** A local `formatMoney` is defined byte-for-byte identical to the shared helper in `lib/foundation.ts:7-12`, which every other admin page imports.
- **Evidence:** `app/admin/operations/page.tsx:5`, `app/admin/pos/page.tsx:5`, `app/components/account-dashboard.tsx:5`, `app/components/order-builder.tsx:4`, `app/components/catalog-grid.tsx:4`, `app/components/checkout-flow.tsx:4`, `app/components/repeat-order-review.tsx:4`, `app/collections/page.tsx:2` all `import { formatMoney } from "@/lib/foundation"` (or via `@/lib/storefront`). The reports page is the lone outlier. Violates `clean-code.mdc` ("duplicated logic — pull into lib/ helpers"; "inconsistent patterns — pick one, apply everywhere") and `workflow.mdc` ("Read before edit -- reuse existing helpers, components, and patterns; don't introduce competing ones").

### H2 — High — Three drifting `normalizeEmail` implementations
- **Location:** `lib/reporting.ts` lines 25-27; `lib/foundation.ts` lines 16-18; `lib/admin-operations.ts` lines 29-31.
- **Claim:** `normalizeEmail` is reimplemented three times with subtly different behavior, instead of reusing the foundation helper.
- **Evidence:** `foundation.ts:16-18` returns `email.trim().toLowerCase()` (empty string stays `""`). `reporting.ts:25-27` returns `email.trim().toLowerCase() || undefined` (empty becomes `undefined`). `admin-operations.ts:29-31` accepts `string | undefined` and returns `email?.trim().toLowerCase()`. The P12 reporting copy is the only one that diverges on the empty-string contract. Violates `clean-code.mdc` ("type/schema drift — centralize, single source of truth"; "inconsistent patterns").

### H3 — High — Stripe reconciliation gated by wrong permission, not logged
- **Location:** `app/api/admin/reports/route.ts` line 35.
- **Claim:** The POST handler gates every action (reconcile, stage_legacy_import, commit_legacy_import) behind `imports.manage`. Reconciliation is a financial audit action, not an import. No `DECISION-LOG.md` exists in `arms/arm-05/workspace/` or `arms/arm-05/` to justify the choice.
- **Evidence:** `route.ts:35` `await authorize(request, "imports.manage")` covers the `reconcile` branch (line 41). `lib/permissions.ts:1-11` lists `orders.refund` as the available finance-adjacent permission; `imports.manage` is MANAGER-only and semantically about CSV staging. `workflow.mdc` ("Never silently choose business logic — log in DECISION-LOG.md and flag") is violated: the permission mapping was chosen silently.

### H4 — High — R-093 Stripe reconciliation cron missing
- **Location:** `vercel.json` lines 2-8; `app/api/cron/` (5 routes only).
- **Claim:** The plan (`§ P12`, R-093) calls for "Stripe payment reconciliation — run button + cron + matcher." Only the run button + matcher exist; the cron route is absent.
- **Evidence:** `vercel.json` registers 5 crons: `email-outbox`, `email-log-purge`, `pickup-expiry`, `payment-reminders`, `season-auto-flip`. None is a stripe-reconciliation cron. `scripts/smoke-p12.ts:81` asserts `(JSON.parse(vercel).crons).length === 5`, codifying the gap rather than catching it. Violates `workflow.mdc` ("Implement attached plans verbatim").

### M1 — Medium — S5 dress-rehearsal smoke not performed
- **Location:** `scripts/smoke-p12.ts` lines 69-82 (S5 block).
- **Claim:** PHASE-P12-EXPECTED.md S5 requires a "Full E2E with zero manual DB edits; nightly batch over 5k packages acceptable; wipe+reseed restores clean test season." The smoke script only asserts row counts and the cron total; it never runs the E2E flow.
- **Evidence:** `smoke-p12.ts:74-77` inserts 1000 orders + 5000 packages via `createMany`, then `assert.equal(count, 1000)` / `assert.equal(count, 5000)` and the cron-length assert. No web order, no payment, no print batch, no ship/deliver/pickup, no reroute, no reports-reconcile is exercised. Violates `workflow.mdc` ("Verify in the running app -- never mark done from code alone") and the expectation-file rule ("An item without evidence is unchecked").

### M2 — Medium — Test-console endpoint never exercised
- **Location:** `scripts/smoke-p12.ts` (whole file); `app/api/admin/test-console/route.ts`.
- **Claim:** The test-only seed/wipe/reset console is a P12 deliverable (R-101/R-103/R-129) and underpins S5's "wipe + reseed restores a clean test season," but no smoke test calls the route.
- **Evidence:** `rg` over `scripts/` finds zero references to `test-console`, `TEST_MODE`, or `wipeTestData` outside the route file itself. The destructive `TRUNCATE ... CASCADE` path (`route.ts:14-16`) and the `seed()` reset path run unverified. Violates `workflow.mdc` verification tier for features.

### M3 — Medium — CSV parser ignores quoted fields while exporter quotes them
- **Location:** `lib/reporting.ts` lines 12-23 (parseCsv) vs lines 7-10 (csvCell) / lines 90-107 (exportCsv).
- **Claim:** The legacy CSV importer splits on raw commas with no quote handling, but the export path quotes fields that contain commas, quotes, or newlines. A legacy source with `"Smith, John"` style values will mis-parse.
- **Evidence:** `parseCsv:15` `headers = lines[0].split(",")` and `parseCsv:18` `values = line.split(",")` — no `"` handling. `csvCell:8-9` wraps fields containing `[",\r\n]` in double quotes. The importer and exporter disagree on the CSV dialect. Violates `clean-code.mdc` ("one pattern per concern"; correctness).

### M4 — Medium — Legacy importer silently fills placeholder address data
- **Location:** `lib/reporting.ts` line 161.
- **Claim:** When an order row omits address columns, the importer writes literal `"Unknown"`, `"NY"`, `"00000"` instead of flagging the row for staff review, contradicting UR-014's validation-flags requirement.
- **Evidence:** `commitLegacyImport:161` `line1: row.line1 || "Unknown", city: row.city || "Unknown", state: row.state || "NY", postalCode: row.postal_code || "00000"`. `validateLegacyRows:40` checks order rows for `year`, `email`, `sku`, `total_cents` but not address fields. The result is silent data-quality loss with no review queue. Violates `workflow.mdc` ("Never silently choose business logic") and the UR-014 deliverable.

### M5 — Medium — Exports are not streamed
- **Location:** `lib/reporting.ts` lines 90-107 (exportCsv); `app/api/admin/reports/route.ts` lines 20-25.
- **Claim:** The plan smoke check (§ P12, R-092) calls for "large-result streaming." The implementation builds the entire CSV as one in-memory string and returns it.
- **Evidence:** `exportCsv:93-95`, `:99-101`, `:104-106` all end with `.join("\n")` over the full result set, then `route.ts:24` returns `new Response(csv, ...)`. For a 5k-package margin export this is one string; no `ReadableStream` / chunked write. Violates `workflow.mdc` ("Implement attached plans verbatim").

### L1 — Low — Test-mode guard relies on NODE_ENV being explicitly set
- **Location:** `app/api/admin/test-console/route.ts` lines 9-11.
- **Claim:** `isTestConsoleEnabled` returns true when `TEST_MODE === "true" && NODE_ENV !== "production"`. If `NODE_ENV` is unset, `undefined !== "production"` is true, so the destructive console is enabled in any deployment that forgets to set NODE_ENV.
- **Evidence:** `route.ts:10` `process.env.NODE_ENV !== "production"`. Defense-in-depth depends on the platform always setting NODE_ENV. Violates `workflow.mdc` ("Security Basics — least privilege by default").

### L2 — Low — `$queryRawUnsafe` with interpolated table names
- **Location:** `app/api/admin/test-console/route.ts` lines 14-16.
- **Claim:** The wipe path builds a `TRUNCATE TABLE ...` statement by interpolating table names from `pg_tables` into `$queryRawUnsafe`. The names are escaped and sourced from the DB, not user input, so it is safe today, but the pattern is fragile and a known SQL-injection vector if the source ever changes.
- **Evidence:** `route.ts:14-16` `await prisma.$queryRawUnsafe(...)` with `names` built from `tablename.replaceAll("\"", "\"\"")`. Violates `workflow.mdc` ("Sanitize user input in queries ... and shell commands") in spirit.

### L3 — Low — Test-console page swallows fetch errors
- **Location:** `app/admin/test-console/page.tsx` lines 10-14.
- **Claim:** The `useEffect` fetch has no `.catch()`. A network failure leaves `enabled=false` and `message=""`, so the user sees a disabled console with no explanation.
- **Evidence:** `page.tsx:10-14` `void fetch(...).then(async response => { ... })` — no `.catch()`. Violates `clean-code.mdc` ("No swallowed errors").

### L4 — Low — `performanceReport` reduces the same array twice
- **Location:** `lib/reporting.ts` lines 57-58.
- **Claim:** Two separate `.reduce` calls iterate `season.orders` for `grossCents` and `fulfillmentCents`; one pass would do.
- **Evidence:** `performanceReport:57` `season.orders.reduce((total, order) => total + order.totalCents, 0)` and `:58` `season.orders.reduce((total, order) => total + order.fulfillmentCents, 0)`. Violates `clean-code.mdc` ("No over-verbose code that does in 10 lines what could be done in 3").

### L5 — Low — Margin totals keyed by season name
- **Location:** `lib/reporting.ts` lines 79-86.
- **Claim:** The per-season totals accumulator is keyed by `entry.season` (the season name). Two seasons sharing a name would collide and sum together.
- **Evidence:** `shippingMarginReport:80` `const current = report[entry.season] ?? ...` and `:84` `report[entry.season] = current`. `entry.season` comes from `shipment.package?.order.season.name ?? "Unassigned"` (line 73). Keying by `seasonId` or `year` would be unambiguous. Violates `clean-code.mdc` (correctness; "one pattern per concern").
