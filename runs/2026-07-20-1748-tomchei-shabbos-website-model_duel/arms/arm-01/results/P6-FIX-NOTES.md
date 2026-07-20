# P6 fix pass — arm-01

Date: 2026-07-21  
Pass: single

## Fixed

- **#1:** The payment row is claimed before Stripe is called inside the same
  transaction. Concurrent stale requests cannot reach Stripe, and retries use
  a stable per-form idempotency key (with a deterministic compatibility
  fallback). Stripe-intent updates now require the exact non-null reference.
- **#2:** `audit:view` now gates the audit page, overview audit query and
  section, order-detail audit query and section, overview API audit payload,
  and Audit navigation.
- **#3:** Guest drafts use the P5 same-origin public-write guard and trusted
  `X-Real-IP` pattern with a 10/minute action-specific limit; spoofable
  `X-Forwarded-For` is no longer read.
- **#4:** Added `orders:manage`; bulk-repeat API and UI require it.
- **#6:** POS loads configured delivery days, submits a day for non-pickup
  choices, clears it for pickup, and validates it server-side.
- **#7:** Refund controls render only refundable payments and default/max to
  the remaining refundable amount.
- **#10:** Import commit atomically claims the staged batch, re-checks database
  duplicates, and maps both detected races and Prisma `P2002` to HTTP 409.
- **#20:** Season revenue now filters finalized orders by the configured
  current season and returns zero when no current season is configured.

## Best-effort items completed

- **#8:** Centralized nullable phone normalization in `src/lib/normalize.ts`
  and reused it in customer creation, import staging, import commit, and CSV
  validation.
- **#18:** POS, Imports, and Audit navigation now follows their route
  permissions.
- **#19:** POS customer creation now requires `payments:manage`, matching the
  POS page.

## Verification

- S1 PASS
- S2 PASS
- S3 PASS
- S4 PASS
- Lint PASS
- Typecheck PASS
- Tests PASS (13/13)

Detailed smoke evidence: `workspace/.scratch/PHASE-P6-SMOKE.md`.
