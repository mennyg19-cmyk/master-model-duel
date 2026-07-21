# P8 fix pass — arm-02

**Input:** `results/AGGREGATE-REVIEW-P8.md` (2 blockers, 8 majors). One pass, all 10 addressed.
**Re-smoke:** S1–S3 per `shared/phases/PHASE-P8-EXPECTED.md` — all pass, evidence at `workspace/.scratch/PHASE-P8-SMOKE.md`.
**Gates:** `npm run ci` green (lint, typecheck, migration guard, 62/62 unit tests), `npm run build` green.

## Blockers

| # | Fix | Where |
|---|---|---|
| B1 | `SESSION_SECRET` fail-closed: a `PUBLIC_SESSION_SECRET_DEFAULTS` set (the `.env.example` placeholder) is refused whenever the app is in real mode — production runtime, or a live Stripe/Shippo credential present — via the same `superRefine` posture as the Stripe webhook-secret guard. `.env.example` documents the refusal. Verified by `.scratch/p8-fix-env-guard.ts` (PASS). | `lib/env.ts`, `.env.example` |
| B2 | Void and tracking Shippo failures now surface as `ActionError` (status 502) with a human message and a "nothing changed" guarantee, matching the buy path. The routes' existing `ActionError` handling picks them up — no more opaque 500. | `lib/shipping/labels.ts` (`voidShipmentById`, `refreshShipmentTracking`) |

## Majors

| # | Fix | Where |
|---|---|---|
| M1 | Void is now DB-first and idempotent: a guarded `updateMany(status: PURCHASED → VOIDED)` inside a transaction wins exactly once (a concurrent/repeat void gets a clean refusal, never a second carrier refund); the carrier refund runs after. If the carrier refuses, the flip is rolled back with a `label_void_failed` audit and an `ActionError` — the label stays active and retry is clean. The bad direction (carrier refunded while DB says PURCHASED) can no longer occur. | `lib/shipping/labels.ts` |
| M2 | Concurrent buys serialized with a per-package `pg_advisory_xact_lock` (same pattern as `finalize.ts`): the second POST waits, re-checks for an active shipment, and refuses **before** reaching Shippo — no double charge, no double PURCHASED row. Backstops: partial unique index `Shipment_packageId_purchased_key` (`WHERE status='PURCHASED'`), and if the DB write fails after a successful carrier charge, the label is void/refunded and a FAILED row keeps the trace. The Shippo call inside the lock is bounded by the new 15s timeout (txn timeout 45s). Smoke: two simultaneous buys → statuses 200/409, exactly 1 PURCHASED row. | `lib/shipping/labels.ts`, migration `20260721120000_p8_fix_pass` |
| M3 | `shippoFetch` aborts via `AbortSignal.timeout(SHIPPO_TIMEOUT_MS = 15_000)`; timeouts/network failures become `ShippoError` with a human message. | `lib/shipping/shippo.ts` |
| M4 | `Shipment.chargedCents` anchors to the customer-paid checkout quote: shipping fee lines frozen onto `Order.feeBreakdown` now carry `destination` (destinationKey) + `quoteId`; `buyLabelForPackage` looks the package's destination up in its order's fee lines and records **that** charge and margin. The fresh label-time quote still picks the rate to buy (its rateId must be live). Fallback: staff-built packages / pre-fix orders with no paid shipping line record the label-time charge, as before. Smoke: paid 1740 vs fresh 1490 → shipment recorded 1740, margin exact. | `lib/shipping/labels.ts`, `lib/checkout/fees.ts`, `lib/checkout/quote.ts`, `lib/checkout/create-order.ts` |
| M5 | Live `getRates` includes USPS via optional `SHIPPO_USPS_ACCOUNT_ID` in `carrier_accounts` (Shippo omits services parcels aren't eligible for). Mock eligibility path unchanged. | `lib/shipping/shippo.ts`, `lib/env.ts`, `.env.example` |
| M6 | `Shipment.quoteId` FK → `ShippingQuote` (nullable, `SET NULL`): the customer-paid checkout quote when matched, else the label-time comparison quote. Checkout `ShippingQuote` rows are linked to the order (`orderId`) at order creation, so they're no longer orphaned. | `prisma/schema.prisma`, migration, `lib/checkout/create-order.ts` |
| M7 | Smoke harness re-run post-fix; `workspace/.scratch/PHASE-P8-SMOKE.md` regenerated with S1–S3 evidence (19/19 checks incl. three new fix checks) + fix-pass gates section. | `.scratch/p8-smoke.ts`, `.scratch/PHASE-P8-SMOKE.md` |
| M8 | `CarrierRate` / `Parcel` / `ShipAddress` moved to neutral `lib/shipping/types.ts`; `mock-rates.ts` and `shippo.ts` both import from it (live no longer depends on the mock module for types). Public import surface unchanged (`shippo.ts` re-exports). | `lib/shipping/types.ts`, `lib/shipping/mock-rates.ts`, `lib/shipping/shippo.ts`, `tests/shipping-margin.test.ts` |

## Notes / residual

- M4 anchor matches by destinationKey within the package's order(s); two packages for different recipients at one merged consignment address would each anchor to the same consignment charge — acceptable for P12 as the charge genuinely was per consignment, flagged for the reconciliation phase.
- M5 still requires the operator to configure the USPS carrier-account id; without it live mode stays FedEx/UPS (fail-closed guard for the two negotiated accounts unchanged).
- Minors (m1–m21) intentionally untouched — out of scope for a single blocker/major fix pass.
- Migration `20260721120000_p8_fix_pass` applied; migration guard passes (partial index follows the existing P2 precedent).
