# P12 Aggregate Review — arm-05 (blind)

Phase P12. Counts: blocker 2, major 19, minor 24, nit 3, total 48.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 2 |
| Major | 19 |
| Minor | 24 |
| Nit | 3 |
| Total | 48 |

Raw input totals: security 16, quality 18, rules 15, clean-code 16 = 65 findings -> 48 after dedupe (17 duplicates merged across 11 clusters).

Source tags: [S] security, [Q] quality, [R] rules, [C] clean-code.

Severity mapping: Critical/High-security -> blocker; High/Medium -> major; Low -> minor; Info/Nit -> nit.

---

## Prioritized fix list (single pass)

### Blocker - test-console wipe destroys setup lock + audit FK violation

1. **`wipeTestData()` truncates every public table including `StaffUser` and `AppSetting`, enabling re-bootstrap privilege escalation and breaking the post-wipe audit write** [S][Q] - `app/api/admin/test-console/route.ts:13-17,26-37`; `app/api/setup/route.ts:18-40`; `prisma/schema.prisma` `AuditEvent.actor` (line 126); `prisma/seed.ts`
   - Merged from security H1 + quality H1 + security L3. Three distinct gaps from one destructive operation: (a) `wipeTestData` builds `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` from `pg_tables` for the whole `public` schema, including `AppSetting` (which holds the `setup.completed` lock) and `StaffUser`. After a wipe, `/api/setup` no longer sees `setup.completed`, so any authenticated Clerk user — including one with no staff record — can POST to `/api/setup` and become the first MANAGER via `createFirstManager(authentication.userId, ...)`. The wipe is gated behind `settings.manage` + `TEST_MODE=true` + `NODE_ENV !== "production"`, but the post-wipe re-bootstrap is gated only by Clerk authentication (by design of first-run setup). A non-staff Clerk user could wait for (or social-engineer) a manager-initiated wipe, then race to re-bootstrap with their own Clerk ID. (b) The route then runs `prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, ... } })` referencing the just-deleted staff row; the `AuditEvent.actor` FK constraint validates on INSERT that `actorId` references an existing `StaffUser`, so the insert fails, the route has no try/catch, and the operator gets an unhandled 500 after the data has already been wiped. The destructive action completes with no audit trail, and `reset` (the dress-rehearsal reset mechanism EXPECTED S5 relies on) is broken end-to-end. (c) The same truncate destroys every prior staff action, import, export, reconciliation, and security event; the post-wipe `test_console.<action>` audit row is the only surviving trace. In test mode this destroys the evidence chain needed to investigate what was done before the wipe. Smoke `smoke-p12.ts` never calls `/api/admin/test-console`, so this path is unverified despite the S5 "wipe+reseed restores clean test season" claim. Preserve the setup lock and staff records across wipe (or block re-bootstrap after a wipe window), wrap the audit write in a try/catch that fails the wipe atomically, and retain or snapshot audit evidence before truncating.

### Blocker - UR-014 address cleanup not implemented; legacy importer silently writes placeholder data

2. **Address-book cleanup pass (dedupe, validation flags, staff review queue) required by UR-014 is entirely missing, and the legacy importer silently writes hardcoded placeholder strings for any missing address column** [Q][R] - `lib/reporting.ts:159-163` (commitLegacyImport address upsert); `prisma/schema.prisma:359-380` (Address model); plan §P12 UR-014
   - Merged from quality M3 + rules C1 + rules M4. UR-014 requires "address-book cleanup pass (dedupe, validation flags, staff review queue) so repeat-order works year one." The `Address` model has no validation-flag / needs-review / review-queue column, and no UI surface for ambiguous addresses exists. `commitLegacyImport` upserts addresses by `customerId_normalizedAddress` (dedupe by normalized line) and fills missing `line1`/`city`/`state`/`postalCode` with hardcoded fallbacks (`"Unknown"`, `"Unknown"`, `"NY"`, `"00000"`) instead of flagging the row for staff review. `validateLegacyRows` checks order rows for `year`, `email`, `sku`, `total_cents` but not address fields, so the result is silent data-quality loss with no review queue. A messy legacy contact with a partial/ambiguous address is silently committed with placeholder defaults, contradicting UR-014's validation-flags requirement and the plan's repeat-order goal. Violates `workflow.mdc` ("Implement attached plans verbatim"; "Never silently choose business logic") and the expectation-file discipline. Add an `Address` review-state column, a staff review queue, and stop writing placeholder strings for missing address fields.

### Major - Stripe reconciliation cron missing (R-093)

