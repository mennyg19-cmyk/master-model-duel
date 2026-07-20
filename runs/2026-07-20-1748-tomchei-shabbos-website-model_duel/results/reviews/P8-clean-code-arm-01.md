# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P8 — Shipping: Shippo, rate margin, labels
**Output:** `results/reviews/P8-clean-code-arm-01.md`
**Scope:** P8 new/modified files under `arms/arm-01/workspace/` (`lib/shippo.ts`, `domain/shipping.ts`, `app/api/admin/shipping/route.ts`, `app/api/checkout/stripe/route.ts`, `components/shipping-actions.tsx`, `components/checkout-form.tsx`, `components/fulfillment-board.tsx`, `app/(admin)/admin/orders/[orderId]/page.tsx`, `app/(admin)/admin/fulfillment/page.tsx`, `lib/admin-operations.ts`, `lib/env.ts`, `prisma/migrations/20260721043000_p8_shipping/migration.sql`, `scripts/p8-smoke.ts`, `tests/shipping.test.ts`). Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Summary

P8 lands a clean shipping surface with good reuse of prior primitives (`requirePermission` / `AccessDeniedError`, `$transaction` + `packageAudit`, the `ShippingProvider` interface that lets the smoke test inject fixtures, and a pure `selectShippingMargin` / `planShipment` pair that is unit-tested). The margin engine and label-failure compensation are correct and well-scoped. New concerns cluster around **client-side re-implementation of the fulfillment-fee rule**, **two UI pages recomputing margin math with a different rule than the server**, **FedEx/UPS account env plumbed but never sent to Shippo**, and a **mixed-concern `shipping.ts`** that is one concern away from a god file. Smaller duplication and pattern-drift items below.

## Findings

### High

1. **Fulfillment-fee logic duplicated between client and server** — `components/checkout-form.tsx:77-95` re-implements `calculateFulfillmentFees` (`domain/checkout.ts:40`) in the browser: the same `chargedGroups` Set, the same group key (`fulfillmentCode:orderLineId` for `PACKAGE_DELIVERY`, else `fulfillmentCode:addressId`), and the same SHIPPING-from-`shippingFeesByAddressId` lookup with the `fulfillmentFees[code]` fallback. The server function is already pure (no Prisma, no I/O), so it is shareable as-is. Two implementations of the pricing rule will drift the moment one side changes a group key or a SHIPPING fallback; the live total shown to the customer can silently diverge from the cents actually charged by `prepareCheckout`. Extract the pure function to a shared module and call it from both sides.

2. **`SHIPPO_FEDEX_ACCOUNT_ID` / `SHIPPO_UPS_ACCOUNT_ID` are plumbed but never consumed** — `lib/env.ts:7-8,26-27` reads both into `ServerEnvironment`; `.env.example:23-24` and `scripts/generate-env-example.mjs:25-26` document them; but grep finds no read beyond `env.ts`. `ShippoProvider.getRates` (`lib/shippo.ts:94`) never sends `carrier_accounts` (or any account id) to Shippo, so the org FedEx + UPS accounts required by R-183/R-184 are declared in config and dead in code. Either wire them into the Shippo shipment body or drop them from the env type and examples until they are real.

### Medium

3. **Margin math duplicated across two UI pages with a different rule than the server** — `app/(admin)/admin/orders/[orderId]/page.tsx:71-79` and `app/(admin)/admin/fulfillment/page.tsx:121-138` both compute `chargedCents = Math.max(...quoteAmounts)`, `purchasedCents = Math.min(...quoteAmounts)`, `marginCents = chargedCents - purchasedCents` inline. The server's `selectShippingMargin` (`domain/shipping.ts:28`) first filters to eligible carriers (`fedex`/`ups`/`usps`), `amountCents > 0`, and `currency === "usd"` before reducing. The UI min/max runs over every stored quote with no eligibility filter, so a zero-amount, non-USD, or non-eligible-carrier quote would make the displayed charge/purchase/margin diverge from the values recorded on the label by `quotePackage`/`buyPackageLabel`. Two copies of the rule plus a silent eligibility gap — extract `summarizeQuotes(quotes)` (or reuse `selectShippingMargin`'s output) for the UI.

