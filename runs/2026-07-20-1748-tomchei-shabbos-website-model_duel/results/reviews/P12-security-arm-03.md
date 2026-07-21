# P12 Security Review — arm-03 (blind)

**Reviewer:** external security specialist
**Phase:** P12 — Reporting, exports, reconciliation, migration, launch readiness
**Tree:** `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/workspace`
**EXPECTED:** `shared/phases/PHASE-P12-EXPECTED.md`
**Scope:** trust boundaries, auth, secrets, IDOR, injection, export auth, cron bearer, Stripe reconcile. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Informational | 4 |
| **Total** | **11** |

Auth posture is solid for the new admin surface: every `/api/admin/*` route calls `requirePermission` (`admin.access` for reads, `settings.write` for mutations), and both cron reconcile routes gate on `requireCronBearer` with `timingSafeEqual` and fail closed (503) when `CRON_SECRET` is unset. Smoke S2 confirms unauthorized export → 403 and unauthenticated cron → 401. No IDOR was found in admin routes (all data is admin-scoped; `seasonId`/`batchId`/`sourceId`/`targetId` are server-validated and Prisma-parameterized — no raw SQL, no path injection). The findings below are trust-boundary smells, scale/DoS risks, and surface hygiene.

## Findings

### M-01 — Test-ops destructive/polluting actions have no environment guard  (Medium)

**Files:** `src/lib/ops/test-ops.ts`, `src/lib/ops/test-console.ts`, `src/app/api/admin/test-ops/route.ts`

`setTestMode`, `runDressRehearsal`, `wipeTestFixtures`, `reseedTestSeason`, and `scalePrintProbe` are gated only by `settings.write` (MANAGER) plus a `testMode.enabled` flag stored in `AppSetting`. There is no check against `NODE_ENV`, `AUTH_MODE`, or any "is this a production season" guard. In production with `AUTH_MODE=clerk`, a MANAGER can:

- Enable test mode (only effect is a UI banner — no operational lock).
- `runDressRehearsal` creates a real DRAFT → finalized → PAID order in the **live open season** with a CASH payment of `product.basePriceCents * 3` and a purchased shipping label (`src/lib/ops/test-console.ts:143-259`). This inflates revenue, margin, and audit with fake data in the real season.
- `scalePrintProbe` runs `runNightlyPrintBatch` against the real open season, creating real print artifacts and audit entries.

The wipe is fixture-scoped (`checkoutSnapshot.scaleFixture` / `draftRef startsWith "p12-"`), so it will not delete real customer orders — but the dress-rehearsal and scale-probe paths write live data with no environment separation. The test-mode banner is a UX signal, not a control. This contradicts the P12 "launch readiness" intent.

### M-02 — Reconcile loads all StripePaymentIntents unbounded (Medium)

**File:** `src/lib/ops/reconcile.ts:45-53`

`runPaymentReconcile` calls `db.stripePaymentIntent.findMany({ include: { order: { include: { payments: ... } } } })` with **no `take` and no pagination**, then iterates in JS memory. P12's stated goal is scale hardening at 1k orders / 5k packages. A cron job that pulls every StripePaymentIntent plus its order and posted payments into a single query can OOM the server or stall Postgres once the table grows. The Stripe-live path (`src/lib/payments/reconcile.ts:198`) caps at `limit: 100` and the mock fallback at `take: 500`, so only the ops path (the one wired to the scheduled `/api/cron/payment-reconcile` and the manual admin button) is unbounded.

## Low

### L-01 — Two divergent reconcile implementations (Low)

**Files:** `src/lib/ops/reconcile.ts` vs `src/lib/payments/reconcile.ts`

Two parallel reconcile code paths exist with incompatible contracts:

- Fingerprint: `orphan:<stripePaymentIntentId>` (ops) vs `sha256("orphan_pi:<id>").slice(0,40)` (payments).
- Adjustment `kind`: `ORPHANED_PAYMENT_INTENT` (ops) vs `ORPHAN_PAYMENT_INTENT` (payments).
- Orphan definition: ops flags any PI whose order is unpaid; payments flags any Stripe PI with no posted payment.
- Local-write side effect: payments path upserts a `stripePaymentIntent` row; ops path does not.

The scheduled cron (`payment-reconcile`) and the manual admin button both use the **ops** path; the **payments** path is only reachable via the unscheduled `stripe-reconcile` route. If both ever run for the same orphan, they create two distinct adjustment rows (different fingerprints, different `kind`) for the same PaymentIntent — reconciliation truth diverges. Trust-boundary inconsistency across two implementations of the same domain rule.

### L-02 — Stripe `metadata.orderId` trusted for local DB writes (Low)

**File:** `src/lib/payments/reconcile.ts:79, 122-133`

`runPaymentReconciliation` computes `orderId = localPi?.orderId ?? intent.metadata?.orderId ?? null` and, when `orderId && !localPi`, upserts a local `stripePaymentIntent` row linking the Stripe PI to that order and creates an `ORPHAN_PAYMENT_INTENT` adjustment. Stripe PaymentIntent `metadata` is treated as authoritative for local row creation. In the current checkout flow PIs are created server-side so metadata is merchant-controlled, keeping exposure low — but the trust boundary is wrong: external Stripe data drives local foreign-key writes without re-validating that the order exists, belongs to the expected season, or matches the PI amount. If a future flow lets a customer influence metadata, this becomes an order-impersonation vector.

