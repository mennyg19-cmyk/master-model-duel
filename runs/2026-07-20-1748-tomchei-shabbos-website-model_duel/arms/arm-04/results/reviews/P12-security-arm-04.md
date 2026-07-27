# P12 Security Review — arm-04 (blind)

**Phase:** P12 — Reporting, exports, Stripe reconciliation, legacy import, address-book cleanup, test console, cron registration, dress rehearsal
**Scope:** `arms/arm-04/workspace/` — P12 surface only
**Reviewer:** Security specialist, blind to model identity
**Reference:** `shared/phases/PHASE-P12-EXPECTED.md`, `kit/prompts/reviewer/review-security.md`
**Method:** Static read of routes, server actions, services, env spec, scratch smoke/STATUS. Findings only — no fixes proposed.

## Surface examined

- Export download route + service: `src/app/api/admin/exports/[slug]/route.ts`, `src/lib/reports/export-service.ts`, `src/lib/reports/datasets.ts`, `src/lib/reports/csv-write.ts`
- Report pages: `src/app/(admin)/admin/reports/page.tsx`, `src/app/(admin)/admin/reports/[seasonId]/page.tsx`, `src/app/(admin)/admin/reports/margin/page.tsx`, `src/app/(admin)/admin/reports/exports/page.tsx`, `src/app/(admin)/admin/reports/payments/page.tsx`, `src/app/(admin)/admin/reports/payments/actions.ts`
- Reconciliation: `src/lib/payments/reconciliation.ts`, `src/app/api/cron/payment-reconciliation/route.ts`
- Cron auth (all six): `src/lib/cron/authorize.ts`, `src/lib/cron/job-run.ts`, `src/app/api/cron/{notification-sweep,season-flip,pickup-expiry,payment-reminder,payment-reconciliation,email-log-purge}/route.ts`, `vercel.json`
- Legacy import: `src/lib/migration/legacy-import.ts`, `src/lib/migration/legacy-rows.ts`, `src/lib/imports/csv.ts`, `src/app/(admin)/admin/migration/page.tsx`, `src/app/(admin)/admin/migration/[runId]/page.tsx`, `src/app/(admin)/admin/migration/actions.ts`
- Address cleanup: `src/lib/migration/address-cleanup.ts`, `src/app/(admin)/admin/migration/cleanup/page.tsx`
- Test console: `src/lib/testing/console.ts`, `src/lib/testing/test-mode.ts`, `src/app/(admin)/admin/settings/testing/page.tsx`, `src/app/(admin)/admin/settings/testing/actions.ts`
- Authz + env: `src/lib/auth/staff.ts`, `src/lib/auth/permissions.ts`, `src/lib/env-spec.ts`, `src/lib/audit.ts`, `src/lib/forms/flash-redirect.ts`
- Smoke: `.scratch/PHASE-P12-STATUS.md`, `.scratch/PHASE-P12-SMOKE.md`

## Findings

### SEC-1 — Export audit/log row is skipped when the download stream errors mid-flight
**Severity:** Medium
**File:** `src/lib/reports/export-service.ts:39–62`

```39:62:src/lib/reports/export-service.ts
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (text: string) => { /* … */ };

      try {
        push(csvRow(definition.headers));

        for (let skip = 0; skip < rowCount; skip += PAGE_SIZE) {
          const rows = await definition.page(season.id, skip, PAGE_SIZE);
          if (rows.length === 0) break;
          push(rows.map(csvRow).join(''));
        }

        await recordExport(definition, season, staff, rowCount, byteCount);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
```

`recordExport` — which writes both the `ExportLog` row and the `report.exported` audit event — runs only after the last page is enqueued, inside the same `try`. If the client disconnects mid-stream, the runtime aborts the `start` callback and the `catch` calls `controller.error`, so `recordExport` never runs. The module docstring defends this as "an export that fell over halfway does not leave a row claiming the whole file went out." That is a defensible choice for *accuracy* of the row count, but the security cost is an audit blind spot: a manager who opens `/api/admin/exports/deliveries?seasonId=…` and disconnects after the first 500 rows has already received a page of donors' names and addresses, and the audit trail cannot answer "who tried to take a copy." For a file that is explicitly every donor's name, address, phone and (in the year-end file) email + payment status, the egress event should be recorded at *request* time (or at first-byte time), with the row count amended on completion. As written, a partial download of PII is the one export that leaves no trace.

### SEC-2 — `mapLegacyRow` accepts any customer id, not just the row's candidates
**Severity:** Low
**File:** `src/lib/migration/legacy-import.ts:158–187`, `src/app/(admin)/admin/migration/actions.ts:66–78`

