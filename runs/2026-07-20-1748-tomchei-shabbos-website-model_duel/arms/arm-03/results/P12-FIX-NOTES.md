# P12 FIX NOTES — arm-03

**Phase:** P12 fix pass  
**Ports:** web 3103 / db 4103  
**Smoke:** `npm run smoke:p12` → **5/5 PASS** (S1–S5)

## Blockers fixed

| ID | Claim | Fix |
|---|---|---|
| **B1** | Legacy import dry-run polluted → 0 VALID / no commit | `wipeTestFixtures` now deletes scale/dress/`legacyImport`/`p12Fixture` orders, P12 smoke customers (`p12.*` / `P12 ` display names), `orphan:` reconcile adjustments, and messy-p12 import batches. Smoke S3 enables test mode + wipe before staging. Unique phones per run. S3 evidence: `valid: 3`, `dryCommitted: 3`, resume `COMMITTED`. |
| **B2** | Test-ops destructive routes lacked env guard | Added `IS_TEST_ENV` to `env.ts` (+ `.env` / `.env.example`). `isTestEnvAllowed()` requires `IS_TEST_ENV` **or** `AUTH_MODE=dev`, and never `NODE_ENV=production`. Gated on `/api/admin/test-ops` GET/POST and inside `setTestMode` / wipe / reseed. |
| **B3** | Two Stripe reconcile implementations + duplicate cron | Kept single matcher `lib/ops/reconcile.ts` (`fingerprint = orphan:<piId>`). `lib/payments/reconcile.ts` now re-exports that matcher (+ `seedOrphanPaymentIntent` only). Deleted `/api/cron/stripe-reconcile`. Registered cron remains `/api/cron/payment-reconcile`. Admin route uses `listReconcileRuns`. Query capped `take: 2000`. |

## Majors fixed (straightforward)

| ID | Fix |
|---|---|
| Wipe ↔ dress rehearsal mismatch | Wipe matches `dressRehearsal` / `p12Fixture` / `scaleFixture` / `legacyImport` / `dress`; dress rehearsal also sets `scaleFixture: "p12"`. |
| `reseedTestSeason` stub | Reseed now wipes fixtures, resets `nextOrderNumber`, restores inventory headroom, returns post-wipe counts. |
| Scale dress vacuous | Smoke S5 runs `db:seed-scale-p6` (~1k orders / 5k NEW packages) before nightly timing; asserts `scalePackages >= 1000`. Evidence: `scalePackages: 5000`. |
| Dead duplicate modules | Deleted `lib/exports/center.ts`, `lib/reports/{margin,performance}.ts`, `lib/ops/test-ops-keys.ts`, duplicate `api/admin/address-cleanup`. |
| Dead `test-console` setTestMode/wipe | Removed; console only exports `runDressRehearsal`. Removed false `REROUTE_CONFIRMED` audit. |
| Import GET PII privilege | `GET ?batchId=` now requires `settings.write`. |
| Margin privilege | `reports?kind=margin` requires `settings.write` (aligned with CSV export). |
| ORDERS import Payment gap | `commitOrderRow` creates POSTED CASH `Payment` + wipeable `p12Fixture` snapshot. |
| Performance DISCARDED | Live performance report excludes `DISCARDED` (aligned with exports). |
| Reports envelope | Dropped redundant `report: { seasons, totals }` wrapper. |

## Smoke evidence (post-fix)

| ID | Result | Notes |
|---|---|---|
| S1 | PASS | Reports + margin |
| S2 | PASS | Export auth; orphan flagged; rerun `created:0` / `skipped:1`; cron 200/401 |
| S3 | PASS | `valid:3`, `duplicate:1`, `invalid:1`, `dryCommitted:3`, interrupted+resume |
| S4 | PASS | Prior-year repeat review pages 200 |
| S5 | PASS | `scalePackages:5000`, wipe `deletedOrders:1004`, reseed clean season, crons 401×6 |

## Not fixed (left for later)

- God-file split of `import.ts` (M3) — large refactor, deferred
- Full ORDERS/PRODUCTS kind smoke coverage beyond CUSTOMERS (M9)
- UI button paths for dress/scale probe still not the smoke driver (M10/M11) — wipe/markers fixed so UI path is wipeable
- `CRON_SECRET` still read raw in cron auth (F8) — not boot-validated
- `money()` / client enum drift cleanups (M15, M22) — low urgency