4. **Eligible-carrier list duplicated** — `["fedex","ups","usps"]` is hard-coded in `lib/shippo.ts:121` (filtering Shippo rates) and again in `domain/shipping.ts:31` (`selectShippingMargin` eligibility). Two sources of truth for "eligible carriers"; adding or removing a carrier (or casing) requires touching both, and the two filters already case-normalize differently (`rate.provider ?? ""`.toLowerCase()` in shippo vs `rate.carrier.toLowerCase()` in shipping). Extract one `ELIGIBLE_CARRIERS` constant (lower-cased) and a single `isEligibleRate` predicate.

5. **Product-to-shipment-product mapping duplicated** — `loadPackagePlan` (`domain/shipping.ts:176-188`) and `quoteDraftShipping` (`:450-462`) both map a line to `{ quantity, widthMm, heightMm, depthMm, weightGrams }` with the same `!product.widthMm || !product.heightMm || !product.depthMm || !product.weightGrams` guard and the same `${product.name} needs dimensions and weight before shipping.` error. Extract a `toShipmentProduct(product, quantity)` helper so the validation and message stay in one place.

6. **`domain/shipping.ts` is a mixed-concern file (485 lines, 5 concerns)** — margin selection (`selectShippingMargin`), bin-packing (`planShipment` / `volume` / `toParcel`), address mapping (`snapshotAddress` / `organizationAddress`), package-plan loading (`loadPackagePlan`), and the quote/buy/void/track/validate orchestration all live in one module. The arm rule says split when >500 lines **or mixed concerns**; this is the latter. Candidates: `shipping-margin.ts`, `shipping-planner.ts`, `shipping-ops.ts` (orchestration). Splitting now is cheaper than after P9/P12 add reconciliation reporting.

7. **Env-access pattern drift** — `lib/env.ts` centralizes env reading through `readServerEnvironment()` (called from `lib/db.ts`), but `lib/shippo.ts:200` reads `process.env.SHIPPO_API_TOKEN` directly and `domain/shipping.ts:131-150` `organizationAddress()` reads `process.env.SHIP_FROM_*` directly (with `!` assertions after a manual loop). Two patterns for the same concern; the centralized reader is bypassed for every shipping config value. Route shipping env through `readServerEnvironment()` (or extend it) so there is one place that owns env access and one place that throws on missing required values.

### Low

8. **Magic values: rate TTL and stage strings** — `lib/shippo.ts:131` `new Date(Date.now() + 20 * 60 * 1000)` is an unnamed 20-minute rate-expiry constant; `components/shipping-actions.tsx:109` `["SENT","PICKED_UP"].includes(packageRecord.stage)` hard-codes `PackageStage` values that already exist as a Prisma enum. Name the TTL (`RATE_TTL_MS`) and import the enum / a shared stage list for the void guard.

9. **Redundant DB sort in package-type queries** — `domain/shipping.ts:174` and `:437` both query `packageType.findMany` with `orderBy: { innerDepthMm: "asc" }`, but `planShipment` (`:58`) immediately re-sorts the boxes by volume ascending. The DB ordering is dead — drop it or align the two sorts.

10. **Inline box-volume recompute in `planShipment`** — `domain/shipping.ts:84-85` recomputes `fittingBox.innerWidthMm * fittingBox.innerHeightMm * fittingBox.innerDepthMm` inline while a `volume()` helper exists for products (it cannot accept a box shape). The `box.maxWeightGrams ?? Number.POSITIVE_INFINITY` fallback is also written twice (`:78`, `:89`). A `boxVolume(box)` helper (or widening `volume`) would remove the inconsistency and the duplicated fallback.

11. **Generic 409 for all shipping-route errors** — `app/api/admin/shipping/route.ts:62-65` maps every non-`AccessDeniedError` throw — Shippo 5xx, DB failure, "Void the active label before buying another", "A sent or picked-up package label cannot be voided" — to HTTP 409 with the original message. 409 implies conflict; a provider outage or missing row is not a conflict. This also loses status granularity vs. the `publicRequestErrorResponse` shape used by `api/checkout/stripe/route.ts`. Discriminate at least provider/validation (409) from infrastructure (500) errors.

## Counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **11** |
