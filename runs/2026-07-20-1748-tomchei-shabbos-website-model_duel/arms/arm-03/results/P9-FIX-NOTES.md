# P9 Fix Notes — arm-03

## Fixed review IDs

- **B1:** `issueMagicLink` revokes all prior non-revoked `DriverMagicLink` rows for the route in the same transaction that creates the new link.
- **B2:** `confirmReroute` voids the shipping label inside the `$transaction` that updates `fulfillmentMethodId`, creates the stop, and writes `REROUTE_CONFIRMED`.
- **B3:** `switchFulfillmentMethod` voids the label inside the same `$transaction` as the method update and `METHOD_SWITCHED` audit. `voidLabelForPackage` accepts optional `tx` so DB void shares the caller’s transaction (Shippo void still runs first).

## Verification

- `npm run smoke:p9` — **5/5 PASS** (S1–S5).

## Blockers remaining

None for B1–B3.
