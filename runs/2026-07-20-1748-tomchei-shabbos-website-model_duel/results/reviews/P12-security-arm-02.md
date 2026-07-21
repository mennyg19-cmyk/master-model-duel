# P12 Security Review — arm-02 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Scope:** `arms/arm-02/workspace/` P12 surface only (reports, CSV export center, Stripe reconciliation run + cron, legacy import pipeline, test console + test-mode banner, cron auth).
**Reviewer focus:** trust boundaries, auth, secrets, IDOR, injection.
**Method:** findings only — no fixes. No new scope beyond P12.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Info | 2 |

Auth posture is strong: every admin route gates on `requirePermissionApi`, the export dataset and season params are allowlisted/DB-validated (no injection, no header injection on `content-disposition`), all raw SQL is `Prisma.sql`-parameterized, every cron uses `requireCronAuth` with `timingSafeEqual` and 503s when `CRON_SECRET` is unset, the test console fail-closes to 404 outside test mode *before* the permission check (no existence leak), and every mutation writes an audit row. Env guards refuse the public `SESSION_SECRET` / dev webhook secret in real mode. No IDOR found. The one medium is an audit-trail bypass on the export stream; the rest are blast-radius / availability / defense-in-depth notes.

## Findings

### M-1 — Export audit row only writes on stream completion; aborting the download leaves no audit trail
`app/api/admin/exports/[dataset]/route.ts:34-54` writes the `export.run` audit row inside `pull()` only when the generator returns `done`. The `cancel()` handler (client disconnect / abort) calls `generator.return()` and writes nothing. A `reports.view` user can request a dataset, receive every row as it streams, and close the connection before the final `done` pull — no audit row is ever created. At minimum, any partial download is unaudited; with careful timing the full dataset (deliveries, year-end orders, lapsed customers — recipient names, full addresses, emails, phones) can be exfiltrated with no record. This defeats R-092 / S2's "every download is audited" detective control on the PII-bearing exports. Authenticated-only, but the audit is the security control here.

### L-1 — Test-console wipe blast radius exceeds the documented "open season" scope
`lib/test-console.ts:49-56` — `wipeOpenSeason` deletes `stripeWebhookEvent` and `paymentReconFlag` with `where: {}` (all rows across all seasons) and runs `inventoryItem.updateMany({ data: { reserved: 0 } })` with no season filter (resets reservations for every season's inventory). The route comment and the test-console page both promise the wipe "never touches … the audit log" and clears "every transactional row for the open season" — but recon flags and webhook events are global, and reservation resets are global. Fail-closed in live mode (`isTestMode()` gate, 404), so impact is confined to test environments, but the blast radius is broader than the contract a manager reading the UI would reasonably assume. `settings.manage`-gated.

### L-2 — Reconciliation matcher is an unbounded N+1 with no rate limit on the run button
`lib/payments/reconcile.ts:96-128` loops every posted Stripe payment and issues two `findFirst` calls per row (`stripeCheckoutSession` then `stripePaymentIntent`) inside the loop — no batched lookup. The run button (`app/api/admin/reconciliation/route.ts:POST`) gates on `reports.view` and has no rate limit / no concurrency guard; a user can fire it repeatedly. At the 5k-package scale baseline this is thousands of round-trips per run, and the run is synchronous on the request. Idempotent (upsert on `reference`) so no double-flags, but a single request can pin the DB. `reports.view`-gated; availability/integrity-of-service, not privilege.

### I-1 — No explicit CSRF / Origin check on state-changing admin API routes
`lib/api-client.ts` posts JSON with `Content-Type: application/json`; admin mutations (`/api/admin/reconciliation` POST/PATCH, `/api/admin/legacy-import` POST/PUT, `/api/admin/legacy-import/review` PATCH, `/api/admin/test-console` POST) rely on the non-simple content-type triggering a CORS preflight as implicit CSRF defense, with no `Origin`/`Sec-Fetch-Site` check or CSRF token in the handlers. Consistent with the rest of the app and reasonable (session cookies are `httpOnly` + `SameSite=lax` per P10), but P12 adds several new state-changing endpoints that inherit this posture; noted as defense-in-depth, not a live exploit.

### I-2 — Legacy import `fileName` is stored and rendered unsanitized
`app/api/admin/legacy-import/route.ts:12` allows `fileName: z.string().max(200)` and persists it to `LegacyImportRun.fileName`; `components/admin/legacy-import-client.tsx:179` renders `{run.fileName}` in a React text node (auto-escaped) and `:53` sends a fixed `"pasted-legacy.csv"` from the client. No XSS surface today (text-node rendering) and `fileName` is never used as a filesystem path, so no traversal — but the field has no character sanitization and is operator-supplied. Info.

## Out of scope (noted, not scored)

- Export `dataset` path param is validated by `isExportDataset` (closed allowlist) and `season` is DB-validated; `content-disposition` filename is built from the allowlisted `dataset` — no header injection.
- `lib/exports.ts` `lapsedCustomersCsv` and `lib/reports.ts` `seasonDrilldown` / `marginReport` raw SQL all use `Prisma.sql` with `${seasonId}` parameterization — no SQL injection.
- `requireCronAuth` (`lib/cron.ts`) uses `timingSafeEqual` with a length guard and 503s when `CRON_SECRET` is unset; all six crons (including the new `stripe-reconciliation`) apply it and export `POST as GET` for Vercel — sound secret boundary.
- Test-console route (`app/api/admin/test-console/route.ts:13`) checks `isTestMode()` before `requirePermissionApi`, returning a generic 404 in live mode — no existence/auth-state leak.
- Reconciliation PATCH (`app/api/admin/reconciliation/route.ts:42-48`) uses `updateMany` with `where: { id, status: "open" }` and resolves with the real user's id; `reports.view` is the designated permission for "run … payment reconciliation" per `lib/auth/permissions.ts:17` — by design, not privilege escalation.
- Legacy import commit is bound to the dry-run by `legacyFileHash` (sha256 of the posted bytes); the PUT re-derives the plan from the same bytes and rejects a re-commit of an already-`COMPLETED` run (409) — no double-import via re-POST.
- Env validation (`lib/env.ts`) refuses the public `SESSION_SECRET` default and the dev `STRIPE_WEBHOOK_SECRET` in real mode, and requires `STRIPE_SECRET_KEY` in production — fail-closed secret posture unchanged by P12.
- `parseCsv` (`lib/csv.ts`) caps rows at `MAX_IMPORT_ROWS=5000` and the legacy import body schema caps `csv` at 5 MB — bounded parser, no unbounded memory.
