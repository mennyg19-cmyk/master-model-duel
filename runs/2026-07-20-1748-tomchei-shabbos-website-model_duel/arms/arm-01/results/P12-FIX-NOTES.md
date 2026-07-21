# P12 Fix Notes — arm-01

## Fixed

- B1: Added a shared same-origin `Origin`/`Referer` guard to destructive and financial admin POST routes.
- B2: Converted all P12 JSON responses to `NextResponse.json`.
- B3: Replaced message-regex routing with `ImportConflictError` and `TestConsoleUnavailableError`.
- B4: Moved the legacy document zod schema and inferred TypeScript type into one domain source.
- M1: Added a 10 MiB request cap plus aggregate address and order-line limits.
- M3: Live-customer contact matches now require `allowLiveCustomerMerge: true`.
- M5: Cron reconciliation now persists an audit-log event.
- M6: Stripe PaymentIntents are read across all pages.
- M7: `matchedCount` now excludes only findings tied to stored intents and cannot be reduced by provider orphans.
- M9: Legacy products, customer names, and recipient names are indexed once with maps.
- M10–M11: Smoke now verifies export/audit persistence and exact reconciliation finding types.

## Verification

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm run smoke:p12` — PASS S1–S5
- S5: 1k orders / 5k packages seeded in 4449 ms; nightly print completed in 3628 ms.

## Remaining blockers

None from B1–B4.
