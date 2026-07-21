# P12 Fix Notes — arm-03

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness  
**Tree:** `arms/arm-03/workspace/`  
**Source:** `results/AGGREGATE-REVIEW-P12.md`

## Fixed

| ID | What changed |
|---|---|
| **B1** | `reseedTestSeason` now wipes fixtures, resets `nextOrderNumber` from remaining orders, restores inventory headroom, then returns post-wipe counts (no longer a count-only stub). |
| **B2** | Added `ensureScaleFixtures` + `scalePrintProbe`: require ≥1k scale orders / ≥5k packages (create deficit + package top-up); mark a 250-package NEW sample and run nightly; fail if fixtures under target or nightly processes fewer than 250 (no vacuous empty-input pass). Wired to `/api/admin/test-ops` `scalePrintProbe`. |
| **B3** | `wipeTestFixtures` matches `dressRehearsal`, `p12Fixture`, `scaleFixture` p6/p12, `dress`, draftRef prefixes, plus P12 import customers / orphan fingerprints / smoke export audits. |
| **M1** | Single reconcile path: `lib/ops/reconcile.ts` is canonical; `lib/payments/reconcile.ts` re-exports `runPaymentReconcile` as `runPaymentReconciliation` (+ `seedOrphanPaymentIntent` only). |
| **M2** | Removed unregistered duplicate `stripe-reconcile` cron route; `payment-reconcile` remains the scheduled job. |
| **M5** | Deleted dead `lib/exports/center.ts`. |
| **M6** | Deleted dead `lib/reports/{margin,performance}.ts`. |
| **M7** | Removed dead `wipeTestSeasonFixtures` / divergent `setTestMode` / `test-ops-keys.ts`; dress rehearsal lives in `test-console.ts`, wipe/reseed/mode/probe in `test-ops.ts`. |
| **M12** | `isTestEnvAllowed()` — destructive test-ops require non-production and `IS_TEST_ENV` or `AUTH_MODE=dev`; enforced in test-ops lib + route + dress rehearsal. |
| **M13** | `runPaymentReconcile` loads StripePaymentIntents with `take: 2000`, newest first. |
| **M19** | Admin reconcile GET uses `listReconcileRuns`. |
| **Smoke S5** | Uses `runDressRehearsal` + `scalePrintProbe`; asserts wipe clears dress/scale markers; requires scale ≥1k/5k and non-empty nightly sample. |

## Skipped (out of prioritized fix scope)

| ID | Why |
|---|---|
| **M3** | `import.ts` god-file split — large refactor; not in blocker/critical priority list. |
| **M4** | Real ORDERS import path vs prior-year stub — not in prioritized critical set for this pass. |
| **M8** | Duplicate address-cleanup routes — API surface drift; no UI; deferred. |
| **M9** | ORDERS/PRODUCTS import smoke coverage — deferred with M4. |
| **M10/M11** | Partially addressed by S5 calling dress rehearsal + scalePrintProbe directly; HTTP button click path not separately exercised. |
| **M14–M18, M20–M26** | Clean-code duplication / client type drift / schema placement — not blockers; deferred. |
| **m1–m14** | All minors deferred. |

## Smoke

`npm run smoke:p12` → **5/5 PASS** (see `results/PHASE-P12-SMOKE.md`).
