# PHASE-P8-STATUS — arm-03

**Phase:** P8 — Shipping: Shippo, rate margin, labels  
**Result:** PASS  
**Smoke:** 3/3 (`arms/arm-03/results/PHASE-P8-SMOKE.md`, also `.scratch/PHASE-P8-SMOKE.md`)  
**Ports:** web 3103 / db 4103  

## Delivered

1. Shippo wrapper — rate / buy / void / track / validate (mock + live/test); org FedEx+UPS account env; UPS direct slots declared only (R-183/R-184)
2. Margin engine — charge highest eligible ground quote, buy cheapest, store charged/purchased/margin on ShippingLabel
3. Bin packing + shipment plan against PackageType boxes; persisted on Package.shipmentPlan
4. Label create/void from order detail + package board; label-failure compensation; tracking refresh; address validation
5. Checkout live Shippo rates via `resolveDeliveryFeesLive` (replaces P5 placeholder for SHIP)
6. P9 stub — `routeAssignedAt` blocks void of routed labels; printed-but-unshipped remains voidable

## Fixes this spawn

- Checkout session imports `resolveDeliveryFeesLive`
- Label audits put `labelId` in meta (AuditLog.targetId is StaffUser FK only)

## Blockers

none
