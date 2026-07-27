# P8 fix pass — arm-05

## Fixed

- All three blockers: customer draft and account projections no longer disclose margin/provider data; label `chargedCents` now comes from the persisted checkout-time customer charge.
- Majors 4, 5, 6, 7, 8, 10, 13, 17, 19, and 20: manager-only margin projections, generic Shippo errors, label row locking and compensation records, audited package-type selection, stricter ground matching, read-only action permissions, active-label helper, and one delivery-rules query.
- Box selection now rejects a product that cannot fit on every box axis.

## Deferred

- Full multi-box bin packing and package-line allocation need a package-to-box allocation model; the current data model has no allocation relation.
- Rate-expiry revalidation, checkout quotes in the queryable `ShippingQuote` table, scheduled tracking refresh, and void-flow idempotency remain open.

## Verification

- `npm run typecheck` passed.
- `npm run smoke:p8` passed S1-S3 in Shippo fixture mode.