```158:170:src/lib/migration/legacy-import.ts
export async function mapLegacyRow(
  staff: StaffContext,
  input: { runId: string; lineNumber: number; customerId: string },
): Promise<Result<{ runId: string }>> {
  const row = await db.legacyImportRow.findUnique({
    where: { runId_lineNumber: { runId: input.runId, lineNumber: input.lineNumber } },
  });
  if (!row || row.status !== 'NEEDS_MAPPING') {
    return failure(LEGACY_ROW_NOT_FOUND, 'That line is not waiting for an answer.');
  }

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) return failure(LEGACY_ROW_NOT_FOUND, 'That customer is no longer on file.');
```

The function verifies the row is `NEEDS_MAPPING` and that the customer exists, but never compares `input.customerId` to `row.candidates`. The screen offers the candidate list as a `<Select>`, but a hand-crafted POST can name any customer id in the database. A manager (this is `migration.manage`) can therefore attach a decade of someone's giving history to a household the scan did not flag as a candidate — including, e.g., mapping a row to themselves. Manager-authorized, so this is not a privilege escalation, but the candidate list is the only thing that makes the mapping trustworthy and it is enforced only in the UI. The same check belongs in the service.

### SEC-3 — `lineNumber` form input is not integer-validated before the DB call
**Severity:** Low
**File:** `src/app/(admin)/admin/migration/actions.ts:66–78`

```66:78:src/app/(admin)/admin/migration/actions.ts
export async function mapLegacyRowAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const runId = trimmedField(formData, 'runId');

  const mapped = await mapLegacyRow(staff, {
    runId,
    lineNumber: Number(trimmedField(formData, 'lineNumber')),
    customerId: trimmedField(formData, 'customerId'),
  });
```

`Number(trimmedField(formData, 'lineNumber'))` yields `NaN` for any non-numeric input. `dryRunLegacyImportAction` guards `seasonYear` with `Number.isInteger`; this path does not. A `NaN` reaches `db.legacyImportRow.findUnique({ where: { runId_lineNumber: { …, lineNumber: NaN } } })`, which either throws (Prisma type error → generic 500 surfaced to the manager) or returns null (→ `LEGACY_ROW_NOT_FOUND`). No data is written on either path, but the action also lacks a `try/catch`, so the throw propagates to the server-action boundary as an unhandled error rather than a flash message. Bounded impact (manager-only, no write), but inconsistent with the validation the same file applies to `seasonYear`.

### SEC-4 — `dryRunLegacyImport` loads the full upload and all verdicts into one request
**Severity:** Low
**File:** `src/lib/migration/legacy-import.ts:79–137`, `src/app/(admin)/admin/migration/actions.ts:28–48`

```40:121:src/lib/migration/legacy-import.ts
  const staged = await dryRunLegacyImport(staff, {
    fileName: file.name,
    content: await file.text(),
    seasonYear,
  });
```

`await file.text()` reads up to `MAX_UPLOAD_BYTES` (8 MB) into a string, `parseCsv` materialises up to `CSV_MAX_ROWS` (5 000) rows, `readVerdicts` issues batched `findMany` calls, and `db.legacyImportRun.create({ data: { rows: { create: verdicts.map(…) } } })` writes every verdict row in one nested Prisma insert. All of that lives in the request scope of one manager's POST. The bounds are real (`MAX_UPLOAD_BYTES`, `CSV_MAX_ROWS`, `NAME_LOOKUP_BATCH`) and the caller is authorised, so this is not an external DoS — but a manager who uploads a max-size file repeatedly (or in parallel tabs) holds the full parsed payload and issues one large insert each time. The commit path was deliberately chunked (`MAX_CHUNKS_PER_COMMIT`, `ORDERS_PER_CHUNK`); the dry run was not.

### SEC-5 — `wipeTransactionalData` erases migration and cleanup history; only `AuditEvent` survives
**Severity:** Informational
**File:** `src/lib/testing/console.ts:116–134`

```116:134:src/lib/testing/console.ts
export async function wipeTransactionalData(staff: StaffContext): Promise<Result<ClearSummary>> {
  const guard = await requireTestMode();
  if (!guard.ok) return guard;

  const orders = await db.order.deleteMany({});
  const customers = await db.customer.deleteMany({});

  await Promise.all([
    db.deliveryRoute.deleteMany({}),
    db.printBatch.deleteMany({}),
    db.notificationLog.deleteMany({}),
    db.legacyImportRun.deleteMany({}),
    db.addressCleanupFlag.deleteMany({}),
    db.paymentReconciliationFlag.deleteMany({}),
  ]);
```

