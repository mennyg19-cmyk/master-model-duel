# P12 Security Review — arm-03

Scope: `arms/arm-03/workspace/` against `shared/phases/PHASE-P12-EXPECTED.md`.
Mode: findings only. Smoke (`arms/arm-03/results/PHASE-P12-SMOKE.md`) reports 4/5 PASS (S3 FAIL); this review looks past smoke at the P12 code that backs reports, exports, reconciliation, legacy import, scale/test-ops, and launch readiness.

## Headline

P12 ships all five EXPECTED deliverables, but the **destructive test-ops surface has no environment guard** — a MANAGER in production can enable test mode and wipe orders. Around it sit duplicate cron routes (one unregistered), duplicate `setTestMode` implementations writing different shapes to the same setting key, an untested `dressRehearsal` action whose orders the wipe cannot remove, and a privilege mismatch where staged import PII and margin financials are readable by lower-privileged staff than the mutations that produce them.

## Findings

### F1 — `test-ops` destructive route has no `IS_TEST_ENV` env guard (authorization / trust boundary)

`src/app/api/admin/test-ops/route.ts` gates `wipe`, `reseed`, `dressRehearsal`, and `scalePrintProbe` behind `requirePermission("settings.write")` plus the `testMode` setting. `settings.write` is granted to **MANAGER** by default (`src/lib/permissions.ts:16` `ROLE_DEFAULTS.MANAGER = PERMISSIONS`). The established trust boundary for destructive test-env APIs (inventory F-026: `wipe-test-data`, `reset-test-db`, `seed-test-season`) requires `IS_TEST_ENV`/`isTestEnv` **plus** developer `impersonate` permission. A grep for `IS_TEST_ENV|isTestEnv` across the workspace returns **no matches** — the guard does not exist anywhere. The `testMode` setting is itself settable by any MANAGER via the same route (`setTestMode`), so the only thing between a production MANAGER and `wipeTestFixtures` (which deletes orders + shipping labels) is one self-granted toggle. EXPECTED #4 ("test console + test-mode banner") is delivered, but the destructive-ops env boundary is not.

### F2 — Duplicate reconcile cron routes; `stripe-reconcile` is not registered in `vercel.json`

Two cron routes run payment reconciliation:

- `src/app/api/cron/payment-reconcile/route.ts` → `runPaymentReconcile` (`lib/ops/reconcile.ts`)
- `src/app/api/cron/stripe-reconcile/route.ts` → `runPaymentReconciliation` (`lib/payments/reconcile.ts`)

`vercel.json` registers `payment-reconcile` (schedule `0 5 * * *`) but **not** `stripe-reconcile`. Both call `requireCronBearer`. EXPECTED #4 says "all crons registered with secret auth" — `stripe-reconcile` has the secret auth but is not registered, so it is an orphaned duplicate cron route. The smoke only probes the six registered paths, so the duplicate is unobserved. Two reconcile implementations also means two reconcile codepaths that can drift; pick one and delete the other.

### F3 — Legacy order import creates `PAID` orders with no `Payment` row (audit / reconciliation integrity)

`src/lib/ops/import.ts:478` `commitOrderRow` creates orders with `status: OrderStatus.PAID`, `paymentStatusCached: CachedPaymentStatus.PAID`, `placedAt: new Date("2025-03-01T12:00:00Z")`, but creates **no `Payment` record**. Consequences:

- The order counts as paid in the S1 performance report (`paidOrderCount`, `revenueCents`) with no money trail.
- `runPaymentReconcile` (`lib/ops/reconcile.ts:67-83`) computes `postedTotal` from `Payment` rows; an imported paid order with no payments has `postedTotal = 0`, so any later `StripePaymentIntent` attached to it is flagged as an orphan and an adjustment is created — imported history becomes perpetual reconcile noise.
- A MANAGER with `settings.write` can inject synthetic paid historical orders that inflate revenue reports. The audit log records `IMPORT_COMMITTED` once per batch, not per row, so per-row attribution is thin.

The `placedAt` hardcode to `2025-03-01` also means all imported orders report the same date regardless of source data.

### F4 — Import batch `GET` exposes staged PII to `admin.access` (STAFF) while mutations require `settings.write`

`src/app/api/admin/imports/route.ts:36-51` — `GET ?batchId=` requires `admin.access` (STAFF default). `getImportBatch` (`lib/ops/import.ts:336-345`) returns `rows` including `raw` (`displayName`, `email`, `phone`, `addressLine1`, `city`, `state`, `postalCode`). `POST` (stage) and `PATCH` (commit) require `settings.write` (MANAGER). So a STAFF can read every staged customer's email/phone/address from any batch id they can guess/enumerate, but only a MANAGER can stage or commit. The read privilege for import PII is lower than the write privilege that produced it. Either gate `GET` with `settings.write` or strip PII from the STAFF-readable payload.