3. **R-093 calls for "Stripe payment reconciliation — run button + cron + matcher"; only the run button and a naive matcher exist, no cron route is registered** [Q][R] - `lib/reporting.ts:109-119` (`runStripeReconciliation`); `vercel.json:2-8`; `app/api/cron/` (5 routes, none for Stripe); `scripts/smoke-p12.ts:81`
   - Merged from quality M2 + rules H4. `vercel.json` registers only `email-outbox`, `email-log-purge`, `pickup-expiry`, `payment-reminders`, `season-auto-flip`. No route under `app/api/cron/` calls `runStripeReconciliation`. `scripts/smoke-p12.ts:81` asserts `(JSON.parse(vercel).crons).length === 5`, codifying the gap rather than catching it. Violates `workflow.mdc` ("Implement attached plans verbatim"). Add the cron route and update the smoke assertion.

### Major - Stripe reconciliation gated by `imports.manage`, not logged

4. **The reports POST gates `reconcile`, `stage_legacy_import`, and `commit_legacy_import` all behind `imports.manage`; reconciliation is a financial audit action, not an import, and no `DECISION-LOG.md` records the choice** [S][Q][R] - `app/api/admin/reports/route.ts:35,41`; `lib/permissions.ts:1-14`
   - Merged from security L2 + quality M4 + rules H3. A finance manager with `orders.refund` but not `imports.manage` cannot run reconciliation; conversely a staff importer with `imports.manage` can run payment reconciliation. No `payments.reconcile` or `finance.read` permission exists. `workflow.mdc` ("Never silently choose business logic — log in DECISION-LOG.md and flag") is violated: the permission mapping was chosen silently. Split the permission and document the choice.

### Major - unbounded report/export queries, no streaming

5. **All three report/export queries load full tables into memory with no `take`, no SQL aggregation, and no streaming; CSV export builds one in-memory string** [S][Q][R][C] - `lib/reporting.ts:45-107` (`performanceReport`, `shippingMarginReport`, `exportCsv`); `app/api/admin/reports/route.ts:20-25`
   - Merged from security M3 + security I4 + quality M7 + rules M5 + clean-code F8. `performanceReport` loads every `FINALIZED` order across every season (deep select) and reduces in JS; `shippingMarginReport` loads every `ShipmentBox` with nested `package → order → season`; `exportCsv("item_sales")` loads every `OrderLine` with order+season includes. None use `take`, cursor, SQL aggregation, or `ReadableStream`. `exportCsv` builds the entire CSV as one string via `.map().join("\n")` and returns it as one `Response`. At the P12 target of 1k orders / 5k packages (and beyond), a single request can OOM the server or hold long locks. Plan R-092 explicitly requires "large-result streaming." A staff member with `orders.read` (STAFF role default) can trigger each of these. Add `take`/cursor pagination or SQL aggregation, and stream CSV output via `ReadableStream`/chunked encoding.

### Major - duplicated `formatMoney` in reports page

6. **`formatMoney` is re-declared byte-for-byte in the reports page despite a canonical helper exported from `lib/foundation.ts` and imported by 7+ other pages** [R][C] - `app/admin/reports/page.tsx:8-10`; `lib/foundation.ts:7-12`
   - Merged from rules H1 + clean-code F2. Every other admin/storefront page imports `formatMoney` from `@/lib/foundation` (or `@/lib/storefront`): `operations/page.tsx:5`, `pos/page.tsx:5`, `checkout-flow.tsx:4`, `order-builder.tsx:4`, `catalog-grid.tsx:4`, `account-dashboard.tsx:5`, `repeat-order-review.tsx:4`, `collections/page.tsx:2`. The reports page is the lone outlier. Violates `clean-code.mdc` ("duplicated logic — pull into lib/ helpers"; "inconsistent patterns") and `workflow.mdc` ("reuse existing helpers, components, and patterns; don't introduce competing ones"). Import the shared helper.

### Major - three drifting `normalizeEmail` implementations

7. **`normalizeEmail` is reimplemented three times with subtly different behavior instead of reusing the foundation helper** [R][C] - `lib/reporting.ts:25-27`; `lib/foundation.ts:16-18`; `lib/admin-operations.ts:29-31`
   - Merged from rules H2 + clean-code F1. `foundation.ts:16-18` returns `email.trim().toLowerCase()` (empty string stays `""`). `reporting.ts:25-27` returns `email.trim().toLowerCase() || undefined` (empty becomes `undefined`). `admin-operations.ts:29-31` accepts `string | undefined` and returns `email?.trim().toLowerCase()`. The P12 reporting copy is the only one that diverges on the empty-string contract. Violates `clean-code.mdc` ("type/schema drift — centralize, single source of truth"; "inconsistent patterns"). Reuse the foundation helper and fix the empty-string contract at the call site.

### Major - duplicated address normalizer with divergent behavior

