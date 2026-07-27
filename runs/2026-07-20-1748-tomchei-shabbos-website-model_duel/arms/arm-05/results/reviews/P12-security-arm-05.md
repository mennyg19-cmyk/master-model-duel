# P12 Security Review — arm-05 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Scope:** export authz, margin/report data exposure, import blast radius, wipe/reseed authz, cron auth, test-mode banner safety
**Method:** Findings only — no fixes. P12 scope only.
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P12; `shared/phases/PHASE-P12-EXPECTED.md`

## Summary counts

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 4 |
| Low | 7 |
| Informational | 4 |
| **Total** | **16** |

---

## High

### H1 — Wipe destroys setup lock → re-bootstrap privilege escalation (test mode)

- **Location:** `app/api/admin/test-console/route.ts:13-17` (`wipeTestData`), `app/api/setup/route.ts:18-40`
- **Claim:** `wipeTestData()` truncates every table in `public` except `_prisma_migrations`, including `AppSetting` (which holds the `setup.completed` lock) and `StaffUser`. After a wipe, `/api/setup` no longer sees `setup.completed`, so any authenticated Clerk user — including one with no staff record — can POST to `/api/setup` and become the first MANAGER. The wipe itself is gated behind `settings.manage` + `TEST_MODE=true` + `NODE_ENV !== "production"`, but the post-wipe re-bootstrap is gated only by Clerk authentication (no staff permission required by design of the first-run setup).
- **Evidence:** `wipeTestData` builds `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE` from `pg_tables` for the whole `public` schema; `commitLegacyImport`/`createFirstManager` rely on `setup.completed` in `AppSetting` to lock bootstrap; `setup/route.ts` POST calls `createFirstManager(authentication.userId, ...)` after `canBootstrap()` returns true. In test mode, a non-staff Clerk user could wait for (or social-engineer) a manager-initiated wipe, then race to re-bootstrap with their own Clerk ID.
- **Precondition:** TEST_MODE=true and non-production NODE_ENV (test/dev only). Production is protected by the `isTestConsoleEnabled` guard, but the setup-lock destruction is still a defense-in-depth gap.

---

## Medium

### M1 — Legacy import overwrites existing customer data via upsert

- **Location:** `lib/reporting.ts:139-143` (`commitLegacyImport`, customer branch)
- **Claim:** The customer branch uses `customer.upsert` keyed by `emailNormalized` with an `update` path that mutates `firstName`, `lastName`, and `phoneNormalized`. A legacy CSV row whose email matches an existing real customer will silently overwrite that customer's name and phone. There is no explicit "overwrite" audit entry — only `legacy_import.committed` with a row count.
- **Evidence:** `transaction.customer.upsert({ where: { emailNormalized: ... }, create: {...}, update: { firstName, lastName, phoneNormalized } })`. The stage phase only flags *duplicate CSV contacts* and *existing customers* as errors for the `customers` kind in `admin-operations.ts`, but the legacy migration path in `reporting.ts` performs no such pre-check and proceeds to overwrite on commit.

### M2 — Legacy orders marked POSTED with no Payment row

- **Location:** `lib/reporting.ts:164-172`
- **Claim:** Imported legacy orders are created with `status: "FINALIZED"` and `paymentStatus: "POSTED"` but no `Payment` record is ever written. These orders inflate `paidOrders` in `performanceReport` (which counts `paymentStatus === "POSTED"`) and are invisible to Stripe reconciliation (no `StripePaymentIntent` to match). The financial reconciliation view (UR-003 report) and Stripe matcher (R-093) cannot distinguish imported-cash-equivalent orders from real paid orders.
- **Evidence:** `transaction.order.create({ data: { ..., status: "FINALIZED", paymentStatus: "POSTED", ... } })` with no `payments: { create: ... }`. `runStripeReconciliation` only scans `stripePaymentIntent` rows. The smoke (S3) asserts the imported order is `FINALIZED` but never asserts a Payment exists.

### M3 — Unbounded report queries — full-table scans, no streaming

- **Location:** `lib/reporting.ts:45-107` (`performanceReport`, `shippingMarginReport`, `exportCsv`)
- **Claim:** `performanceReport` loads every `FINALIZED` order with `totalCents`/`fulfillmentCents`/`paymentStatus` into Node memory to compute sums in JS. `shippingMarginReport` loads every `ShipmentBox` with nested `package → order → season`. `exportCsv("item_sales")` loads every `OrderLine` with nested `order → season`. None of these use SQL aggregation, pagination, or streaming. At the P12 target of 1k orders / 5k packages (and beyond), a single request can OOM the server or hold long locks. Plan R-092 explicitly requires "large-result streaming."
- **Evidence:** `prisma.season.findMany({ include: { orders: { where: { status: "FINALIZED" }, select: {...} } } })` then `season.orders.reduce(...)`; `prisma.orderLine.findMany({ include: { order: { include: { season: true } } } })` returning the full table. A staff member with `orders.read` (STAFF role default) can trigger each of these.

