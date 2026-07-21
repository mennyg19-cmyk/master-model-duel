# Test 5 self-fix notes

## Fixed

- **SR-01:** Stripe Checkout now uses the documented `APP_URL` setting for trusted success and cancellation URLs.
- **SR-02:** Checkout sessions are keyed by a stable fingerprint of the prepared order choices. The fingerprint is persisted with the payment intent and verified before payment commit, so a stale session is safety-refunded instead of finalizing changed fulfillment or greeting snapshots.
- **SR-03:** Hosted Checkout is restricted to immediate card payments, and `checkout.session.completed` only commits an order when Stripe reports `payment_status: paid`.
- **SR-04:** Generic order finalization now claims the order number, changes status, and materializes packages inside the same serializable transaction.
- **SR-05:** Impersonation sessions now persist a one-hour `expiresAt`, use that same expiry on the cookie, and are rejected server-side after expiry.
- **SR-06:** Client-error ingestion now fails closed without its configured token, authenticates bearer or `x-client-error-token` credentials with constant-time digest comparison, and enforces the 2 KB limit while streaming the request body.
- **SR-07:** Driver PIN failures now increment and establish lockout atomically in PostgreSQL, preventing concurrent guesses from losing increments.

## Skipped

- **SR-08:** Skipped because it is minor; this pass was scoped to blockers and majors.

## Verification

- `npm run ci`: PASS — ESLint, TypeScript, 15 tests, Prisma validation, and migration status.
- `npm run smoke:p9`: PASS — all five delivery scenarios, including PIN throttle and link expiry.
- Checkout smoke was attempted, but the existing P5 fixture selected an inventory-tracked product with no `InventoryItem` and failed before checkout began (`scripts/p5-smoke.ts:136`). CI checkout/domain coverage remained green.

## Remaining blockers

None from the blocker and major self-review findings.
