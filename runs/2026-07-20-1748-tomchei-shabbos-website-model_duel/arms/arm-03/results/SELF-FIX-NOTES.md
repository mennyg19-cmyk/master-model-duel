# Test 5 — Self-fix notes (arm-03)

One fix pass against `SELF-REVIEW.md`. `npm run ci` — **pass** (79 tests).

## Fixed

| ID | Change |
|---|---|
| **SR-B1** | `recordRefund` claims a matching `pending_*` placeholder (same intent + amount) instead of inserting under `re_…`. Regression: `tests/refund-idempotency.test.ts`. |
| **SR-M1** | `handleChargeRefunded` no longer books under synthetic `${charge.id}:refunded:…` keys; waits for expanded refunds / `charge.refund.updated`. |
| **SR-M2** | `AUTH_MODE=clerk` refused at env load (build phase exempt). Middleware is cookie-session only — no bare `clerkMiddleware()`. README updated. |
| **SR-M3** | Destructive test console gated on `allowsDestructiveTestConsole()` = explicit `TEST_MODE`/`IS_TEST_ENV` **and** non-production. Banner still uses `isTestMode()`. |
| **SR-M4** | Reconciliation PATCH requires `payments.refund` (GET/POST stay `reports.view`). |
| **SR-M5** | `marginReport({ seasonId?, limit? })` filters per-label rows (and season totals when scoped) by season; reports page uses drill/open season. |
| **SR-M6** | `adminHandler` `requireSeason` opt-out (default true). Migrated recon, refund, payments, void, settings, season-status onto the helper. |

## Not fixed (minors / out of pass)

SR-m1–SR-m9 left as filed.

## Verify

`npm run ci` → lint, typecheck, migration:guard, 79 tests ok (includes SR-B1 regression).