8. **Two address normalizers produce different `normalizedAddress` keys for the same physical location, undermining UR-014 dedupe** [C] - `lib/reporting.ts:29-30` vs `lib/order-builder.ts:66,73-76`; `prisma/schema.prisma:378` (`@@unique([customerId, normalizedAddress])`)
   - `Address` has `@@unique([customerId, normalizedAddress])`. `addressKey` (order-builder, private) includes `line2` and normalizes whitespace via `replace(/\s+/g, " ")`; `normalizeAddress` (reporting, P12) ignores `line2`, does no whitespace normalization, and hardcodes `"us"`. A legacy-imported address and a fresh storefront order for the same physical location can produce different `normalizedAddress` strings → duplicate `Address` rows. UR-014 (address-book cleanup) is the stated goal of this phase; the divergence works against it. Consolidate to one normalizer.

### Major - duplicated `parseCsv` with divergent validation

9. **Two CSV parsers now live in the codebase with different validation strictness for the same concern** [C] - `lib/reporting.ts:12-23` vs `lib/admin-operations.ts:33`
   - `admin-operations.parseCsv` (P6) is Zod-validated and typed per kind (`customers` | `products`); `reporting.parseCsv` (P12) is loose (`Record<string, string>`), lowercases headers, and validates via ad-hoc `validateLegacyRows`. The plan lists "import pipeline for messy legacy export" (R-186) and "staged atomic CSV import" (R-063) as related deliverables — one parser should serve both, or the legacy one should explicitly extend the existing one. Consolidate or extend.

### Major - mixed concerns in `lib/reporting.ts` (god-file)

10. **`lib/reporting.ts` owns six separable concerns in one 180-line module** [C] - `lib/reporting.ts` (180 lines)
    - The clean-code rule "split files by concern, not by line count — split when mixed concerns" triggers on mixed concerns even under 500 lines. The file owns: (a) multi-season performance report (`:45-61`); (b) shipping-margin report + totals aggregation (`:63-88`); (c) CSV export for three datasets (`:90-107`); (d) Stripe orphan reconciliation (`:109-119`); (e) legacy import staging (`:121-129`); (f) legacy import atomic commit (`:131-179`). The plan lists these as distinct deliverables (R-091 reports, R-092 exports, R-093 reconciliation, R-186 migration). A split along `lib/reporting/{performance,shipping-margin,exports,reconciliation,legacy-import}.ts` would let each concern be read and tested independently.

### Major - mixed concerns in reports route (reports + exports + reconciliation + migration)

11. **One route handles four distinct concerns: report hub JSON, CSV export, Stripe reconciliation, and legacy migration** [C] - `app/api/admin/reports/route.ts` (whole file, 47 lines)
    - The GET returns the report hub JSON (`performanceReport` + `shippingMarginReport` + audit history) and doubles as CSV export via `?export=`. The POST handles `reconcile` (Stripe reconciliation) plus `stage_legacy_import`/`commit_legacy_import` (legacy migration). A dedicated `app/api/admin/imports/route.ts` already exists for staged customer/product imports — the legacy import (which also stages and commits rows) should live there or in its own `legacy-import` route, not bolted onto the reports endpoint. Two import flows now live in two routes with overlapping concerns. Split the route.

### Major - CSV parser ignores quoted fields while exporter quotes them

12. **The legacy CSV importer splits on raw commas with no quote handling, but the export path quotes fields containing commas/quotes/newlines** [R] - `lib/reporting.ts:12-23` (parseCsv) vs `:7-10` (csvCell) / `:90-107` (exportCsv)
    - `parseCsv:15` `headers = lines[0].split(",")` and `parseCsv:18` `values = line.split(",")` — no `"` handling. `csvCell:8-9` wraps fields containing `[",\r\n]` in double quotes. The importer and exporter disagree on the CSV dialect. A legacy source with `"Smith, John"` style values will mis-parse. Violates `clean-code.mdc` ("one pattern per concern"; correctness). Implement RFC-4180 quoting in the parser, or share one CSV module.

### Major - S5 dress-rehearsal smoke not performed

13. **S5 is recorded as passed but the smoke never runs the E2E dress rehearsal, nightly batch over 5k packages, or wipe+reseed** [Q][R] - `scripts/smoke-p12.ts:69-82`; `arms/arm-05/workspace/.scratch/PHASE-P12-SMOKE.md` S5
    - Merged from quality M1 + rules M1. EXPECTED S5 is "Full E2E with zero manual DB edits; nightly batch over 5k packages acceptable; wipe+reseed restores clean test season." The smoke only `createMany`s 1000 orders + 5000 packages, asserts counts, and checks `vercel.json` has 5 cron entries. It does not run the nightly print batch over the 5k packages, does not run a web→pay→package→print→ship/deliver/pickup→reroute→reports E2E, and does not invoke the test-console wipe/reset. The "S5 passed" line in the smoke file is honest about what it tests, but `PHASE-P12-SMOKE.md` records S5 as passed against the full EXPECTED definition. Violates `workflow.mdc` ("Verify in the running app — never mark done from code alone") and the expectation-file rule ("An item without evidence is unchecked").

