# P4 fix pass

## Fixed

- **B1:** `readDraft` now returns no draft before querying when neither a customer principal nor a valid guest token is present.
- **M1:** Address edits use `customers.write` for staff, while customer lookups are scoped to the requesting customer's address before staff authorization.
- **M2:** Email-based linking requires a verified primary Clerk email; links to an existing customer are audited as `customer.identity_linked`.
- **M5:** `formatMoney` now has one implementation in `lib/foundation.ts`.
- **M6:** Client and server use the same summed inventory-availability helpers.
- **M7:** Address edits reject normalized-address collisions with a clear 409 response; P4 smoke covers the case.
- **M8:** Cart lines have stable client IDs for React keys.

## Deferred

- **M3:** Order detail, draft cancellation UI/API, and query-driven draft continuation.
- **M4:** Split `lib/order-builder.ts` by concern.
- Remaining minor and nit findings, including guest-token lifetime, GET same-origin guards, rate limiting, address editor UI, and cart drawer behavior.

## Verification

`npm run typecheck`, `npm test`, and `npm run smoke:p4` passed. The P4 smoke used embedded PostgreSQL at `127.0.0.1:4105` and passed S1–S3.
