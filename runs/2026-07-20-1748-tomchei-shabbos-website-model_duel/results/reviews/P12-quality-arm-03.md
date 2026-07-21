# P12 Quality Review — arm-03 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Reviewer:** external quality specialist
**Smoke claim:** 5/5 PASS (`arms/arm-03/results/PHASE-P12-SMOKE.md`)
**Scope of review:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P12-EXPECTED.md`. Findings only — no fixes.

## Counts

| Severity | Count |
|---|---|
| Critical (broken flow / stub masquerading as done) | 3 |
| Major (dead code / duplicated logic / missing smoke for required path) | 6 |
| Minor (incomplete coverage / drift) | 3 |
| **Total** | **12** |

Smoke verdict: the 5/5 PASS is **misleading**. S5 passes via vacuous checks that do not exercise the EXPECTED scale requirement, and the "reseed" step is a no-op stub.

---

## Critical

### C1 — `reseedTestSeason` is a no-op stub, not a reseed
`src/lib/ops/test-ops.ts:99-139`

The function is named and surfaced (UI button "Wipe test fixtures" + smoke S5) as if it restores a clean test season. It does not. It only counts current orders/packages and returns the counts:

```ts
const orderCount = await db.order.count({ where: { seasonId: season.id, status: { not: "DRAFT" } } });
const packageCount = await db.package.count({ where: { order: { seasonId: season.id } } });
...
return ok({ openSeasonId: season.id, orderCount, packageCount });
```

No seeding, no reset of `nextOrderNumber`, no restoration of a known baseline. EXPECTED S5 requires "wipe+reseed restores clean test season." The smoke reports `reseed: { orderCount: 164, packageCount: 136 }` — those are leftover counts after a partial wipe, not a freshly reseeded season. The "reseed" claim is false.

### C2 — Scale dress rehearsal (1k orders / 5k packages) never exercised
EXPECTED item 4: "Scale dress rehearsal at 1k orders / 5k packages"; S5: "nightly batch over 5k packages acceptable."

Smoke S5 evidence: `scalePackages: 0`, `nightlyMs: 69`. The scale count query returns zero because no p6/p12 scale fixtures exist in this arm's DB. The nightly timing run completes in 69 ms because `runNightlyPrintBatch` only processes `stage:"NEW"` packages (`src/lib/ops/print-batch.ts:364-368`), and by the time the timing run executes, every dress package has already been advanced to PRINTED/PACKED/SENT/PICKED_UP. The `nightlyMs < 120_000` and `scaleNightly.ok` assertions pass vacuously on an empty input set. The 1k/5k scale requirement is untested and unmet.

### C3 — `wipeTestFixtures` does not clean up `runDressRehearsal` orders
`src/lib/ops/test-ops.ts:51-96` vs `src/lib/ops/test-console.ts:63-163`

`runDressRehearsal` (the UI "Run dress rehearsal" button handler) creates orders with `checkoutSnapshot: { dressRehearsal: true, p12Fixture: true }`. `wipeTestFixtures` (the UI "Wipe test fixtures" button handler) filters on `scaleFixture=p6/p12` and `draftRef` prefixes `p12-dress-`/`p12-wipe-` — it never matches `dressRehearsal` or `p12Fixture` keys. So a user who runs the dress-rehearsal button then the wipe button leaves dress-rehearsal orders, packages, and labels behind. The matching `wipeTestSeasonFixtures` that does check those keys exists in `test-console.ts` but is dead (not wired to the route). Broken flow.

---

## Major

### M1 — `seedImportedPriorYearOrder` is a stub; real ORDERS import path unsmoked
`src/lib/ops/prior-year-stub.ts:13` — file header literally says "P12 migration hook stub."

S4 "Imported repeat" calls this stub, which directly `db.order.create`s a prior-year paid order. The actual historical-migration import pipeline (`ImportKind.ORDERS` → `classifyOrderRows` + `commitOrderRow` in `src/lib/ops/import.ts:196-273, 421-509`) is never exercised by any smoke. EXPECTED item 3 ("Legacy import pipeline … historical migration") is satisfied only by a stub, not by the real import flow.

### M2 — Dead, unregistered `stripe-reconcile` cron with a second reconcile implementation
`src/app/api/cron/stripe-reconcile/route.ts` calls `runPaymentReconciliation` from `src/lib/payments/reconcile.ts`. It is **not** in `vercel.json` crons (only `payment-reconcile` is registered). The registered `payment-reconcile` route uses `runPaymentReconcile` from `src/lib/ops/reconcile.ts`. Two parallel reconcile implementations:

- Different fingerprint schemes: `orphan:<piId>` (ops) vs `orphan_pi:<sha256[0:40]>` (payments). The same orphaned PI produces two different adjustment rows depending on which path runs — not idempotent across paths.
- `listReconcileRuns` is duplicated in both files with different `include` shapes.

Dead route + duplicated logic + inconsistent fingerprinting. Clean-code violations: duplicated logic, dead code, inconsistent patterns.

### M3 — `test-console.ts` dead duplicates + type drift on `ops.testMode`
`src/lib/ops/test-console.ts:24-57` exports `wipeTestSeasonFixtures` and `setTestMode`. Neither is called by the API route (`/api/admin/test-ops` uses `test-ops.ts` versions). Additionally:

- `test-console.ts`'s `TestModeSetting` (from `test-ops-keys.ts`) = `{ enabled, label? }`.
- `test-ops.ts`'s `TestModeSetting` = `{ enabled, env: "test"|"live" }`.
- Both write the same setting key `ops.testMode`.

If `test-console.ts`'s `setTestMode` were ever called, `test-ops.ts`'s `getTestMode` would read `env` as `undefined`. Type/schema drift on a shared key. Dead code + drift.

### M4 — ORDERS and PRODUCTS import kinds unsmoked
S3 exercises only `ImportKind.CUSTOMERS`. `classifyProductRows` and `classifyOrderRows` (the historical-migration path EXPECTED item 3 calls out) have no smoke coverage. The imports-client UI exposes all three kinds, but only Customers is validated.

### M5 — UI "Run dress rehearsal" button unsmoked
`runDressRehearsal` (via `/api/admin/test-ops` action `dressRehearsal`) is never invoked by smoke. S5 performs its own manual dress rehearsal via `ensurePaidOrder` + `bulkAdvancePackageStage` + `stampPickedUp` + `switchFulfillmentMethod`, bypassing the function the UI button actually calls. The UI button's behavior (including the C3 wipe mismatch) is unverified.

### M6 — UI "Scale print probe" button unsmoked
The `scalePrintProbe` action in `/api/admin/test-ops` is never invoked by smoke. S5's scale timing uses a direct `runNightlyPrintBatch` call, not the action the UI button calls. Combined with C2, the scale hardening surface is untested both as a requirement and as a UI flow.

---

## Minor

### m1 — Test-mode banner not verified visible
EXPECTED item 4 requires "test-mode banner." `setTestMode` writes an `alertBanner` setting, but no smoke asserts the banner renders on any page. S5 only checks `/admin/test-ops` returns 200. Banner visibility is unverified.

### m2 — `stripe-reconcile` route absent from smoke cron list
S5's `vercelCrons` array checks the 6 registered crons and confirms unauthenticated calls return 401/403. The unregistered `stripe-reconcile` route is not in the list, so its auth (and its existence) is unverified — consistent with vercel.json but leaves the dead route untested.

### m3 — Reports API returns two shapes for performance
`src/app/api/admin/reports/route.ts:29-35` returns both `seasons`/`totals` and a `report: { seasons, totals }` wrapper. The smoke reads `marginApi.json?.report?.marginCents` (margin shape) but the performance client reads `pj.seasons` directly. Redundant envelope; minor inconsistency, not broken.

---

## Verdict

P12 ships the EXPECTED surfaces (routes, pages, lib functions, cron registration) but the smoke over-reports health:

- The 5/5 PASS rests on a vacuous scale check (C2) and a no-op reseed (C1).
- Two stubs (C1, M1) are named as if they are real features.
- The wipe/dress-rehearsal pair is broken end-to-end (C3).
- Two reconcile implementations and two test-ops implementations diverge (M2, M3).

Recommend: treat P12 as **PASS with findings** — gate only after C1, C2, C3 are addressed and S3/S5 smoke is extended to cover ORDERS import, the UI dress-rehearsal button, the scale print probe against a real 5k-package fixture, and a reseed that actually reseeds.