### Major - test-console endpoint never exercised by smoke

14. **The test-only seed/wipe/reset console (R-101/R-103/R-129) underpins S5 but no smoke test calls the route** [R] - `scripts/smoke-p12.ts` (whole file); `app/api/admin/test-console/route.ts`
    - `rg` over `scripts/` finds zero references to `test-console`, `TEST_MODE`, or `wipeTestData` outside the route file itself. The destructive `TRUNCATE ... CASCADE` path (`route.ts:14-16`) and the `seed()` reset path run unverified. Violates `workflow.mdc` verification tier for features. Add a smoke case that calls the test-console route.

### Major - legacy import overwrites existing customer data via upsert

15. **The legacy import customer branch uses `upsert` keyed by `emailNormalized` with an `update` path that silently overwrites existing customer name and phone** [S] - `lib/reporting.ts:139-143` (`commitLegacyImport`, customer branch)
    - `transaction.customer.upsert({ where: { emailNormalized: ... }, create: {...}, update: { firstName, lastName, phoneNormalized } })`. A legacy CSV row whose email matches an existing real customer will silently overwrite that customer's name and phone. There is no explicit "overwrite" audit entry — only `legacy_import.committed` with a row count. The stage phase only flags *duplicate CSV contacts* and *existing customers* as errors for the `customers` kind in `admin-operations.ts`, but the legacy migration path in `reporting.ts` performs no such pre-check and proceeds to overwrite on commit. Add a pre-check or an explicit overwrite audit entry.

### Major - legacy orders marked POSTED with no Payment row

16. **Imported legacy orders are created with `paymentStatus: "POSTED"` but no `Payment` record, inflating paid-order counts and breaking Stripe reconciliation** [S] - `lib/reporting.ts:164-172`
    - `transaction.order.create({ data: { ..., status: "FINALIZED", paymentStatus: "POSTED", ... } })` with no `payments: { create: ... }`. These orders inflate `paidOrders` in `performanceReport` (which counts `paymentStatus === "POSTED"`) and are invisible to Stripe reconciliation (no `StripePaymentIntent` to match). The financial reconciliation view (UR-003 report) and Stripe matcher (R-093) cannot distinguish imported-cash-equivalent orders from real paid orders. The smoke (S3) asserts the imported order is `FINALIZED` but never asserts a Payment exists. Add a `Payment` row (with a `legacy` source marker) or use a distinct `paymentStatus` for imported orders.

### Major - staged legacy PII persisted in `AppSetting` without TTL

17. **`stageLegacyImport` writes the entire parsed CSV (customer emails, names, addresses, order totals) into `AppSetting` with no expiry, no cleanup sweep, and no encryption at rest** [S][Q] - `lib/reporting.ts:121-128` (`stageLegacyImport`); `commitLegacyImport:175`
    - Merged from security M4 + quality L5. `prisma.appSetting.create({ data: { key: \`legacy-import:${batchId}\`, value: stage } })` where `stage.rows` is the full parsed CSV. The only delete is inside `commitLegacyImport`'s transaction; a never-committed batch (dry-run only, abandoned, or forgotten) leaves legacy PII sitting in the settings table indefinitely. Anyone with read access to `AppSetting` can harvest it. There is no TTL, no cleanup cron, and no list-and-cancel UI. Add an expiry sweep (or a TTL on staged batches) and a list/cancel UI.

### Major - shipping-margin season totals computed but not rendered

18. **`shippingMarginReport` returns `{ packages, totals }` but the reports page discards `totals` and renders only per-shipment rows** [Q][C] - `lib/reporting.ts:79-87`; `app/admin/reports/page.tsx:19-25,71-74`
    - Merged from quality M5 + clean-code F13. EXPECTED item 1 calls for "shipping-margin reconciliation view (charged vs paid per package, season totals)." `shippingMarginReport` returns `{ packages, totals }` where `totals` aggregates charged/paid/margin per season. The reports page sets `margins` to `body.margins.packages` only and renders per-shipment rows; `body.margins.totals` is never read. Season totals are not visible to the operator. Anti-AI-tics: "every line must have a reason." Either display the totals or stop returning them.

### Major - export audit history fetched but not displayed

19. **The API returns the last 20 `report.exported` audit events as `exports`, but the reports page never reads `body.exports` and has no state for it** [Q] - `app/api/admin/reports/route.ts:26-31`; `app/admin/reports/page.tsx` (no `exports` state)
    - EXPECTED item 2 calls for "CSV export center + audit history." The route returns `{ performance, margins, exports }` at line 31; the page only declares `performance` and `margins` state (lines 13-14) and never references `exports`. The audit history exists in the payload and in the DB but is invisible in the UI. Render the export history.

### Major - legacy import order-number collisions not detected at dry-run

