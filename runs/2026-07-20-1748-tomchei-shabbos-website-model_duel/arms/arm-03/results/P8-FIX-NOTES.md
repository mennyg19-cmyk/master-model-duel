# P8 Fix Notes — arm-03

**Phase:** P8 — Shipping: Shippo, rate margin, labels  
**Tree:** `arms/arm-03/workspace/`  
**Source:** `AGGREGATE-REVIEW-P8.md`  
**Smoke after fix:** 3/3 PASS (`PHASE-P8-SMOKE.md`)

## Fixed

### Blockers

| ID | Fix |
|---|---|
| **B1** | Checkout + label purchase now share bin-pack → parcels via `resolveParcelsForItems` / `planToParcels`. Checkout no longer quotes a hardcoded `DEFAULT_PARCEL` while labels use plan parcels. |
| **B2** | `planToParcels` emits one Shippo parcel per packed box; `getRates` / `quoteMargin` take `parcels[]`; mock multiplies fixture rates by parcel count. |
| **B3** | `buyLabel(rateId, idempotencyKey)` sends Shippo idempotency key; labels store unique `ShippingLabel.idempotencyKey` (`label-buy:{packageId}`); race on DB write after SUCCESS returns existing PURCHASED row. |
| **B4** | Removed `LabelError`; domain failures throw `ApiError` and go through `apiErrorResponse` only. |
| **B5** | Shared `buildCheckoutSnapshot()` used by `prepareCheckout` and `createHostedCheckoutSession` (includes `liveShip`, `shipQuotes`, `capturedAt`). |
| **B6** | Label audits use `writeAudit(..., tx)` + `labelAuditMeta()`; checkout-started also routed through `writeAudit`. |

### Critical majors (prioritized)

| ID | Fix |
|---|---|
| **M1** | Client-facing label errors are safe `ApiError` messages (no raw Shippo body). Internal reason still stored on FAILED rows. |
| **M2** | `computePackageShipmentPlan` is read-only; `shipmentPlan` persists only after successful label purchase. |
| **M3 / R-176 / R-177** | Order detail: Validate address + Refresh tracking buttons; package board: Refresh tracking. Routes expose `validate` / `refresh`. |
| **M4** | Per-destination checkout quotes run via `Promise.all`. |
| **M5** | Live `buyLabel` maps transaction `amount` / rate provider into `amountCents` / `carrier` / `serviceLevel`; label row prefers txn values when present. |
| **M6** | Deleted dead `resolveDeliveryFees`; exported shared `destinationKey` / `addressOnlyKey` from `delivery.ts`. |
| **M8** | Live `validateAddress` returns Shippo-normalized fields (not the input echo). |
| **M10** | `refreshTracking` write + audit wrapped in `db.$transaction`. |
| **M12** | Trimmed redundant `GROUND_SERVICES` case variants; clearer `selectMargin` expected-state error. |
| **FedEx org account** | Live `getRates` passes `carrier_accounts` from `SHIPPO_FEDEX_ACCOUNT_ID` / `SHIPPO_UPS_ACCOUNT_ID`. |

## Skipped (with why)

| ID | Why skipped |
|---|---|
| **M7** | Workflow scratch files (`.scratch/phase-plan.md`, `run-state.md`) — process hygiene, not money/runtime; contestant fix pass targets code blockers. |
| **M9** | Address-shape conversion consolidation — low risk; three thin mappers remain intentional (Package / CheckoutLine / Shippo API). |
| **M11** | Mock-id helper consolidation — cosmetic; mock mode only. |
| **M13** | `BoxType` vs Prisma `PackageType` Pick — type tidy, not a P8 gate blocker. |
| **m1–m17** | Minors (admin IDOR polish beyond package↔order bind already added, public GET rate-limit, process-local limiter, UPS declaration-only env, placeholder setting leftover, smoke dead booleans, etc.) — out of prioritized critical set for this fix pass. Package↔order bind on create/void **was** tightened as part of route hardening (related to m1). |

## Files touched (primary)

- `src/lib/shippo/client.ts`
- `src/lib/shipping/{labels,bin-packing,margin,checkout-rates}.ts`
- `src/lib/checkout/{delivery,session}.ts`
- `src/app/api/admin/orders/[id]/labels/route.ts`
- `src/app/api/admin/packages/[id]/label/route.ts`
- `src/components/admin/{order-detail,package-board}.tsx`
