# P5 fix pass

## Fixed

- **B1:** A safety-refund webhook now posts to Stripe's refunds endpoint with the payment intent and a session-derived idempotency key. Replayed safety events retry that same idempotent refund request.
- **B2 + M2:** `charge.refunded` uses the Charge's `payment_intent`; refund-state updates and their webhook event record are committed together, with duplicate events skipped.
- **B3:** Checkout locks and verifies that the season is `OPEN` before inventory reservation or order-number allocation.
- **M3:** Cash/check POS forces a local checkout session even when Stripe credentials are configured, so it cannot create abandoned Stripe Checkout sessions.
- **m4:** Malformed, signature-valid webhook JSON now returns HTTP 400.

## Deferred

- M1/M13 rate-limiter hardening, M4 guest-draft clear, M5–M12 checkout decomposition and schema cleanup, plus remaining delivery, error-masking, and UI findings.
- Live Stripe redirect and webhook execution remain unverified because no Stripe test credentials are available.

## Verification

`npm run typecheck`, `npm run lint` (three pre-existing image warnings), and `npm run smoke:p5` passed. Smoke used embedded PostgreSQL at `127.0.0.1:4105`; S5 covers the real Charge payload, replay protection, closed-season rejection, and intercepted safety-refund request.
