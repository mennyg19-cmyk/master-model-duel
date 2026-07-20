# P8 fix pass — arm-01

Single fix pass completed for the aggregate P8 blockers and priority majors.

## Fixed

- **B1:** `buyPackageLabel` now locks the package row and performs the active-label guard, package-plan guards, quote selection, provider purchase, label persistence, quote selection, and audit in one serializable transaction. Concurrent purchases for one package serialize before the provider charge.
- **B2:** `ShippoProvider` accepts configured carrier account IDs and sends them as `carrier_accounts`; `getShippingProvider` wires both `SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID`.
- **B3:** fulfillment fee calculation moved to the browser-safe `domain/fulfillment-fees.ts` module and is shared by checkout UI and server checkout preparation.
- **M1:** label void provider call now runs after a package row lock and inside the same database transaction as local status and audit updates.
- **M2:** label purchase calls `loadPackagePlan` inside the locked transaction, enforcing active, shipping-method, and unfulfilled-stage guards before purchase.
- **M3:** checkout GET shipping quotes are throttled to 10 requests per source IP per minute.
- **M4:** Shippo and ship-from configuration now comes through `readServerEnvironment`.
- **M5:** provider purchase failures create the `FAILED` label and attributed `shipping.label_purchase_failed` package audit atomically before the original error is rethrown.
- **M6:** Shippo tracking uses documented `POST /tracks/` with `carrier` and `tracking_number`.

## Verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run smoke:p8` — S1, S2, S3 PASS

No P8 aggregate blocker remains after this pass.