The wipe deletes `LegacyImportRun`, `AddressCleanupFlag`, and `PaymentReconciliationFlag` alongside orders/customers. `AuditEvent` is *not* deleted, so "who ran the wipe and when" is answerable — but the migration run records (file name, verdicts, chunk progress) and the in-progress address-cleanup queue are erased in one press. This is the intended behaviour for a rehearsal reset, and the gate is double (`settings.manage` + `requireTestMode` + the `WIPE` confirmation word, with `rejectWith` being `never` so the confirmation actually halts). The residual risk is operational, not a code defect: test mode is a DB setting (per `test-mode.ts`), not an env flag, so a deployment left in test mode after rehearsal keeps the wipe button live behind a banner the office has stopped noticing. Worth a runbook line, not a code change.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (SEC-1) |
| Low | 3 (SEC-2, SEC-3, SEC-4) |
| Informational | 1 (SEC-5) |
| **Total** | **5** |

## Notes on what is solid

- **Export authorisation** (`src/app/api/admin/exports/[slug]/route.ts`): `requirePermission('reports.view')` runs before anything else; `reports.view` is manager-only by `ROLE_DEFAULTS` and the permission comment explicitly calls it "every donor's giving history in one downloadable file." The slug is resolved through `findExportDefinition` against a fixed five-entry list (unknown slug → 404), and `seasonId` is validated against `db.season.findUnique` (missing/empty → 400). No IDOR: within `reports.view` the intended scope is *all* seasons, and there is no narrower per-staff season grant to enforce. Solid.
- **Cron bearer auth** (`src/lib/cron/authorize.ts`): empty `CRON_SECRET` refuses every request (the safe "not configured" reading); `env-spec.ts:387–395` rejects a non-loopback deployment with no secret at boot. Comparison is `timingSafeEqual(sha256(candidate), sha256(expected))` so length mismatch does not leak. All six crons route through `runCronJob`; the P12 `export const GET = POST` change is sound because the gate was never the verb. `vercel.json` registers all six with schedules. Solid.
- **Import dry-run vs commit auth**: both `dryRunLegacyImportAction` and `commitLegacyImportAction` (and `discardLegacyImportAction`, `mapLegacyRowAction`) call `requirePermission('migration.manage')` as their first line. `migration.manage` is manager-only. The dry run writes only `LegacyImportRun` + `LegacyImportRow` (staging); the commit is the only path that writes customers/addresses/orders, and it is chunked with a guarded `committedChunkCount` claim so two concurrent presses cannot double-write. Solid (modulo SEC-2 on the mapping target).
- **Test-console destructive routes gated to test mode**: `seedTestData`, `resetSeason`, `wipeTransactionalData` each call `requireTestMode()` *inside the service*, not on the page. A hand-written POST to any of the three actions still hits `requireTestMode` and returns `CONSOLE_NOT_IN_TEST_MODE` when the deployment is not in rehearsal. The page-level `disabled={!testMode}` is presentation; the gate is server-side. The `WIPE` confirmation word is checked with `rejectWith` which is typed `never` (redirects/throws), so a wrong confirmation halts before `wipeTransactionalData` runs. Solid.
- **Reconciliation writes flags, never payments** (`src/lib/payments/reconciliation.ts`): the matcher only upserts `PaymentReconciliationFlag` rows; no `Payment` is edited. Findings are fingerprinted so repeated sweeps do not multiply rows. The manual action (`reconcilePaymentsAction`) and the cron both go through `reconcilePayments`; the cron passes no `staffUserId`, the manual path passes `staff.acting.id`, and the run row records the source. Solid.
- **CSV formula injection** (`src/lib/reports/csv-write.ts`): `FORMULA_STARTERS = /^[=+@\t\r]/` plus the separate `-`-not-a-number guard covers the Excel/LibreOffice injection prefixes; the apostrophe prefix is applied before quoting so it survives. `csvAmount` emits bare decimals so a column of figures still sums. The import parser deliberately does *not* escape on the way in (a `-5` would be corrupted), so the export is the single point of escaping — which is the right place. Solid.
- **Audit trail shape** (`src/lib/audit.ts`): `report.exported`, `migration.dry_run`, `migration.committed`, `migration.discarded`, `migration.row_mapped`, `cleanup.scanned`, `cleanup.resolved`, `settings.test_mode_changed`, `testing.console_ran` are all declared action types with typed `detail`. No payment instrument, no Stripe intent id, no card detail reaches the audit row. The actor is the real signed-in human even under impersonation. Solid.
- **Webhook signature** (read for context, P11 surface): the recon matcher reads `StripePaymentIntent` rows that the webhook writes; the webhook itself verifies the Stripe signature over the raw body with `STRIPE_WEBHOOK_SECRET`, rejects any request carrying `Origin`, and rate-limits. No P12 change touched this path. Solid.
