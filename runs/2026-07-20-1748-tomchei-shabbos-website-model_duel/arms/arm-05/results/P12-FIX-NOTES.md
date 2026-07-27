# P12 fix notes — arm-05

## Fixed

- Blocker 1: Test-console wipes now retain `StaffUser`, `AppSetting`, and `AuditEvent`; the destructive truncate and its audit event commit together. The console also requires an explicit development or test environment.
- Blocker 2: Legacy orders now require complete address fields, use the shared normalized address key, never write placeholders, and create `PENDING` address-review records with a staff approval queue.
- Major 3: Added the bearer-protected Stripe reconciliation cron and Vercel registration.
- Major 4: Reconciliation now requires the dedicated `payments.reconcile` permission; legacy imports remain behind `imports.manage`.
- Majors 6–8 and 12: Reused shared money, email, phone, and address normalizers; legacy CSV parsing now supports quoted RFC-4180-style fields.
- Majors 15–16 and 20: The dry-run rejects existing customer overwrites and duplicate/existing order numbers; imported orders create a posted legacy Payment.
- Majors 18–19: The reports page renders season margin totals and export audit history.
- Smoke now verifies both seasons, quoted import fields, overwrite rejection, legacy Payment/audit/review records, and six cron registrations.

## Deferred

- Streaming or cursor-backed report/export queries and the two missing export datasets.
- Report/import route separation, staged-PII expiry management, and full refactor work.
- Full S5 web E2E, nightly print batch, and authenticated test-console route smoke coverage.
- Remaining minor and nit findings from the aggregate review.

Verification: `npm run smoke:p12` and `npm run typecheck` passed on 2026-07-28.
