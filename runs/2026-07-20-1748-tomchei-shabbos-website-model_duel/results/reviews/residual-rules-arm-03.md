# Residual Rules Review — arm-03 (Test 5, post self-fix)

**Arm:** `arm-03`
**Tree:** `arms/arm-03/workspace/` (post self-fix, full tree)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Source review:** `arms/arm-03/results/SELF-REVIEW.md` (16 findings: 1 blocker, 6 major, 9 minor)
**Fix notes:** `arms/arm-03/results/SELF-FIX-NOTES.md` (claims 7 fixed: SR-B1 + SR-M1–M6)
**Reviewer scope:** residual rules adherence only. Findings only — no fixes applied.

## Counts

| Severity | Self-found | Fixed in tree | Residual |
|---|---:|---:|---:|
| blocker | 1 | 1 | 0 |
| major | 6 | 6 | 0 |
| minor | 9 | 0 | 9 |
| **Total** | **16** | **7** | **9** |

Self-found majors+blockers fix rate: **7 / 7 = 100%**.
Self-fix notes ID mapping: matches self-review IDs exactly (SR-B1, SR-M1–M6); no drift.
Post-fix `npm run ci`: claimed pass (79 tests, includes SR-B1 regression) per `SELF-FIX-NOTES.md`.

## Verified fixes (in tree, not just claimed)

| Self-review ID | Fix verified in tree |
|---|---|
| SR-B1 | `lib/payments/post-payment.ts` `recordRefund` claims a matching `pending_*` placeholder (same intent + amount) instead of inserting a second POSTED negative under the real `re_…` id; P2002 race against `resolveStaffRefund` drops the placeholder. Regression test `tests/refund-idempotency.test.ts` simulates the crash window + replay. |
| SR-M1 | `app/api/webhooks/stripe/route.ts` `handleChargeRefunded` no longer books under a synthetic `${charge.id}:refunded:…` key; iterates only expanded `refunds.data` by real refund id, and when the list is omitted it skips (waits for `charge.refund.updated`) if POSTED negatives already cover `amount_refunded`. |
| SR-M2 | `lib/env.ts` refuses `AUTH_MODE=clerk` at startup (refine, build-phase exempt); `middleware.ts` is cookie-session only, no bare `clerkMiddleware()`. README updated. |
| SR-M3 | `lib/test-mode.ts` adds `allowsDestructiveTestConsole()` (explicit `TEST_MODE`/`IS_TEST_ENV` AND non-production); `app/api/admin/test-console/route.ts` and `app/(admin)/admin/test-console/page.tsx` both gate on it (404/notFound outside the allowlist). Banner still uses `isTestMode()`. |
| SR-M4 | `app/api/admin/reconciliation/route.ts` PATCH requires `payments.refund` (GET/POST stay `reports.view`). |
| SR-M5 | `lib/reports.ts` `marginReport({ seasonId?, limit? })` filters per-label rows (and season totals when scoped) by season, defaulting to open season; `app/(admin)/admin/reports/page.tsx` passes the drill/open `seasonId`. |
| SR-M6 | `lib/api/admin-handler.ts` adds `requireSeason` opt-out (default true); reconciliation, refund, payments, void, settings, season-status migrated onto the helper. |

## Residual findings (post-fix tree)

### Blocker residuals (0)
None.

### Major residuals (0)
None.

### Minor residuals (9) — all carry-over, left as filed per `SELF-FIX-NOTES.md`

