# Test 5 — External residual review (quality): arm-03

**Reviewer:** external (blind, quality focus)
**Tree (post self-fix):** `arms/arm-03/workspace` (HEAD `d27690e`, "arm-03 P12 gated")
**Basis:** `SELF-REVIEW.md` (16 findings: 1 blocker, 6 majors, 9 minors) + `SELF-FIX-NOTES.md` (SR-B1 + SR-M1–M6 fixed; SR-m1–m9 deferred). `npm run ci` pass (79 tests) per fix notes.
**Scope:** Fresh review of the post-self-fix tree. Findings only — no fixes. Focus: correctness, broken flows, stubs, regressions vs the self-fix claims.

## Severity counts

| Severity | Count |
|---|---:|
| major | 0 |
| minor | 8 |
| **Total** | **8** |

## Verification of self-fix claims (sampled)

All seven fixed items land where the notes claim, and the money-path logic is transactional/idempotent where it needs to be:

- **SR-B1** `lib/payments/post-payment.ts:45-115` `recordRefund` — finds a `pending_*` placeholder by (orderId, stripePaymentIntentId, amountCents, POSTED, `startsWith("pending_")`) and rewrites its `stripeRefundId` to the real `re_…` instead of inserting a second negative row. P2002 catch (lines 84-94) deletes the placeholder when `resolveStaffRefund` raced. `enqueueRefundEmail` dedupes on `refund|${stripeRefundId}` (`lib/email/transactional.ts:95`), so the webhook-claim path and the `resolveStaffRefund` path cannot double-email. Correct.
- **SR-M1** `app/api/webhooks/stripe/route.ts:224-258` `handleChargeRefunded` — iterates `charge.refunds.data` for succeeded refunds and calls `recordRefund` with the real `refund.id`; when the embedded list is omitted, checks whether posted negatives already cover `amount_refunded` and skips otherwise. No synthetic `${charge.id}:refunded:…` keys. Correct (see RQ-1 for the tradeoff).
- **SR-M2** `lib/env.ts:89-95` refuses `AUTH_MODE=clerk` at load (build phase exempt); `middleware.ts` is cookie-session only. Correct.
- **SR-M3** `lib/test-mode.ts:23-30` `allowsDestructiveTestConsole()` requires non-production AND explicit `TEST_MODE`/`IS_TEST_ENV`; `app/api/admin/test-console/route.ts:14` uses it. Correct (see RQ-4 for comment drift).
- **SR-M4** `app/api/admin/reconciliation/route.ts:42` PATCH uses `permission: "payments.refund"`; GET/POST stay `reports.view`. Correct.
- **SR-M5** `lib/reports.ts:156-214` `marginReport({ seasonId?, limit? })` filters per-label rows by `package: { seasonId }` and totals by `pkg."seasonId" = ${seasonId}`; reports page passes drill/open season (`app/(admin)/admin/reports/page.tsx:16`). Correct (see RQ-3 for the no-open-season fallback).
- **SR-M6** `lib/api/admin-handler.ts:36-47` `requireSeason` defaults true, opt-out via `false`; refund, void, settings, recon, season-status, payments migrated. Correct.

The old `AGGREGATE-RESIDUAL-REVIEW.md` (42 findings) and the prior `residual-quality-arm-03.md` (RQ-1…RQ-6) cited `src/lib/…` paths and a magic-link/PIN flow that do not exist in this tree (`lib/routes/service.ts` here is 476 lines and has no PIN/magic-link code; there is no `app/api/driver/[token]`). They were treated as non-authoritative for this review and not re-counted.

## Findings

### RQ-1 — minor — `handleChargeRefunded` skip-and-wait has no backstop detector

**Location:** `app/api/webhooks/stripe/route.ts:248-258`; `lib/payments/reconcile.ts` (whole matcher)

When `charge.refunded` arrives without an expanded `refunds.data` list (newer Stripe API versions omit it unless expanded) and posted negatives do not yet cover `amount_refunded`, the handler logs a warning and returns. The main POST then marks the event `processed` (line 104), so this delivery will not retry. Booking is deferred to a later `charge.refund.updated` (handled at lines 98-101).

