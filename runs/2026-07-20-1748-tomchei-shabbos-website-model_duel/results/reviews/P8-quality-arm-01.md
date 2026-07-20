# P8 Quality Review — arm-01

Reviewer: Quality specialist (blind to model name)
Phase: P8 — Shipping: Shippo, rate margin, labels
Reference: `shared/phases/PHASE-P8-EXPECTED.md`, `kit/prompts/reviewer/review-quality.md`
Scope: `arms/arm-01/workspace/` P8 surface — `src/lib/shippo.ts`, `src/domain/shipping.ts`, `src/components/shipping-actions.tsx`, `src/app/api/admin/shipping/route.ts`, `src/app/api/checkout/stripe/route.ts` (shipping wiring), `src/app/(admin)/admin/fulfillment/page.tsx` + `orders/[orderId]/page.tsx` (shipping UI), `prisma/migrations/20260721043000_p8_shipping/migration.sql`, `tests/shipping.test.ts`, `scripts/p8-smoke.ts`, and `.scratch/PHASE-P8-SMOKE.md`.
Findings only — no fixes.

## Summary

Unit smoke (`tests/shipping.test.ts`) and the `scripts/p8-smoke.ts` S1–S3 harness assert the margin engine, planner, void/rebuy, validation, and tracking happy paths. The five EXPECTED invariants are observable in code. The defects below are correctness/robustness issues the smoke does not exercise — carrier-account wiring, the buy/void concurrency model, the live Shippo track endpoint, and missing smoke evidence.

## Findings

### H1 — Org FedEx + UPS carrier accounts never sent to Shippo (R-173, R-183, R-184)
`ShippoProvider`'s constructor takes only `SHIPPO_API_TOKEN` (`shippo.ts:71-72`) and `getShippingProvider()` passes only that token (`shippo.ts:199-203`). `SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID` are declared in `src/lib/env.ts:7-8` and `.env.example:23-24` but are never read and never sent on the `/shipments/` POST — the request body (`shippo.ts:101-113`) has no `carrier_accounts` field. EXPECTED #1 requires the wrapper to operate "with org FedEx + UPS accounts" and "typed optional-provider env handling (R-183, R-184)"; the IDs are dead config, so live quotes/labels are not bound to the org's negotiated carrier accounts. Severity: **High** (spec gap; functional).

### H2 — `buyPackageLabel` double-purchase race
The "no active PURCHASED label" guard runs outside any transaction (`shipping.ts:267-270`), then `provider.buyLabel` — an external, non-idempotent charge — is called *before* the DB transaction that records the label (`shipping.ts:289-308`). Two concurrent POSTs to `/api/admin/shipping` (action `buy`) both pass the guard, both call Shippo, and both insert PURCHASED rows. The `providerTransactionId` unique index only dedupes identical Shippo transaction IDs, which distinct purchases will not share, so the race produces two paid labels and a double charge with no DB-level prevention. Severity: **High** (correctness/concurrency).

### M1 — `voidPackageLabel` voids at the provider before the DB transaction
`provider.voidLabel` is called outside the transaction (`shipping.ts:362`); the `shippingLabel.update` → `VOIDED` and the `packageAudit` write happen in a separate transaction afterward (`shipping.ts:363-377`). If that transaction fails, the label is voided at Shippo but remains `PURCHASED` in the DB — external/DB inconsistency with no compensation path. Severity: **Medium** (correctness/external state).

### M2 — Label-failure compensation (R-175) is not audited and runs outside a transaction
On `buyLabel` failure, a `FAILED` `ShippingLabel` row is written with no `packageAudit` entry and outside any transaction (`shipping.ts:328-343`). Successful purchases write a `shipping.label_purchased` audit; failures leave no audit trail, and the FAILED-row write itself can fail silently. R-175's "label-failure compensation" is only partially met — the failure is recorded but neither audited nor compensated (no quote-state rollback, no staff-visible signal beyond the orphaned FAILED row). Severity: **Medium** (correctness/audit).