20. **The dry-run validator does not check `order_number` uniqueness within the target season or against existing finalized orders; a collision aborts the whole atomic commit** [Q] - `lib/reporting.ts:33-43` (`validateLegacyRows`) and `:154-172` (`commitLegacyImport`); `prisma/schema.prisma` `Order` `@@unique([seasonId, orderNumber])` (line 421)
    - Legacy order rows carry `order_number` from the source system. `validateLegacyRows` (lines 33-43) has no uniqueness query; `commitLegacyImport` line 166 sets `orderNumber: Number(row.order_number) || null` and relies on the DB constraint. A collision causes the `order.create` inside the transaction to throw on `@@unique([seasonId, orderNumber])`, aborting the whole atomic commit — including all the customer/product rows that would otherwise have succeeded. The plan risk note calls for "order-number repair" and "source-to-target reconciliation"; neither is present. Detect collisions at dry-run and offer a repair mapping.

### Major - CSV export center covers 3 of the 5 datasets named in the plan

21. **Plan §P12 R-092 lists five export datasets; only `year_metrics`, `shipping_margin`, and `item_sales` are implemented; `deliveries` and `lapsed_customers` are absent** [Q] - `lib/reporting.ts:90-107` (`exportCsv`); `app/api/admin/reports/route.ts:13`; `app/admin/reports/page.tsx:69-74`; plan §P12 R-092
    - The `datasets` const at `route.ts:13` is `["year_metrics", "shipping_margin", "item_sales"]`; the page links to those three only. No `deliveries` or `lapsed` branch exists in `exportCsv`. The reports UI links only to the three implemented datasets. Implement the remaining two datasets or document the deferral.

### Minor - duplicated phone normalization with divergent behavior

22. **`normalizePhone` is exported from `lib/foundation.ts` but the legacy import inlines a divergent normalizer that keeps a leading `1`** [C] - `lib/reporting.ts:141,142` vs `lib/foundation.ts:20`
    - `foundation.ts:20` is `phone.replace(/\D/g, "").replace(/^1/, "")` (strips leading country code). The legacy import inlines `row.phone?.replace(/\D/g, "")` twice — without the leading-1 strip — so imported phone numbers keep a leading `1` that the canonical normalizer would have removed. Same field, two normalizations → dedupe misses. Reuse the foundation helper.

### Minor - margin/report data exposed to STAFF role via `orders.read`

23. **The reports GET (including shipping-margin reconciliation and CSV export) is gated by `orders.read`, which the STAFF role holds by default; margin data reveals carrier rates and margin strategy** [S] - `app/api/admin/reports/route.ts:15-31`; `lib/permissions.ts:17-21`
    - `authorize(request, "orders.read")` on the GET; `rolePermissions.STAFF = ["orders.read", "orders.write", "customers.read", "customers.write"]`. The margin report exposes per-package `chargedCents`, `paidCents` (carrier label cost), and `marginCents` — internal financial reconciliation data that reveals the org's negotiated carrier rates and margin strategy. This is more sensitive than order read access and arguably belongs behind `audit.read` (manager-only) or a dedicated `reports.read` permission. Split the permission.

### Minor - no audit trail for failed cron auth attempts

24. **`authorizeCron` returns a 401 on bearer mismatch with no audit record; probing of cron endpoints is silent** [S] - `lib/cron-auth.ts:10-13`
    - The function returns `NextResponse.json({ error: "Cron bearer authentication failed." }, { status: 401 })` with no `auditEvent.create` and no rate limit. There is no way to detect a sustained guessing campaign against `CRON_SECRET` from the audit log. Write an audit event for failed cron auth.

### Minor - export audit records lack detail and actor in UI list

25. **The `report.exported` audit event stores only `{ dataset }` — no row count, byte size, or query parameters — and the reports-page history query omits `actorId`** [S][Q] - `app/api/admin/reports/route.ts:23,29`; `lib/reporting.ts` export path
    - Merged from security L5 + quality L8. `auditEvent.create({ data: { actorId, action: "report.exported", subjectId: exportDataset, details: { dataset: exportDataset } } })` — no row count, byte size, or recipient. The list query `select: { id: true, action: true, subjectId: true, createdAt: true }` omits `actorId`, so the UI list does not show *who* ran an export. Staff must pivot to `/api/audit` (audit.read) to attribute an export. Weak audit trail for a financially sensitive action. Capture row count/byte size in `details` and include `actorId` in the list query.

### Minor - legacy import has no row-count cap

26. **The CSV body is capped at 1,000,000 characters but there is no row-count limit; a dense CSV can carry ~10k+ rows processed in one long transaction** [S] - `app/api/admin/reports/route.ts:9`; `lib/reporting.ts:136-178`
    - `z.string().min(1).max(1_000_000)` on the CSV; the commit loop `for (const [index, row] of stage.rows.entries())` with multiple `await transaction.*` per row inside one `prisma.$transaction`. At scale this can degrade the system or exhaust the connection pool — a DoS vector available to any manager. Add a row-count cap or batch the commit.