| ID | Location | Finding | Status in post-fix tree |
|---|---|---|---|
| SR-m1 | `app/api/health/route.ts:10` | Public liveness returns `authMode: env.AUTH_MODE` — advertises the cookie-session stack over HTTP (recon). | Still present. |
| SR-m2 | `app/api/dev/stripe-checkout/route.ts` | Unauthenticated caller with a known `stripeSessionId` can POST a signed `checkout.session.completed` (booked-amount pay; `amountCents` override correctly requires staff). `guardPublicEndpoint` now applies (same-origin + rate limit), so the surface is narrowed but the unauthenticated money-path trigger remains in mock mode. | Partially mitigated, core issue remains. |
| SR-m3 | `app/api/admin/exports/[dataset]/route.ts:55` | `rowCount` increments per yielded CSV line including the header, so audit `detail.rows` overstates data rows by 1 per export. | Still present. |
| SR-m4 | `lib/rate-limit.ts:7` | Fixed-window limiter is process-local `Map`; multi-instance/serverless resets buckets per isolate. Comment documents the single-node assumption. | Still present (documented debt). |
| SR-m5 | `lib/public-guard.ts:6,36`; `lib/shipping/margin.ts`; `components/checkout/checkout-form.tsx`; `lib/checkout/fees.ts` | Mojibake (`â€”`) in comments and the 429 response body from UTF-8 mis-decoded as Latin-1. | Still present. |
| SR-m6 | `app/api/account/register/route.ts`, `app/api/account/login/route.ts`, `app/api/newsletter/subscribe/route.ts`, `app/api/draft/route.ts` | Public state-changing routes rate-limit but skip the shared `guardPublicEndpoint` same-origin helper (rely on `SameSite=lax` alone). Grep for `guardPublicEndpoint` in `app/api/account` returns no hits. | Still present. |
| SR-m7 | `lib/routes/service.ts`, `lib/shipping/labels.ts`, `lib/routes/print.ts`, `lib/repeat.ts` | Package → `{ line1, line2?, city, state, zip }` mapping redefined across modules (`addressOf` + inline literals). Rule of 2 satisfied. | Still present. |
| SR-m8 | `scripts/smoke-p12.ts` (751 lines) | Largest file in the tree; single `main()` walks S1–S5 + wipe/reseed. | Still present (confirmed 751 lines). |
| SR-m9 | `lib/routes/service.ts` (476 lines) | Borderline god file mixing route build, day-of notify, stop delivery, reroute. Under the 500-line split trigger today. | Still present (confirmed 476 lines); next feature push trips both size + mixed-concern triggers. |

### Process / hygiene notes (residual reviewer)

| ID | Finding |
|---|---|
| RR-P1 | `SELF-FIX-NOTES.md` accurately records 7 fixes and the IDs map 1:1 to `SELF-REVIEW.md` (no undercount, no re-ID drift). Process hygiene on the self-loop is clean for this pass. |
| RR-P2 | The `recordRefund` claim path adds a second `enqueueRefundEmail` call (post-payment.ts:79–82) on the placeholder-claim branch, in addition to the one in `resolveStaffRefund` (line 195). Both are idempotent at the email layer, but the duplicate enqueue on the claim path is worth a comment noting why it is intentional (webhook may run before `resolveStaffRefund`). Not a defect. |
| RR-P3 | `handleChargeRefunded`'s "wait for `charge.refund.updated`" branch logs a `console.warn` and returns without booking. If the `charge.refund.updated` event is never delivered (Stripe edge case), the ledger stays short until manual reconciliation. Acceptable given the reconciliation cron catches it, but the warn does not create a `PaymentReconFlag`. Info only. |

### Regressions introduced
None observed. The fix pass is additive/guard-only: new `allowsDestructiveTestConsole` gate, env refine, `requireSeason` opt-out, `recordRefund` claim path, `marginReport` season scoping. No existing route lost behavior; the SR-B1 regression test covers the new crash-window path. No new blocker/major introduced.

## Rule-by-rule residual adherence

| Rule | Adherence | Notes |
|---|---|---|
| ponytail | **Pass** | Ladder held across the fix pass — no new deps; `recordRefund` claim reuses existing `db.$transaction` + `recalcPaymentStatus`; `allowsDestructiveTestConsole` is a pure env read. `ponytail:` ceiling comments present (e.g. rate-limit single-node note). Residual minors (SR-m7 dup, SR-m8/m9 file size) are pre-existing, not introduced. |
| clean-code | **Partial** | All blocker + major categories closed. Residual: naming/comment quality fine; the open minors are consistency (SR-m6 same-origin), dead-code-adjacent none, type drift none, anti-AI-tics none. SR-m5 mojibake is the clearest clean-code miss (user-facing 429 string). |
| workflow | **Pass** | Gate discipline held — `npm run ci` green, regression test added for SR-B1, SELF-FIX-NOTES accurate. No doc drift in touched files. |
| vocabulary | **N/A** | No refactor/tidy/rebuild commands in the fix pass; correctly scoped as `fix`. |
| codegraph | **N/A for product** | No structural rename/delete/split in the fix pass, so no `codegraph_impact` required by the delta. Review used Read + Grep over the post-fix tree (literal/string lookups for env, auth, refund, mojibake). |

## Net

All seven self-found majors+blockers are closed in the tree (fix rate 100%), and the self-fix notes map cleanly to the self-review IDs. The residual is **0 blocker, 0 major, 9 minor** — all carry-over debt explicitly left as filed: health-endpoint auth-mode leak, mock-pay unauthenticated trigger (narrowed by `guardPublicEndpoint`), export row-count off-by-one, process-local rate limiter, mojibake in `public-guard`/`shipping`/`checkout`, four public routes skipping the same-origin helper, duplicated package-address mapping, the 751-line smoke script, and the borderline 476-line `routes/service.ts`. No regressions from the fix pass.
