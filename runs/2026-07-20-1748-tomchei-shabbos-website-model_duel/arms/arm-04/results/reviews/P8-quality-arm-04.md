# P8 Quality review — arm-04 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**EXPECTED:** `shared/phases/PHASE-P8-EXPECTED.md`
**Scope:** `arms/arm-04/workspace/` (shipping lib, checkout fee integration, label service, smoke, migration, schema)
**Mode:** Findings only, no fixes. Blind to model identity.

## Summary

P8 ships the five EXPECTED items: a five-verb provider interface with a Shippo `fetch` adapter and a loopback-only stand-in, a pure margin engine, bin packing, label buy/void/track/validate, and live checkout rates with a flat-rate fallback. The structure is clean, the smoke table is honest, and the env guard correctly refuses the stand-in off-loopback. The margin math is correct *when the buy-time quote matches the checkout-time quote* — which the deterministic stand-in guarantees and real Shippo does not. One high-severity correctness gap follows from that, plus a few minor data-completeness and defense-in-depth notes.

## Findings

### F1 — HIGH — Margin recorded at label buy uses the fresh quote's highest, not the frozen customer fee (UR-003 / G-006 regression)

`buyLabelForPackage` re-quotes live in `quoteFor` (correct — rates go stale), then `claimParcels` writes the per-parcel `customerPriceCents` and `marginCents` from that *fresh* quote's `customerPriceCents` (the highest eligible at buy time):

```347:384:arms/arm-04/workspace/src/lib/shipping/label-service.ts
  const shares = allocateCustomerPrice(quote.customerPriceCents ?? purchase.costCents, quote.parcels.length);
  ...
  carrierCostCents: parcelCosts[index],
  customerPriceCents: shares[index],
  marginCents: shares[index] - parcelCosts[index],
```

`box.fulfillmentFeeCents` — the amount the customer was actually charged at finalize — is never read in `label-service.ts`. UR-003/G-006 require the recorded spread to be `charged - paid`. Here it is `newQuoteHighest - newQuoteCheapest`. With real Shippo the highest eligible rate at label-buy time can differ from the fee frozen on the package at checkout, so:

- `ShipmentBox.customerPriceCents` can disagree with `Package.fulfillmentFeeCents`.
- `ShipmentBox.marginCents` and the `shipping.label_purchased` audit `detail.marginCents` record a spread the org did not keep.
- P12 reconciliation summing `marginCents` would produce a number that does not tie back to the money.

The smoke does not catch this. S1c asserts `purchased[0].customerPriceCents === box.fulfillmentFeeCents` and `purchased[0].marginCents === box.fulfillmentFeeCents - cheapest.carrierCostCents`. The local stand-in prices as a deterministic function of ZIP + weight, so the buy-time quote is identical to the checkout-time quote and the assertions hold. The moment a real carrier returns a different rate table minutes later, both assertions can fail and the recorded margin is wrong. This is exactly the "smoke missing" class the reviewer prompt asks to flag.

Severity high: it is a correctness regression against EXPECTED item 2 (margin math UR-003/G-006), latent only because the stand-in is deterministic.

### F2 — LOW — `ShippingQuoteOption.providerRateId` stores only the first parcel's rate id

`optionRow` writes `providerRateId: option.rateIds[0] ?? null`. For a multi-parcel box the option row carries the first parcel's Shippo rate id and drops the rest. The per-parcel `ShipmentBox.providerRateId` is stored correctly (`purchase.rateIds[index]`), so the missing ids are recoverable from the parcel rows, but the option-row reconciliation view only shows one. Minor data-completeness gap for P12; not a correctness bug.

### F3 — LOW — `validatePackageAddress` does not gate on `methodKind === 'SHIPPING'`

`validatePackageAddress` reads any package on the board and checks address completeness, but never verifies the box is a shipping box. A pickup box has no address by design and returns `ADDRESS_NOT_CHECKABLE`, which is the right answer for the wrong reason. The button only renders on the `CarriageCard` (shipping boxes only), so this is defense-in-depth against a forged `packageId`, not a live bug. The buy/void/tracking actions share the same shape and are similarly gated only by `fulfillment.manage` + season scope, which is sufficient for those because `readShippable` and `voidLabelForPackage` re-check the box state.

### F4 — LOW — `combineParcelRates` eligibility can mis-fire if a carrier returns duplicate service rates on one parcel

`combineParcelRates` groups by `${carrier}:${serviceCode}` and pushes every rate into `parcels`. If a carrier ever returned two rates for the same `carrier:serviceCode` on a single parcel, `parcels.length` would exceed `parcelRates.length` and the service would be marked ineligible. Shippo returns one rate per service per parcel, so this is latent. Worth a one-line guard if Shippo's schema ever widens; not live today.

## Smoke coverage assessment

The 16-check smoke table is honest and well-targeted. Gaps:

- **No check that the recorded margin ties back to the frozen fee under rate movement.** S1c would catch F1 if the stand-in ever returned different rates at buy vs checkout, but the stand-in is deterministic by design, so it cannot. A smoke variant that forces a rate change between finalize and buy (e.g., a second destination, or a stand-in hook that bumps prices on the second quote) would surface F1.
- **No multi-parcel smoke.** S1 walks a one-parcel box. The `allocateCustomerPrice` unit test covers the arithmetic, but no smoke proves a multi-parcel box buys one label per parcel and that the rows sum to the box total. The bin-packing unit test covers planning; the label buy path for `parcels.length > 1` is unit-tested only indirectly.
- **No FALLBACK smoke.** The fallback path (`origin unset`, `boxTypes empty`, carrier outage) is unit-tested, but no smoke proves checkout still prices a shipping box at the settings flat rate when the carrier is down. P8-EXPECTED item 5 says "replace P5 placeholder where applicable"; the fallback is the safety net and is only exercised by unit tests.

## Regressions vs EXPECTED

- Item 1 (Shippo wrapper, five verbs, org accounts, typed env): delivered. `shippo-api.ts` is the only file that speaks inches/pounds/decimal strings; `carrierAccounts()` offers FedEx/UPS only when configured; env schema refuses `shippo` without a token and `local` off-loopback.
- Item 2 (margin engine UR-003/G-006): delivered structurally, but **see F1** — the recorded spread is not anchored to the charged amount.
- Item 3 (bin packing R-081): delivered. Smallest-fitting carton, spill into largest, heaviest-first. Volume+weight only, with an 80% fill factor — documented as a deliberate scope choice.
- Item 4 (label create/void, R-175 compensation, R-176 tracking, R-177 validation): delivered. The two-step claim (PENDING before carrier call) and the compensation-on-failure path are correct. `VOID_PENDING` is the honest state for a carrier that confirms refunds days later.
- Item 5 (live checkout rates): delivered. Checkout and finalize both go through `quoteShippingBoxes`; finalize re-quotes before the transaction opens. Fallback is `FALLBACK`-tagged on the quote row.

No stubs found. No broken flows in the paths walked. The migration backfills existing `ShipmentBox` rows to `PURCHASED`/`VOIDED` rather than leaving them `PENDING`, which is the correct reading of the enum.

## Severity counts

- High: 1 (F1)
- Medium: 0
- Low: 3 (F2, F3, F4)

Total: 4 findings.