### Minor - `getStagedImportKind` reads staged PII before ownership check

27. **The imports commit path calls `getStagedImportKind(batchId)` which reads the full staged batch (including customer PII) before `commitImport` enforces `staged.actorId !== actorId`** [S] - `lib/admin-operations.ts:90-92`; `app/api/admin/imports/route.ts:23-25`
    - `getStagedImportKind` → `readStagedImport` → `prisma.appSetting.findUnique` returns the full `value` (the entire `StagedImport` including `rows`), then the route passes `kind` to `canWriteImportKind` and only later calls `commitImport` which checks ownership. The kind itself is low-sensitivity, but the read happens unconditionally. Only reachable by `imports.manage` (managers), so impact is low. Check ownership before reading the full batch.

### Minor - S1 smoke asserts only season 2026 despite "multi-season totals" claim

28. **S1 is recorded as "multi-season totals ... matched the seeded ledger" but the assertion only checks season 2026; 2025 totals are returned but never asserted** [Q] - `scripts/smoke-p12.ts:34`; `.scratch/PHASE-P12-SMOKE.md` S1
    - The seed has two seasons (2025 archived, 2026 open), but `assert.ok(performance.some((entry) => entry.year === 2026 && entry.grossCents >= 5000))` — no 2025 check. Add a 2025 assertion.

### Minor - S2 smoke does not test unauthorized export rejection

29. **EXPECTED S2 requires "unauthorized rejected" but the smoke bypasses the route's `orders.read` permission gate** [Q] - `scripts/smoke-p12.ts:33-44`; EXPECTED S2 "unauthorized rejected"
    - The smoke calls `exportCsv` and `runStripeReconciliation` directly via the lib, bypassing the route's `authorize(request, "orders.read")` check. Add a case that exercises the permission gate with a non-authorized staff member.

### Minor - S3 smoke does not assert the `legacy_import.committed` audit event

30. **S3 is recorded as "committed atomically with audit evidence" but the smoke never checks that a `legacy_import.committed` audit event was written** [Q] - `scripts/smoke-p12.ts:56-61`; `.scratch/PHASE-P12-SMOKE.md` S3 ("audit evidence")
    - Lines 59-61 assert `imported.status === "FINALIZED"`; no `prisma.auditEvent.count({ where: { action: "legacy_import.committed" } })`. Add the audit assertion.

### Minor - legacy import forces all orders to DELIVERY fulfillment

31. **The legacy CSV has no fulfillment-method column; every imported order is created with `fulfillmentMethod: { connect: { code: "DELIVERY" } }`** [Q] - `lib/reporting.ts:170`
    - Historical pickup or shipping orders lose their original method, which affects repeat-order defaults in P10. Add a `method` column to the legacy fixture and `validateLegacyRows`, or document the deferral.

### Minor - dry-run validation is structural only; referential integrity deferred to commit

32. **`validateLegacyRows` only checks field presence and integer parsing; a "clean" dry-run can still throw at commit time on `findUniqueOrThrow`** [Q] - `lib/reporting.ts:33-43`
    - The plan risk note calls for "dry-run reports, human mapping for ambiguous rows, source-to-target reconciliation." `validateLegacyRows` (lines 33-43) contains no DB queries; `commitLegacyImport` lines 155-157 use `findUniqueOrThrow` for season/customer/product. Add referential pre-checks to the dry-run.

### Minor - `shippingMarginReport` folds orphaned shipments into "Unassigned" totals

33. **If a `ShipmentBox.package` was deleted, the report folds its charged/paid/margin into an `"Unassigned"` total bucket with no signal that it represents orphaned rows** [Q] - `lib/reporting.ts:69-87`
    - Line 73 `season: shipment.package?.order.season.name ?? "Unassigned"`; the totals reducer (lines 79-86) keys on `entry.season` with no special-casing of `"Unassigned"`. An operator sees an `"Unassigned"` total with no explanation. Either filter orphaned rows out or label the bucket explicitly.

### Minor - test-mode guard relies on `NODE_ENV` being explicitly set

34. **`isTestConsoleEnabled` returns true when `TEST_MODE === "true" && NODE_ENV !== "production"`; if `NODE_ENV` is unset, `undefined !== "production"` is true, so the destructive console is enabled in any deployment that forgets to set `NODE_ENV`** [R] - `app/api/admin/test-console/route.ts:9-11`
    - Defense-in-depth depends on the platform always setting `NODE_ENV`. Violates `workflow.mdc` ("Security Basics — least privilege by default"). Fail closed: require `NODE_ENV === "test"` (or a positive non-production list) rather than `!== "production"`.

### Minor - `$queryRawUnsafe` with interpolated table names