### F5 — Margin financial data privilege inconsistency: reports API vs exports API

The same shipping-margin numbers (`chargedCents`, `purchasedCents`, `marginCents` per package) are exposed under two different gates:

- `src/app/api/admin/reports/route.ts:8` — `?kind=margin` requires `admin.access` (STAFF).
- `src/app/api/admin/exports/route.ts:25` — `SHIPPING_MARGIN` CSV export requires `settings.write` (MANAGER).

Both call `marginReport()` (`lib/ops/reports.ts`). A STAFF can read full per-package margin financials via the reports endpoint but cannot export the same data to CSV without a MANAGER. The trust boundary for financial data should be one level, not two.

### F6 — `runDressRehearsal` (the route's `dressRehearsal` action) creates orders that `wipeTestFixtures` cannot remove; untested by smoke

`src/app/api/admin/test-ops/route.ts:90` wires the `dressRehearsal` action to `runDressRehearsal` (`src/lib/ops/test-console.ts`). That function creates orders with:

- `draftRef = formatDraftRef(season.year, "dr" + randomBytes(4))` — does **not** start with `p12-dress-` or `p12-wipe-`.
- `checkoutSnapshot = { dressRehearsal: true, p12Fixture: true }` — no `scaleFixture` key.

`wipeTestFixtures` (`src/lib/ops/test-ops.ts:60-70`) deletes orders matching `checkoutSnapshot.scaleFixture ∈ {p6, p12}` OR `draftRef` prefix `p12-dress-` / `p12-wipe-`. Neither clause matches a `runDressRehearsal` order. So invoking `dressRehearsal` from the real UI creates orders that survive `wipe`. EXPECTED S5 ("wipe+reseed restores clean test season") passes in smoke only because the smoke builds its dress fixtures via `ensurePaidOrder` (`smoke-p12.mjs:112`, `checkoutSnapshot: { scaleFixture: "p12", dress: true }`) and **never calls `runDressRehearsal`**. The route's actual `dressRehearsal` path is untested and leaks non-wipeable orders.

### F7 — Two `setTestMode` implementations writing different shapes to the same setting key

- `src/lib/ops/test-ops.ts:20` `setTestMode` writes `{ enabled, env: "test"|"live" }` to key `ops.testMode` and also writes the alert banner (`OPS_SETTINGS.alertBanner`).
- `src/lib/ops/test-console.ts:42` `setTestMode` writes `{ enabled, label? }` to key `TEST_OPS_SETTINGS.testMode` — which `test-ops-keys.ts:3` resolves to the **same** `ops.testMode` key — and does **not** write the banner.

The route imports `setTestMode` from `test-ops.ts` (the banner-writing one), so `test-console.ts`'s `setTestMode` and `wipeTestSeasonFixtures` are dead. But the two `setTestMode` functions write incompatible JSON shapes to the same key; `getTestMode` (`test-ops.ts:15`) returns `{ enabled, env }` and ignores `label`, while `test-console.ts` callers would expect `label`. If anyone wires the dead `test-console.ts` `setTestMode`, the banner silently stops updating. Delete the dead implementation.

### F8 — `CRON_SECRET` is not in the validated env schema; cron guard reads raw `process.env`

`src/lib/cron/auth.ts:6` reads `process.env.CRON_SECRET?.trim()` directly. The validated env schema (`src/lib/env.ts:3-20`) does not include `CRON_SECRET` (nor `STRIPE_*`, `RESEND`, `UNSUBSCRIBE_HMAC_SECRET`). If `CRON_SECRET` is missing, `requireCronBearer` throws `503` **per request** rather than failing loud at boot — the app starts fine and every cron call degrades to 503. The inventory F-004 claims "boot fail-loud validation" for `CRON_SECRET`; the code does not deliver that for cron secrets. Add `CRON_SECRET` (and the other secret keys) to `envSchema` so a missing cron secret stops boot.

### F9 — Duplicate address-cleanup routes

Two routes expose address cleanup:

- `src/app/api/admin/address-cleanup/route.ts` — `GET` (queue) + `POST` (cleanup, optional `customerId`).
- `src/app/api/admin/addresses/cleanup/route.ts` — `GET` (queue) + `POST` (discriminated `cleanup` | `merge`).

Both call `listAddressReviewQueue` and `runAddressCleanup` from `lib/ops/address-cleanup.ts`. The `addresses/cleanup` route is a superset (adds `merge`). `address-cleanup` is a redundant subset. EXPECTED #3 mentions address-book cleanup once; two endpoints for the same op is a duplicated-route clean-code finding and doubles the surface for an authorization mistake (both currently use `admin.access` GET / `settings.write` POST, but a future change to one is easy to miss on the other).