### L-03 — CSV export builds full file in memory (Low)

**File:** `src/lib/ops/exports.ts:14-18, 165-223`; `src/lib/exports/center.ts:19-26, 222-279`

`toCsv` concatenates all rows into a single string and the route returns it as one `NextResponse` body. Dataset caps are 50,000 rows (DELIVERIES, ITEM_SALES, SHIPPING_MARGIN) and 20,000 (LAPSED_CUSTOMERS). A 50k-row CSV with several columns can be tens of MB held as one UTF-8 string plus one BOM-prefixed copy. A MANAGER running repeated large exports can drive memory pressure. No streaming, no row cap per request, no rate limit. (Also note: `src/lib/exports/center.ts` is a second, dead `runExport` implementation — duplicate surface, see I-04.)

### L-04 — `performanceReport` loads every order per season in memory (Low)

**File:** `src/lib/ops/reports.ts:37-104`

`performanceReport` does `db.order.findMany({ where: { seasonId, status: { not: DRAFT } }, include: { packages, payments } })` per season with no `take`. For multi-season requests (the default — no `seasonIds` filter) it loops every season and loads all non-draft orders with relations into JS, then aggregates in a `for` loop. At P12 scale this is unbounded and runs on every `/api/admin/reports?kind=performance` call (admin.access — STAFF and MANAGER). DoS-adjacent and contradicts scale-hardening.

### L-05 — `.env.example` ships non-placeholder dev secrets (Low)

**File:** `.env.example:28-57`

`.env.example` is committed (`.gitignore` allows `!.env.example`) and contains real-looking dev secret values rather than placeholders: `NEWSLETTER_HMAC_SECRET=tomchei-arm03-newsletter-hmac-dev-only`, `DRAFT_ACCESS_SECRET=tomchei-arm03-draft-access-hmac-dev-only`, `CRON_SECRET=tomchei-arm03-cron-dev-only`, `STRIPE_SECRET_KEY=sk_test_mock`, `STRIPE_WEBHOOK_SECRET=whsec_mock_dev_only`. These are dev-only, but a committed template should use placeholders (`<set-me>`) so operators don't ship the example value to production by accident. The smoke script also hardcodes a fallback (`process.env.CRON_SECRET || "tomchei-arm03-cron-dev-only"`), reinforcing the default.

## Informational

### I-01 — `/api/cron/stripe-reconcile` is not registered in `vercel.json` (Informational)

**Files:** `src/app/api/cron/stripe-reconcile/route.ts`, `vercel.json`

The route exists, is bearer-protected, and calls the Stripe-live `runPaymentReconciliation`, but `vercel.json` only schedules `payment-reconcile`. `stripe-reconcile` never runs on a schedule — it is only reachable by anyone holding `CRON_SECRET` via manual HTTP. Dead/unscheduled attack surface; also means the Stripe-live reconcile (the one that actually pulls from Stripe) never executes automatically, so the scheduled cron is local-only.

### I-02 — Reconcile cron routes accept both GET and POST (Informational)

**Files:** `src/app/api/cron/payment-reconcile/route.ts:51-65`, `src/app/api/cron/stripe-reconcile/route.ts:51-65`

Both routes export `GET` and `POST` running identical logic. Vercel Cron calls GET. The POST handler adds nothing functional and doubles the verb surface (both are bearer-gated, so not CSRFable, but unnecessary).

### I-03 — Duplicate address-cleanup endpoints (Informational)

**Files:** `src/app/api/admin/address-cleanup/route.ts`, `src/app/api/admin/addresses/cleanup/route.ts`

Two routes expose address cleanup, both `settings.write`-gated. The first only runs `runAddressCleanup`; the second adds a `merge` action via a discriminated-union schema. Same underlying `runAddressCleanup` in both. Redundant surface; the first endpoint is a strict subset and appears to be the older leftover.

### I-04 — Reconcile responses expose full Stripe PaymentIntent IDs (Informational)

**Files:** `src/app/api/admin/reconcile/route.ts:8-23`, `src/lib/ops/reconcile.ts:11-24, 145-153`

The admin reconcile GET returns `adjustments` with `stripePaymentIntentId`, `orderId`, `amountCents`; the POST returns `orphans` with the same plus `status`. Stripe PaymentIntent IDs are payment credentials-adjacent and order IDs are internal. Admin-only (settings.write), so acceptable, but the response should minimize — return only counts and a cursor/preview, not the full PI IDs for every orphan.

## Out of scope notes

- `src/lib/exports/center.ts` (`runExport` / `listExportHistory`) is a second, unreferenced export implementation (dead code). Clean-code issue, not security; mentioned here for awareness.
- `.env` itself is gitignored (`.gitignore:34` excludes `.env*` except `.env.example`). No committed live secrets were found.
- `requireCronBearer` correctly uses `timingSafeEqual` with a length pre-check and fails closed when `CRON_SECRET` is unset. No finding.
- All admin routes reviewed use `requirePermission` with the correct permission tier; no missing-auth routes found in the P12 surface.