### M3 — Shippo `track` endpoint shape is wrong (R-176)
`ShippoProvider.track` POSTs to `/tracks/{carrier}/{trackingNumber}` with no body (`shippo.ts:162-165`). Shippo's tracking API is `POST /tracks` with a `{ carrier, tracking_number }` body, or `GET /tracks/{carrier}/{tracking_number}`; the path used here is not a documented Shippo endpoint. `refreshPackageTracking` will fail against live Shippo, so R-176 (tracking refresh) is not actually satisfied in production despite the smoke stub asserting `IN_TRANSIT`. Severity: **Medium** (correctness; live integration).

### M4 — Missing smoke evidence file
EXPECTED names the evidence path `arms/{id}/workspace/.scratch/PHASE-P8-SMOKE.md`. No `.scratch/PHASE-P8*` file exists in the arm-01 workspace. The smoke driver (`scripts/p8-smoke.ts`) and `npm run smoke:p8` task exist, but no recorded PASS transcript was produced/committed, so the phase gate has no smoke evidence artifact. Severity: **Medium** (protocol).

### M5 — Multi-parcel label associated to only one `ShipmentBox`
`buyPackageLabel` attaches the label to `firstBox` (the highest-sequence box) only (`shipping.ts:285-308`). For shipments planned into multiple `ShipmentBox` rows, the remaining boxes have no `shippingLabels` link, so the board/order-detail cannot show per-box label state and void/rebuy semantics for multi-parcel shipments are incomplete. Severity: **Medium** (correctness for multi-box shipments).

### L1 — `planShipment` is volume-only, not geometric bin packing (R-081)
The planner verifies each unit's dims ≤ box dims, then co-packs by cumulative volume + weight (`shipping.ts:57-104`). Items whose volumes sum under box capacity but whose shapes do not geometrically fit are incorrectly co-packed. Acceptable as "shipment planning" but not true 3D bin packing. Severity: **Low**.

### L2 — `selectShippingMargin` eligibility re-filter duplicates `getRates`
`getRates` already restricts carriers to fedex/ups/usps and requires `object_id` + `amount` (`shippo.ts:121`); `selectShippingMargin` re-applies the same carrier/currency filter (`shipping.ts:29-34`). Harmless duplication today, but a drift hazard if the eligible-carrier set changes. Severity: **Low**.

### L3 — Checkout disables SHIPPING for all lines when one line fails rate quoting
`checkout/stripe/route.ts:77-93` sets `isLiveShippingAvailable = false` if `quoteDraftShipping` throws for any address (e.g., one product missing dimensions), which disables the SHIPPING option for every line in the cart via `checkout-form.tsx:198-200`. One bad product suppresses live shipping for all recipients. Severity: **Low** (UX).

### L4 — `buyLabel` rejects any status other than `SUCCESS`
`shippo.ts:141-143` treats `payload.status !== "SUCCESS"` as failure. Shippo sync transactions can return `QUEUED`/`PENDING` for some carriers; legitimate pending purchases would be rejected and recorded as `FAILED`, forcing a rebuy. Severity: **Low**.

### L5 — `quoteDraftShipping` does not persist draft quotes
Only `quotePackage` writes `ShippingQuote` rows (`shipping.ts:232-243`). Draft-stage quotes are recomputed on every checkout GET and POST and never stored, so there is no draft-stage reconciliation record for margin spread. Acceptable for P8 (reconciliation UI is P12) but worth noting. Severity: **Low**.

## Severity counts

- **High:** 2
- **Medium:** 5
- **Low:** 5
- **Total:** 12

## EXPECTED coverage (no findings — met)

- #1 Shippo wrapper rate/buy/void/track/validate (R-173): five methods present; **but see H1 (carrier accounts) and M3 (track endpoint)** — partially met.
- #2 Margin engine (UR-003, G-006): `selectShippingMargin` charges highest, buys cheapest eligible, records `marginCents` ✓
- #3 Bin packing + shipment planning (R-081): `planShipment` present; **see L1 (volume-only approximation)**.
- #4 Label create/void from order detail + package board (R-055), label-failure compensation (R-175), tracking refresh (R-176), address validation (R-177): `ShippingActions` mounted on both pages; **see M1/M2/M3 for void/failure/track defects**.
- #5 Checkout uses live Shippo quotes: `quoteDraftShipping` wired into checkout GET + POST, replacing the P5 flat-fee path for SHIPPING ✓