### F10 — `runDressRehearsal` writes `REROUTE_CONFIRMED` audit without a reroute

`src/lib/ops/test-console.ts:261` writes `AuditAction.REROUTE_CONFIRMED` right after creating a shipping label, but no fulfillment-method switch occurred in that block (the reroute in the smoke is done separately via `switchFulfillmentMethod`). The audit action misrepresents the event — an auditor reading `REROUTE_CONFIRMED` for a dress-rehearsal order would infer a method change that never happened. Use `TEST_OPS_ACTION` (already written at line 277) or a dedicated dress-rehearsal action.

### F11 — S3 smoke FAIL: dry-run classifies every valid row as duplicate

Smoke S3 fails with `drySummary = { total: 5, valid: 0, duplicate: 4, invalid: 1 }`. The fixture (`smoke-p12.mjs:338-345`) has three unique-email rows (`p12.good.<stamp>`, `p12.soft.<stamp>`, `p12.soft2.<stamp>`) that should be `VALID`, plus one existing-customer duplicate and one invalid. All three unique rows were classified `DUPLICATE`. `classifyCustomerRows` (`lib/ops/import.ts:108-124`) marks a row duplicate when `seen.has(targetKey)` (intra-file) or when `db.customer.findFirst` matches. The unique emails have per-run stamps, so a DB match is implausible — the duplicate decision is coming from `seen` or from `normalizeEmail`/`normalizePhone` collapsing distinct inputs to the same `targetKey`. EXPECTED S3 ("Dry-run messy fixture; mapping + atomic commit; resume; dedupe rules applied") is not met: the dry-run cannot recognize a valid row, so `dryCommitted = 0` and the resume/dedupe evidence is meaningless. This is the phase blocker.

## What works

- Cron bearer auth itself is correct: `timingSafeEqual` with length check (`cron/auth.ts:13-17`), 401 on mismatch, 503 only when secret unset. S2/S5 cron `noAuth` returns 401 as expected.
- Reconciliation idempotency via `fingerprint = "orphan:" + piId` (`reconcile.ts:94`) prevents duplicate adjustments on rerun — S2 `recon2.createdAdjustments = 0, skippedDuplicates >= 1` confirms.
- CSV export writes `ExportAudit` + global `AuditAction.EXPORT_RUN` in one transaction (`exports.ts:185-211`) with sha256 checksum and row/byte counts; unauthorized export returns 403 (S2).
- Import commit is atomic per row (`db.$transaction` per row, `import.ts:600`) and resumable via `commitCursor` + `INTERRUPTED` status; `maxRows` interrupts cleanly (S3 `chunk1.interrupted = true`).
- Address merge is same-customer enforced and re-points `OrderLine` + `Package` in one transaction (`address-cleanup.ts:156-185`).
- `prior-year-stub` route is dev-only gated (`AUTH_MODE === "dev"` && `NODE_ENV !== "production"`, `prior-year-stub/route.ts:11`) — the correct env boundary pattern that `test-ops` should also follow.

## Suggested fix order (if acted on)

1. Add `IS_TEST_ENV` (or reuse `AUTH_MODE === "dev"`) gate to `test-ops` destructive actions; require `staff.impersonate` for wipe/reseed/dress (F1).
2. Fix S3 duplicate detection so unique emails classify as `VALID` (F11) — phase blocker.
3. Delete `cron/stripe-reconcile` or register it and delete `payment-reconcile`; keep one reconcile implementation (F2).
4. Gate import `GET ?batchId=` with `settings.write` or strip PII from the STAFF-readable shape (F4).
5. Align margin-data privilege: gate `reports?kind=margin` with `settings.write`, or lower the export gate (F5).
6. Make `wipeTestFixtures` match `runDressRehearsal` orders (`dressRehearsal`/`p12Fixture` markers) and add a smoke step that calls the route's `dressRehearsal` action (F6).
7. Delete the dead `test-console.ts` `setTestMode` + `wipeTestSeasonFixtures` (F7).
8. Add `CRON_SECRET` (and `STRIPE_*`, `RESEND`, `UNSUBSCRIBE_HMAC_SECRET`) to `envSchema` for fail-loud boot (F8).
9. Delete the redundant `address-cleanup` route, keep `addresses/cleanup` (F9).
10. Replace the bogus `REROUTE_CONFIRMED` audit in `runDressRehearsal` with `TEST_OPS_ACTION` (F10).
11. Add a `Payment` row (or a dedicated `IMPORTED` payment method/state) on legacy order commit so reconcile and reports agree (F3).