If `charge.refund.updated` never arrives (Stripe event loss, or a refund that is already terminal when `charge.refunded` fires and emits no further status transition), the refund is permanently unbooked — the ledger over-states the order's paid balance. The reconciliation matcher (`runPaymentReconciliation`) only compares sessions against *positive* payments (orphaned / amount-mismatch / ledger-only); it never compares posted refund totals against Stripe's `amount_refunded`, so the under-booking is not flagged. This is the deliberate tradeoff of the SR-M1 fix (avoid the double-booking the synthetic key caused), but the under-booking path has no detector. Most material residual on the money path; still minor because it depends on Stripe event loss, which is rare, and no money is lost (the customer's refund reached Stripe regardless).

**Fix direction (not applied):** in the reconciliation matcher, compare the sum of posted negative rows per intent against the charge's `amount_refunded` (via Stripe API or a stored charge snapshot) and flag shortfalls; or expand `refunds` on `charge.refunded` so the handler books from the embedded list.

---

### RQ-2 — minor — `recordRefund` P2002 catch can fall through to an unhandled create

**Location:** `lib/payments/post-payment.ts:71-94`, `:98-107`

In the placeholder-claim path, the `update` (line 72) can P2002 when a concurrent `resolveStaffRefund` already set the real `re_…` id on another row. The catch deletes the placeholder, recalcs, and `findUnique`s the winner (line 89). If the winner is `null` (the winning row was deleted between the `update` and the `findUnique`), control falls through to `tx.payment.create` at line 98 under the same `stripeRefundId` — which can P2002 again (the key is still held by a concurrent transaction) and that second P2002 is unhandled (no try/catch around line 98). The whole `$transaction` rolls back and Stripe retries; on retry `findUnique(stripeRefundId)` returns the now-committed row and the call is a no-op. Self-healing, but the error path is rougher than the claim path. Narrow race on a money path.

**Fix direction (not applied):** after the P2002 catch, `return` explicitly when the winner exists, and when the winner is `null` re-`findUnique` once more or `return` rather than falling into the create path.

---

### RQ-3 — minor — `marginReport` falls back to cross-season when no OPEN season and no drill

**Location:** `lib/reports.ts:156-214`; `app/(admin)/admin/reports/page.tsx:16`

The reports page passes `marginSeasonId = drillSeason?.seasonId ?? performance.find((row) => row.seasonStatus === "OPEN")?.seasonId`. When the user has not drilled and there is no OPEN season, `marginSeasonId` is `undefined`. `marginReport({ seasonId: undefined })` then looks for an OPEN season internally; finding none, `seasonId` stays `undefined` and the query falls back to the cross-season branch — per-label rows are unscoped (`where: { status: "PURCHASED" }`, line 166) while totals are grouped per season. The doc comment (lines 154-155) says per-label rows are "scoped to one season … so the table matches the season-picker mental model," which the fallback contradicts. The SR-M5 fix closed the scoped case; the no-open-season fallback is still cross-season. Edge case (every season CLOSED/ARCHIVED and no drill selected).

**Fix direction (not applied):** when no season resolves, return empty rows + a single all-seasons total (or render an empty-state message) instead of the cross-season per-label query.

---

### RQ-4 — minor — Stale doc comment in `lib/test-console.ts` after SR-M3 fix

**Location:** `lib/test-console.ts:6`

The module doc says "the API route enforces isTestMode" but the route (`app/api/admin/test-console/route.ts:14`) now enforces `allowsDestructiveTestConsole()` (explicit `TEST_MODE`/`IS_TEST_ENV` AND non-production), which is stricter than `isTestMode()` (the latter still infers from missing Stripe). The comment drift was introduced by the SR-M3 fix; `isTestMode()` is now only the banner/mock-awareness signal, not the destructive gate. A reader following the comment would believe missing Stripe alone exposes wipe on staging, which is exactly the bug SR-M3 closed.

**Fix direction (not applied):** update the comment to "the API route enforces `allowsDestructiveTestConsole()` — explicit test-env allowlist AND non-production; `isTestMode()` is banner-only."

---

### RQ-5 — minor — `/api/health` still leaks `AUTH_MODE` (SR-m1, deferred)

**Location:** `app/api/health/route.ts:10`

Public `GET /api/health` returns `authMode: env.AUTH_MODE`. After the SR-M2 fix the value can only be `dev` (clerk is refused at load), so the leak is bounded to advertising `dev` — still a reconnaissance signal for the cookie-session stack on any reachable host. Deferred as SR-m1 in the self-fix notes; still present.

**Fix direction (not applied):** return `{ status, database, timestamp }` only; keep `authMode` in server logs or a staff-only diagnostic.

---

### RQ-6 — minor — `/api/dev/stripe-checkout` mock pay still triggerable unauthenticated (SR-m2, deferred)

**Location:** `app/api/dev/stripe-checkout/route.ts:31-49`

The route now applies `guardPublicEndpoint` (same-origin + rate limit, line 31) and the `amountCents` override requires a staff session (line 44). But an unauthenticated caller who satisfies same-origin and knows a `stripeSessionId` can still POST without `amountCents` and trigger `checkout.session.completed` through the real webhook, completing an open mock checkout for someone else's order. The customer check (line 47) only fires when `customer` is non-null; an unauthenticated caller has no customer context and passes through. Bounded to mock mode (line 27 refuses when Stripe is configured), but still an unauthenticated money-path trigger on the mock harness. Deferred as SR-m2; still present.

**Fix direction (not applied):** require a customer session matching `session.order.customerId`, or a staff session, for *all* mock pays — not only amount overrides.

---

### RQ-7 — minor — CSV export `rowCount` off-by-one (SR-m3, deferred)

**Location:** `app/api/admin/exports/[dataset]/route.ts:55`

`rowCount += 1` fires for every yielded CSV line, including the header, so audit `detail.rows` overstates data rows by 1 for every export. Deferred as SR-m3; still present.

**Fix direction (not applied):** count only data lines, or store `{ header: 1, dataRows: n }` and subtract 1 in the audit detail.

---

### RQ-8 — minor — Mojibake in `lib/public-guard.ts` comments and 429 copy (SR-m5, deferred)

**Location:** `lib/public-guard.ts:6`, `:36`

Line 6 comment and the 429 body (`Too many requests â€" try again in a minute`) contain `â€"` where an em dash belongs — UTF-8 mis-decoded as Latin-1. The 429 string is user-facing. Deferred as SR-m5; still present.

**Fix direction (not applied):** re-save the file as UTF-8 (em dash / minus) and fix the 429 message body.

## Notes

- Reviewed against the post-self-fix tree (HEAD `d27690e`). `npm run ci` (lint, typecheck, migration:guard, 79 tests) reported pass in `SELF-FIX-NOTES.md`; not re-run here (findings-only scope).
- `lib/routes/service.ts` measured at 476 lines (borderline, under the 500-line split trigger); `scripts/smoke-p12.ts` at 751 lines. Both are deferred structural minors (SR-m8/SR-m9), not re-counted here — no correctness surface.
- `adminHandler` casts `season as OpenSeason` even when `requireSeason: false` leaves it `null` (`lib/api/admin-handler.ts:76`); the comment warns `requireSeason:false` handlers must not read `season`, but the type permits it. No current `requireSeason:false` handler reads `season`, so this is a type-safety hedge, not a live defect — not counted.
- No new blockers or majors found. The self-fix closed the blocker and all six majors it claimed; the residuals are one money-path edge case with no detector (RQ-1), one narrow race in the same fix (RQ-2), one scoped-report fallback (RQ-3), one comment drift introduced by the fix (RQ-4), and four deferred minors reproduced from the self-review (RQ-5…RQ-8).