35. **The wipe path builds a `TRUNCATE TABLE ...` statement by interpolating table names from `pg_tables` into `$queryRawUnsafe`; safe today but fragile** [R] - `app/api/admin/test-console/route.ts:14-16`
    - The names are escaped and sourced from the DB, not user input, so it is safe today, but the pattern is a known SQL-injection vector if the source ever changes. `route.ts:14-16` `await prisma.$queryRawUnsafe(...)` with `names` built from `tablename.replaceAll("\"", "\"\"")`. Violates `workflow.mdc` ("Sanitize user input in queries ... and shell commands") in spirit. Prefer a static table list or `Prisma.sql` tagged template.

### Minor - test-console page swallows fetch errors

36. **The `useEffect` fetch in the test-console page has no `.catch()`; a network failure leaves `enabled=false` and `message=""` with no explanation** [R] - `app/admin/test-console/page.tsx:10-14`
    - `void fetch(...).then(async response => { ... })` — no `.catch()`. Violates `clean-code.mdc` ("No swallowed errors"). Add a `.catch()` that surfaces the failure.

### Minor - `performanceReport` reduces the same array twice

37. **Two separate `.reduce` calls iterate `season.orders` for `grossCents` and `fulfillmentCents`; one pass would do** [R] - `lib/reporting.ts:57-58`
    - `performanceReport:57` `season.orders.reduce((total, order) => total + order.totalCents, 0)` and `:58` `season.orders.reduce((total, order) => total + order.fulfillmentCents, 0)`. Violates `clean-code.mdc` ("No over-verbose code that does in 10 lines what could be done in 3"). Combine into one reduce.

### Minor - margin totals keyed by season name

38. **The per-season totals accumulator is keyed by `entry.season` (the season name); two seasons sharing a name would collide and sum together** [R] - `lib/reporting.ts:79-86`
    - `shippingMarginReport:80` `const current = report[entry.season] ?? ...` and `:84` `report[entry.season] = current`. `entry.season` comes from `shipment.package?.order.season.name ?? "Unassigned"` (line 73). Keying by `seasonId` or `year` would be unambiguous. Violates `clean-code.mdc` (correctness; "one pattern per concern"). Key by `seasonId`.

### Minor - `runStripeReconciliation` read-then-write race

39. **A `findFirst` checks whether a `stripe.reconciliation_flagged` audit row exists, then a separate `create` writes it; two recon runs racing on the same orphan can both pass the check and both `create`** [C] - `lib/reporting.ts:113-115`
    - `if (!await prisma.auditEvent.findFirst({ where: { action: "stripe.reconciliation_flagged", subjectId } })) { await prisma.auditEvent.create({ ... }) }`. The smoke S2 relies on the dedupe (`assert.equal(...count..., 1)`) but the implementation is racy, not idempotent. A single `upsert` with `where: { action_subjectId: { ... } }` (or a unique constraint on `(action, subjectId)`) would remove the race.

### Minor - sequential `await` in for-loop over reconciliation orphans

40. **`runStripeReconciliation` iterates orphaned PaymentIntents with `await` inside a `for` loop — one `findFirst` + one `create` per orphan, serially** [C] - `lib/reporting.ts:111-116`
    - Orphans should be rare in production, but the pattern is the same one flagged in P11: no batching, no concurrency. At a messy migration boundary the orphan count can spike. A single `createMany` of the not-yet-flagged subjects (computed from one `findMany` of existing flags) would collapse N+N queries to 2.

### Minor - sequential `await` in for-loop inside legacy commit transaction

41. **`commitLegacyImport` runs per-row `await transaction.customer.upsert`, `transaction.product.upsert`, `transaction.order.create` inside a `for...of` loop within a single `$transaction`** [C] - `lib/reporting.ts:137-174`
    - For a large legacy fixture (the plan calls out "messy legacy export" with potentially thousands of rows) this serializes every row. Some of this is inherent to transactional ordering, but customer/product upserts could be batched ahead of the order loop. Same anti-pattern as P11 `sendCampaign`.

### Minor - `marginCents` fallback is just-in-case code

42. **`ShipmentBox.marginCents` is `Int?` populated by P8's margin engine on label purchase, but the report computes `shipment.marginCents ?? (chargedCents ?? 0) - (labelCostCents ?? 0)` — a fallback that re-derives the margin for rows where P8 should already have written it** [C] - `lib/reporting.ts:76`
    - Either the P8 invariant holds (drop the fallback) or it doesn't (fix P8 / backfill). Shipping the fallback hides the gap. The smoke S1 (`scripts/smoke-p12.ts:32`) always sets `marginCents: 400` explicitly, so the fallback path is never exercised in tests. Drop the fallback or assert the invariant.

### Minor - reports page re-declares return types instead of importing them

