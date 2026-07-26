# P8 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P8.md` (0 blockers, 4 majors, 15 minors)
**Scope:** one pass. All 4 majors, 9 of 15 minors. P9 not started.
**Verification:** `npm run ci` exits 0 — lint, typecheck, migration guard, **181/181 tests**
(1 new). **P8 smoke 16/16**, and the whole ladder replayed green: P1 28, P2 21, P3 39,
P4 26, P5 29, P6 23, P7 21, P8 16 — 203 checks.
**No migration added.** No new environment variables. `.env.example` regenerated; it carries
empty placeholders only.

## Fixed — majors

### M-MAJ-1 — the recorded margin is the money, not a rate that moved
`src/lib/shipping/label-service.ts`

`claimParcels` allocated the customer's share from `quote.customerPriceCents` — the quote taken
seconds earlier at Buy — so on a real carrier whose rate table moved between checkout and Buy, the
`ShipmentBox.customerPriceCents` / `marginCents` rows and the `shipping.label_purchased` audit
recorded a spread the organization never kept. The customer's fee was frozen at checkout (G-028) and
is on the package as `fulfillmentFeeCents`.

`claimParcels` now reads `box.fulfillmentFeeCents` *inside* the claim transaction and allocates from
it, and `marginCents` is that fee less the carrier cost, per parcel, still summing to the cent. The
`LabelPurchase` totals are built from the same figure rather than from the plan, and `recordQuote`
files the buy-time quote row with the frozen price too, so the checkout row and the buy row name the
same customer price (this is also M-MIN-15's canonical-row problem).

Proof: `the recorded margin is the fee the customer was charged, not a rate that moved since` moves
the stand-in's rate table between checkout and Buy and asserts the recorded spread is
`fulfillmentFeeCents − carrierCostCents`. The old code passes the deterministic smoke and fails this.

### M-MAJ-2 — the recipient's address no longer reaches stderr
`src/lib/shipping/provider.ts`, `shippo-api.ts`, `quote-service.ts`

The leak was at the throw, not the log: `shippoRequest` stringified Shippo's error payload — which
echoes `address_to` and `address_from` — into the `Error` message, and `quote-service` logged the
error and `subject.key`. Fixed at the source. `CarrierRequestError(status, request)` carries the HTTP
status and the method plus path and nothing else; `shippoRequest` throws it and never reads the failed
body. `quote-service` logs one sentence with `failureShape(error)` — `carrier returned 422`, or the
error's name for anything else — and no subject key.

The audit trail is unchanged and still the place a specific box's failure is found; it keeps a postal
code and no more (`audit.ts`).

### M-MAJ-3 — one address mapper, one country default
`src/lib/addresses/address-mapping.ts` (new), `core/normalize.ts`, and the eight call sites

`DEFAULT_ADDRESS_COUNTRY` is exported from `core/normalize.ts`, where the `'US'` that
`normalizeAddressKey` applies already lived, so there is one constant rather than a second one
importing the first. `address-mapping.ts` sits beside `address-summary.ts` — deliberately not
`server-only`, so a client component can spell an address the way the server does — and holds:

| Export | Owns |
|---|---|
| `AddressColumns` | the six prefixed columns every row carries |
| `toAddressParts(row)` | unprefixed parts, or null when there is no street line |
| `addressLine(row)` | that address on one line |
| `destinationLabel(row)` | the pickup counter, the address, or null |

The carrier's shape is one file down, in `src/lib/shipping/address-mapping.ts` (new), because it is
typed against `provider.ts`'s `ShippingAddress` and `addresses/` must not depend on `shipping/`.
`toShippingAddress(row, { name })` is now the only place `'Shipping department'` and the country
default are written for a carrier call; `quote-service` and `address-check` both go through it.

Collapsed: `quote-service.ts` (`destinationOf` deleted; `QuoteSubject.address` is now
`AddressColumns`, so `quoteShippingBoxes` hands the row through instead of re-shaping it),
`address-check.ts`, `grouping.ts` (both key builders), `staff-orders.ts`, `customer-orders.ts`,
`checkout-summary.ts`, `cart.ts`, `package-board.ts` (its `destinationOf` wrapper was a one-line
pass-through and is inlined at both call sites rather than renamed).

Grouping keys are storage, so the country default was matched byte-for-byte: `?? DEFAULT_ADDRESS_COUNTRY`,
not `||`, because an empty-string country keyed differently from a null one before and existing rows
have to keep matching. `addressSummary` never printed the country, so no screen changed.

### M-MAJ-4 — one DB-access pattern inside `shipping/`
`label-service.ts`, `address-check.ts`, `carriage-view.ts` and their call sites

All three imported the `db` singleton while `quote-service` took `client: DbClient` on every export.
`buyLabelForPackage`, `voidLabelForPackage`, `refreshTrackingForPackage`, `readShippable`, `quoteFor`,
`compensate`, `validatePackageAddress` and `readCarriageCard` now take `client` first. `runInTransaction`
still owns the singleton — it is the one place that may — and the transaction client is threaded to
everything inside it, which is what let M-MAJ-1 read the fee inside the claim.

Call sites updated: `fulfillment/actions.ts` (4), `fulfillment/packages/[packageId]/page.tsx` (1),
`tests/shipping.test.ts` (15).

## Fixed — minors

| # | Fix |
|---|---|
| M-MIN-1 | `secret: true` on `SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID`; `.env.example` regenerated and annotates both. Values stay empty. |
| M-MIN-2 | `carriage-view.ts` gained `printableLabelUrl`, which hands out a label link only when it parses as `https:`; the card renders what it is given rather than deciding. `labelUrl` is cleared on `VOIDED` and on `VOID_PENDING`, and by `compensate`, so a cancelled label's PDF is not still linked from the board. |
| M-MIN-3 | `MAX_VOID_REASON_LENGTH` caps the void reason in `voidLabelAction`; `MAX_CARRIER_MESSAGE_LENGTH` caps the carrier's `failureMessage` where it is written. The `@db.VarChar` half is deferred — see below. |
| M-MIN-6 | `validatePackageAddress` refuses a box whose `fulfillmentMethod.kind` is not `SHIPPING`, so a pickup box is not checked against a carrier and told the wrong reason. |
| M-MIN-7 | `combineParcelRates` dedupes a carrier's service per parcel before counting, so a carrier that answers the same service twice for one parcel cannot look eligible for a box it cannot price. |
| M-MIN-8 | Resolved by M-MAJ-1: `plan.customerPriceCents ?? purchase.costCents` is gone — the frozen fee is not nullable, so there is nothing to defend against. |
| M-MIN-11 | `core/units.ts` with `gramsToPounds(grams, decimals)`; `shippo-api.ts` and `carriage-card.tsx` both use it, each keeping its own precision. `millimetresToInches` was *not* added — one call site, so `MM_PER_INCH` stays local. |
| M-MIN-14 | `label-status.ts` holds `VOIDABLE_STAGES`, `ACTIVE_LABEL_STATUSES`, `isLabelVoidable`, `isActiveLabel` and `isLabelBought`. `carriage-view` reads the predicates instead of hardcoding `'PURCHASED'`; `label-service` reads them too. `isLabelBought` rather than widening `hasLiveLabel` to `isActiveLabel`: a `PENDING` parcel has no tracking number and must not offer Refresh or the void form. |
| M-MIN-15 | The canonical rule is documented on `recordQuote` — latest `requestedAt` wins — the buy-time row now carries the frozen customer price so both rows agree, and `smoke-p8.ts` reads the quote with an explicit `orderBy: { requestedAt: 'desc' }`. |

## Deferred — 6 minors, with reasons

| # | Finding | Why not now |
|---|---|---|
| M-MIN-4 | Rate-id ownership check before the carrier buy | The ids come from the `quoteFor` call in the same invocation, so an assertion here restates the control flow rather than adding one. The real fix is making `ShipmentBox.providerRateId` non-nullable so the compiler carries the guarantee, which is a migration and belongs with M-MIN-5. |
| M-MIN-5 | `ShippingQuoteOption.providerRateId` keeps only the first parcel's rate id | Holding all of them means either a join table or a delimited string; the first changes the schema, the second changes what the column means. Reconciliation reads the parcel rows, which are complete. Wants a decision. |
| M-MIN-9 | `codegraph` index never initialized | The tool says indexing is the user's call, and the CLI is not on PATH in this workspace. Not a code change. |
| M-MIN-10 | `?? ''` for a `trackingNumber` the `where` clause excludes | Prisma does not narrow from `{ not: null }`, so removing it needs a non-null assertion, which the lint config refuses. Leaving the `??` is the cheaper honesty. |
| M-MIN-12 | Split `label-service.ts` (423 lines) | Real, and the right split is roughly the one suggested. Doing it in the same pass as M-MAJ-1 and M-MAJ-4 — both of which rewrite the same functions — would make the diff unreviewable. `label-status.ts` took the predicates and constants out, so it is smaller than reported. |
| M-MIN-13 | `carrier` as a union rather than `string` | The carrier list is the org's own configured accounts, plus whatever Shippo answers with; a closed union in the type system would have to be reconciled against an open set at the boundary. Wants a decision about which side owns the list. |

Also deferred: the `@db.VarChar` half of M-MIN-3. The length caps are enforced where the text enters,
which is the part that matters; adding column limits is a migration and would truncate on write
instead of refusing, which is worse behaviour for a carrier message.

## Verification

```
npm run ci        -> exit 0   (lint, typecheck, migration guard, 181/181 tests)
npm run smoke:p8  -> 16/16    (.scratch/PHASE-P8-SMOKE.md)
```

Full ladder replayed from an empty database after the fixes — `db:fresh`, `smoke` (P1), `seed`,
`smoke:p2` … `smoke:p8`: P1 28, P2 21, P3 39, P4 26, P5 29, P6 23, P7 21, P8 16 — 203/203 green.

New test in `tests/shipping.test.ts`:

- `the recorded margin is the fee the customer was charged, not a rate that moved since` (M-MAJ-1)

One earlier smoke assertion was corrected rather than worked around. P5's `S1a` asserted the shipping
card reads exactly $12.00 — the flat placeholder that phase shipped — and P8 replaced that placeholder
with a live carrier quote, which is EXPECTED item 5 of this phase. The P5 assertion had therefore been
stale since P8 landed, before this pass. It now asserts what P5 actually owns: one card per recipient,
each priced by its own method, pickup free and shipping priced above zero. The exact carrier number is
proved by P8's own `S1a` ($12.30 for 10952), which is the right place for it.
