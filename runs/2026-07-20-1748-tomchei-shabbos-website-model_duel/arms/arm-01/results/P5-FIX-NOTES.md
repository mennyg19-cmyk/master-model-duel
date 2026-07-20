# P5 fix notes — arm-01

## Blockers

- B1: Stripe return URLs now resolve from required `APP_BASE_URL`; request `Host` no longer influences redirects.
- B2: public throttling ignores spoofable `x-forwarded-for` and keys only on the platform-provided `x-real-ip` (or one shared unknown bucket).
- B3: package delivery groups by order line/recipient, while bulk delivery continues grouping by destination; client and server totals agree.
- B4: the checkout intent is upserted before session creation and completed by update, so a failed Stripe call can retry the same idempotency key instead of colliding on the database unique key.

## Priority majors

- POS draft finalization locks the order, requires fulfillment/recipient/greeting/fee snapshots, rechecks current price and stock, reserves inventory atomically, and only then assigns the sequential order number.
- Stripe refunds retain the posted payment and track `refundedCents`; partial refunds yield a correct net paid balance, while only a full refund marks the intent and cached status refunded.
- Safety refunds use a serializable interactive transaction, race-safe event deduplication, the actual event type, and only the active payment intent.
- Successful capture updates only the latest active intent, preserving failed-attempt history and unique Stripe intent identifiers.
- Offline payment status recalculation now occurs inside the same payment transaction.

## Verification

S1–S5 passed; evidence is in `workspace/.scratch/PHASE-P5-SMOKE.md`. Typecheck, lint, migration deploy, and all 13 tests passed.