### M4 — Staged legacy PII persisted in appSetting without TTL

- **Location:** `lib/reporting.ts:121-128` (`stageLegacyImport`)
- **Claim:** `stageLegacyImport` writes the entire parsed CSV — customer emails, names, addresses, order totals — into the `AppSetting` table under `legacy-import:<batchId>` as JSON. There is no expiry, no cleanup sweep, and no encryption at rest. A staged batch that is never committed (dry-run only, abandoned, or forgotten) leaves legacy PII sitting in the settings table indefinitely. Anyone with read access to `AppSetting` (e.g., DB-level access, or any future route that lists settings) can harvest it.
- **Evidence:** `prisma.appSetting.create({ data: { key: \`legacy-import:${batchId}\`, value: stage } })` where `stage.rows` is the full parsed CSV. The only delete is inside `commitLegacyImport`'s transaction; a never-committed batch is never removed.

---

## Low

### L1 — Margin/report data exposed to STAFF role via `orders.read`

- **Location:** `app/api/admin/reports/route.ts:15-31`, `lib/permissions.ts:17-21`
- **Claim:** The reports GET (including the shipping-margin reconciliation view and the shipping-margin CSV export) is gated by `orders.read`, which the STAFF role holds by default. The margin report exposes per-package `chargedCents`, `paidCents` (carrier label cost), and `marginCents` — internal financial reconciliation data that reveals the org's negotiated carrier rates and margin strategy. This is more sensitive than order read access and arguably belongs behind `audit.read` (manager-only) or a dedicated `reports.read` permission.
- **Evidence:** `authorize(request, "orders.read")` on the GET; `rolePermissions.STAFF = ["orders.read", "orders.write", "customers.read", "customers.write"]`. A STAFF user can fetch `/api/admin/reports?export=shipping_margin` and read every carrier margin.

### L2 — Stripe reconciliation gated by `imports.manage`

- **Location:** `app/api/admin/reports/route.ts:34-41`
- **Claim:** The `reconcile` action is mounted under the same `imports.manage` permission as `stage_legacy_import` / `commit_legacy_import`. Reconciliation is a read/audit action that writes audit events but does not mutate financial state; coupling it to the import permission is a least-privilege smell. A manager who can import can also run reconciliation (fine), but a role with `audit.read` cannot trigger reconciliation despite it being an audit-adjacent action.
- **Evidence:** The whole POST handler requires `imports.manage` before dispatching on `action`; `reconcile` shares the gate with the import actions.

### L3 — Wipe destroys all historical audit evidence

- **Location:** `app/api/admin/test-console/route.ts:13-17,33-35`
- **Claim:** `wipeTestData` truncates `AuditEvent` along with everything else. The post-wipe `test_console.<action>` audit row is the only surviving trace; every prior staff action, import, export, reconciliation, and security event is gone. In test mode this destroys the evidence chain needed to investigate what was done before the wipe.
- **Evidence:** `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE` over all public tables; `auditEvent.create` runs *after* `wipeTestData`/`seed`, so only the new row survives.

### L4 — No audit trail for failed cron auth attempts

- **Location:** `lib/cron-auth.ts:10-13`
- **Claim:** `authorizeCron` returns a 401 on bearer mismatch with no audit record. Probing of cron endpoints (brute-force attempts, scanner noise) is silent. There is no way to detect a sustained guessing campaign against `CRON_SECRET` from the audit log.
- **Evidence:** The function returns `NextResponse.json({ error: "Cron bearer authentication failed." }, { status: 401 })` with no `auditEvent.create` and no rate limit.

### L5 — Export audit records lack detail and actor in UI list

- **Location:** `app/api/admin/reports/route.ts:23,29`
- **Claim:** The `report.exported` audit event stores only `subjectId` (dataset name) in `details: { dataset }` — no row count, no query parameters. The reports-page history query selects `id, action, subjectId, createdAt` and omits `actorId`, so the UI list does not show *who* ran an export. Staff must pivot to `/api/audit` (audit.read) to attribute an export. Weak audit trail for a financially sensitive action.
- **Evidence:** `auditEvent.create({ data: { actorId, action: "report.exported", subjectId: exportDataset, details: { dataset: exportDataset } } })`; the list query `select: { id: true, action: true, subjectId: true, createdAt: true }` — no `actorId`.

### L6 — Legacy import has no row-count cap