43. **The reports page declares its own `Performance` and `Margin` types that approximate the lib's return shapes, but `Margin` omits `packageId` and `Performance` omits `seasonId`; any field added to the lib return silently falls out of the UI's type** [C] - `app/admin/reports/page.tsx:5-6`; `lib/reporting.ts:53,71`
    - Type/schema drift. `lib/reporting.ts` exports six functions and zero types. The page declares `type Performance = { ... }` (no `seasonId`) and `type Margin = { ... }` (no `packageId`), while the lib returns `seasonId: season.id` (`:53`) and `packageId: shipment.packageId` (`:71`). The lib should export its return types (or the page should infer them via `Awaited<ReturnType<typeof performanceReport>>`).

### Minor - magic value: 200+ char default CSV string inlined in `useState`

44. **The default `legacyCsv` state is a 3-row CSV fixture inlined as a single string literal inside a `useState` initializer; it duplicates the header row that the parser references** [C] - `app/admin/reports/page.tsx:16`
    - The header must stay in sync with `lib/reporting.ts:37` (`row.kind`, `row.first_name`, etc.) by hand. A named constant (or a small `defaultLegacyCsv` export colocated with the parser) would make the contract between the textarea default and the parser explicit.

### Minor - inconsistent staged-import storage key scheme

45. **Two staged-import flows use two different `appSetting` key namespaces for the same concept: `import.batch:${batchId}` (admin-operations, P6) and `legacy-import:${batchId}` (reporting, P12)** [C] - `lib/reporting.ts:126,132,175` vs `lib/admin-operations.ts:26,75,82,123`
    - Both store a `{ actorId, rows, errors, createdAt }` stage object, both read it back to commit, both delete on commit. A shared `importBatchKey(batchId)` helper (and a shared `StagedImport` shape) would make the two flows impossible to drift further.

### Nit - `TEST_MODE` not in env schema or `.env.example`

46. **The test-mode banner and test-console both depend on `TEST_MODE`, but it is absent from `.env.example` and not validated by the `environmentSchema` in `lib/env.ts`** [S] - `.env.example`; `lib/env.ts:3-7`; `app/api/admin/test-console/route.ts:9-11`
    - Operators may misconfigure (typo, undocumented toggle). The `NODE_ENV !== "production"` guard in `isTestConsoleEnabled` provides defense-in-depth, but discoverability is poor. `.env.example` lists `CRON_SECRET`, `DEV_AUTH_MODE`, etc., but no `TEST_MODE`. `environmentSchema` only validates `DATABASE_URL` and Clerk keys. Add `TEST_MODE` to `.env.example` and the env schema.

### Nit - test-mode banner vs. test-console guard inconsistency

47. **The admin banner checks only `process.env.TEST_MODE === "true"`; the test-console API also requires `process.env.NODE_ENV !== "production"`** [S] - `app/admin/layout.tsx:23`; `app/api/admin/test-console/route.ts:9-11`
    - In a misconfigured production deploy with `TEST_MODE=true`, the banner would announce "TEST MODE · destructive controls are enabled" while the console API refuses (404). The banner is misleading but the controls remain safe. Align the two guards.

### Nit - cron secret length leak via short-circuit

48. **`authorizeCron` checks `expected.length === received.length` before `timingSafeEqual`; the early return leaks the secret length via timing** [S] - `lib/cron-auth.ts:9`
    - `const matches = Boolean(expected && received && expected.length === received.length && timingSafeEqual(expected, received));`. An attacker can learn the bearer length without ever matching content. Content remains protected by `timingSafeEqual`. Minor; standard pattern, but worth noting for a security-sensitive comparator. Pad or hash before comparing.

---

## Notes

- 2 blockers (test-console wipe chain; UR-014 address cleanup). 19 major. 24 minor. 3 nit. Total 48.
- 11 clusters merged (17 duplicates removed): (a) test-console wipe — S-H1 + Q-H1 + S-L3 (#1); (b) UR-014 address cleanup — Q-M3 + R-C1 + R-M4 (#2); (c) Stripe recon cron missing — Q-M2 + R-H4 (#3); (d) Stripe recon gated by `imports.manage` — S-L2 + Q-M4 + R-H3 (#4); (e) unbounded/streamed exports — S-M3 + S-I4 + Q-M7 + R-M5 + C-F8 (#5); (f) duplicated `formatMoney` — R-H1 + C-F2 (#6); (g) duplicated `normalizeEmail` — R-H2 + C-F1 (#7); (h) S5 dress-rehearsal smoke — Q-M1 + R-M1 (#13); (i) staged legacy PII no TTL — S-M4 + Q-L5 (#17); (j) margin totals not rendered — Q-M5 + C-F13 (#18); (k) export audit records lack detail — S-L5 + Q-L8 (#25).
- Cross-source overlap noted without merge: none beyond the clusters above.
- No new findings introduced during aggregation.