- **Location:** `app/api/admin/reports/route.ts:9`, `lib/reporting.ts:136-178`
- **Claim:** The CSV body is capped at 1,000,000 characters but there is no row-count limit. A dense CSV can carry ~10k+ rows. `commitLegacyImport` processes every row in a single `$transaction` with per-row `await`s (upserts, finds, creates), holding locks and a long-lived transaction. At scale this can degrade the system or exhaust the connection pool — a DoS vector available to any manager.
- **Evidence:** `z.string().min(1).max(1_000_000)` on the CSV; the commit loop `for (const [index, row] of stage.rows.entries())` with multiple `await transaction.*` per row inside one `prisma.$transaction`.

### L7 — `getStagedImportKind` reads staged PII before ownership check

- **Location:** `lib/admin-operations.ts:90-92`, `app/api/admin/imports/route.ts:23-25`
- **Claim:** The imports commit path calls `getStagedImportKind(batchId)` to derive the kind for permission re-check. This reads the full staged batch (which for `customers` contains customer names/emails/phones) before `commitImport` enforces `staged.actorId !== actorId`. The kind itself is low-sensitivity, but the read happens unconditionally. Only reachable by `imports.manage` (managers), so impact is low.
- **Evidence:** `getStagedImportKind` → `readStagedImport` → `prisma.appSetting.findUnique` returns the full `value` (the entire `StagedImport` including `rows`), then the route passes `kind` to `canWriteImportKind` and only later calls `commitImport` which checks ownership.

---

## Informational

### I1 — `TEST_MODE` not in env schema or `.env.example`

- **Location:** `.env.example`, `lib/env.ts:3-7`, `app/api/admin/test-console/route.ts:9-11`
- **Claim:** The test-mode banner and test-console both depend on `TEST_MODE`, but it is absent from `.env.example` and not validated by the `environmentSchema` in `lib/env.ts`. Operators may misconfigure (typo, undocumented toggle). The `NODE_ENV !== "production"` guard in `isTestConsoleEnabled` provides defense-in-depth, but discoverability is poor.
- **Evidence:** `.env.example` lists `CRON_SECRET`, `DEV_AUTH_MODE`, etc., but no `TEST_MODE`. `environmentSchema` only validates `DATABASE_URL` and Clerk keys.

### I2 — Test-mode banner vs. test-console guard inconsistency

- **Location:** `app/admin/layout.tsx:23`, `app/api/admin/test-console/route.ts:9-11`
- **Claim:** The admin banner checks only `process.env.TEST_MODE === "true"`; the test-console API also requires `process.env.NODE_ENV !== "production"`. In a misconfigured production deploy with `TEST_MODE=true`, the banner would announce "TEST MODE · destructive controls are enabled" while the console API refuses (404). The banner is misleading but the controls remain safe.
- **Evidence:** Layout: `process.env.TEST_MODE === "true" ? "TEST MODE..." : "LIVE MODE..."`. Test-console: `process.env.TEST_MODE === "true" && process.env.NODE_ENV !== "production"`.

### I3 — Cron secret length leak via short-circuit

- **Location:** `lib/cron-auth.ts:9`
- **Claim:** `authorizeCron` checks `expected.length === received.length` before `timingSafeEqual`. The early return leaks the secret length via timing (an attacker can learn the bearer length without ever matching content). Content remains protected by `timingSafeEqual`. Minor; standard pattern, but worth noting for a security-sensitive comparator.
- **Evidence:** `const matches = Boolean(expected && received && expected.length === received.length && timingSafeEqual(expected, received));`.

### I4 — Exports not streamed; compounds M3

- **Location:** `lib/reporting.ts:90-107`
- **Claim:** `exportCsv` builds the entire CSV as a single string in memory and returns it as one `Response`. Plan R-092 calls for "large-result streaming." At 5k+ packages / multi-season order lines this compounds the memory pressure noted in M3. Not a separate vulnerability, but a plan deviation with security-adjacent DoS impact.
- **Evidence:** `return ["header", ...rows.map(...).join(",")].join("\n")` returned as `new Response(csv, { headers: {...} })` — no `ReadableStream`, no chunked encoding.

---

## Out of scope (noted, not counted)

- Coverage gap: R-092 lists five export datasets (`deliveries`, `year-end`, `year_metrics`, `item_sales`, `lapsed_customers`); only `year_metrics`, `shipping_margin`, `item_sales` are implemented. This is a coverage/quality issue, not a security finding.
- `purgeEmailLogs` deletes only logs whose outbox status is `DELIVERED` or `FAILED`, preserving in-flight audit evidence — correct behavior, no finding.
- Cron handlers (`sweepEmailOutbox`, `expirePickupPackages`, `sendPaymentReminders`, `autoOpenScheduledSeasons`) perform bounded work (`take: OUTBOX_BATCH_SIZE`, status-filtered updates) — no unbounded mutation found.
