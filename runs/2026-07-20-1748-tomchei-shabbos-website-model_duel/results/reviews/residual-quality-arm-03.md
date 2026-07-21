# Test 5 — External residual review (quality): arm-03

**Reviewer:** external (blind, quality focus)
**Tree (post self-fix):** `arms/arm-03/workspace`
**Basis:** `SELF-REVIEW-AGGREGATE.md` (18 findings) + `SELF-FIX-NOTES.md` (blockers + agreed majors fixed; SR-M5/M7/M8/m1–m6 skipped).
**Scope:** Fresh review of the post-self-fix tree. Findings only — no fixes. Focus: correctness, broken flows, stubs.

## Severity counts

| Severity | Count |
|---|---:|
| major | 2 |
| minor | 4 |
| **Total** | **6** |

## Verification of self-fix claims (sampled)

Spot-checked the nine fixed items. All land where the notes claim:

- **SR-B1** `src/lib/auth.ts` `getStaffContext` now prefers `clerkUserId`; email rematch auto-links only when `clerkUserId` is null and denies when bound to a different Clerk id (lines 92–109). Correct.
- **SR-B2** `src/app/api/driver/[token]/route.ts` GET returns `{ok, linkId, pinRequired:true, unlocked:false}` until `isMagicPinUnlocked(link.id)` is true (lines 48–56). Client `driver-client.tsx` `applySession` honors `unlocked`/`pinRequired`. Correct as far as the GET path goes — see RQ-2 for the gap on the mutating paths.
- **SR-B3** `src/lib/stripe/client.ts` `getStripeMode` throws on `STRIPE_MODE=mock` or mock-looking keys in production (lines 14–30); `mock-complete/route.ts` returns 404 in production (lines 23–28). Correct.
- **SR-M2** `webhook.ts` branches `refund.created` (Refund) vs `charge.refunded` (Charge, iterates `refunds.data`) with a per-refund idempotency key `refund_applied:${refund.id}` (lines 289–399). Cross-event dedup works; see RQ-1 for the retry-window gap.
- **SR-M3** `middleware.ts` `isDevAuthBypass` now requires `NODE_ENV !== "production"` (lines 62–65). Correct.
- **SR-M4** `guest-token.ts` `guestDraftCookieOptions` derives `secure` from `APP_URL` https / production (lines 40–49). Correct.
- **SR-M6** `finalize.ts` is now 259 lines, ~4% blank — normal single-spaced. Confirmed.
- **SR-M9** `routes/service.ts` `hashPin` uses scrypt + per-hash salt (`scrypt$salt$hash`); `verifyPinHash` accepts legacy sha256; `routes-admin.tsx` PIN field defaults to `""` (lines 36–60; component line 19). Correct.

Skipped items (SR-M5 process-local rate limits, SR-M7/M8 god-file splits, SR-m1–m6) remain open by design; not re-counted here except where they produce a correctness surface (RQ-4).

## Findings

### RQ-1 — major — Refund increment is non-transactional; retry after partial failure double-counts

**Location:** `src/lib/payments/webhook.ts:313–329` (`handleChargeRefunded`)

`db.payment.update({ data: { refundedCents: { increment: refund.amount } } })`, `db.auditLog.create`, `recalcOrderPaymentStatus`, and `markWebhookEventProcessed(appliedKey, "refund.applied")` are four independent non-transactional writes. The per-refund idempotency key `refund_applied:${refund.id}` is only set to `processed` by the last step.

If the increment commits but any later step throws (audit log write, recalc, or the processed-mark itself), the key stays in `processing`. On Stripe retry, `claimWebhookEvent(appliedKey)` sees `status !== "processed"` and re-claims (lines 76–82), so `handleChargeRefunded` re-runs and the increment fires again — `refundedCents` is double-counted, and `recalcOrderPaymentStatus` then caches an inflated refund total.

The SR-M2 fix correctly prevents cross-event double-increment (a `refund.created` and a `charge.refunded` for the same `re_…` id), but the retry-after-partial-failure window is still open. On a money path this can mis-state order payment status (PAID → PARTIALLY_REFUNDED → fully refunded when only one refund occurred).

**Fix direction (not applied):** wrap the increment + audit log in one `db.$transaction`, and only call `markWebhookEventProcessed` after the transaction commits; or use a conditional increment guarded by the processed-mark.

---

### RQ-2 — major — Start/deliver re-verify PIN even when link already unlocked → refresh-induced lockout

**Location:** `src/lib/routes/service.ts:446–462` (`startRouteViaMagicLink`), `:551–568` (`markStopDelivered`); contrast `src/app/api/driver/[token]/route.ts:48–56` (GET uses `isMagicPinUnlocked`).

The SR-B2 fix made GET release stop PII as soon as `isMagicPinUnlocked(link.id)` is true (a `PIN_OK` event exists). The mutating paths do not consult that flag: when `link.pinRequired` is true they always call `verifyMagicPin({ pin: input.pin ?? "" })`, which re-runs `verifyPinHash` and increments `pinFailCount` on mismatch.

Concrete broken flow: driver enters PIN → unlocks (stops render) → refreshes the page. After refresh, `pin` state is gone; GET returns the full roster (`unlocked: true`), so the UI shows stops and the Start/Deliver buttons. Clicking "Start route" or "Mark delivered" sends `pin: undefined`; `verifyMagicPin({pin: ""})` fails, increments the fail counter, and after three such clicks locks the driver out for 60s — even though the link is already unlocked. The GET and the POSTs disagree on what "unlocked" means.

**Fix direction (not applied):** in `startRouteViaMagicLink` and `markStopDelivered`, skip the PIN re-check (or accept any pin) when `await isMagicPinUnlocked(link.id)` is already true.

---

### RQ-3 — minor — `getStripeMode` silently labels a live key as "test" in production when `STRIPE_MODE` is unset

**Location:** `src/lib/stripe/client.ts:8–36`

In production with a real `STRIPE_SECRET_KEY` but `STRIPE_MODE` unset, the function falls through to `return mode === "live" ? "live" : "test"` and returns `"test"` (lines 24–29). The fail-closed guard correctly forbids mock and rejects missing/mock-looking keys, but it does not require `STRIPE_MODE` to be explicit. `getStripe()` charges the real key regardless of the label, so charges are not broken, but any branch that keys off `getStripeMode() === "test"` (e.g. test-only logging, future test-mode stubs) will behave as if in test while live money is moving.

**Fix direction (not applied):** in production, require `STRIPE_MODE` to be `"live"` or `"test"` explicitly (throw on empty), mirroring the mock refusal.

---

### RQ-4 — minor — Dead stub shipped: `stubAssignLabelToRoute`

**Location:** `src/lib/shipping/labels.ts:340–346`

`export async function stubAssignLabelToRoute(labelId: string)` is defined (P9 hook stub) but has zero callers anywhere under `src/` (grep confirms only the definition site). It is exported from a production module and ships in the bundle as dead code. The "P9 hook stub" naming also signals it was meant to be wired into route assignment and never was.

**Fix direction (not applied):** delete it, or wire it into the route-build/reroute path if the non-voidable-once-on-a-route guarantee is actually required.

---

### RQ-5 — minor — Prior-year import remains a stub bypassing the real ORDERS pipeline (SR-m6, deferred)

**Location:** `src/lib/ops/prior-year-stub.ts:16–155`; `src/app/api/admin/imports/prior-year-stub/route.ts`

`seedImportedPriorYearOrder` directly creates a prior-year `PAID` order with `kind: "prior_year_order_stub"` rather than exercising the real `ImportKind.ORDERS` `classifyOrderRows` / `commitOrderRow` pipeline. The route is correctly dev-gated (`AUTH_MODE=dev` + non-production + `settings.write`, lines 11–14), so it cannot ship to production. The residual concern is evidentiary: the P10/P12 smoke treats this stub as migration proof, so the real historical ORDERS import path remains unexercised end-to-end. This was explicitly deferred in `SELF-FIX-NOTES.md` (SR-m6) and is recorded here only for completeness — no new defect.

---

### RQ-6 — minor — Gated GET still loads full stop PII from DB before discarding it

**Location:** `src/lib/routes/service.ts:370–390` (`loadMagicLinkSession`); `src/app/api/driver/[token]/route.ts:48–56`

`loadMagicLinkSession` always `include`s `route.stops` (line 376). On the PIN-gated GET path the handler then returns only `{ok, linkId, pinRequired:true, unlocked:false}` and throws the stops away. No data leaks (the stops are never serialized), but every locked-GET touches recipient names/addresses in the DB and the ORM hydrates the full stop graph for nothing — wasted query + unnecessary PII hydration on the most-hit driver endpoint.

**Fix direction (not applied):** load link + route without stops for the gated branch, or split `loadMagicLinkSession` into a light variant for the unlock check.

## Notes

- Reviewed against the post-self-fix tree (HEAD `15dcf3f`, "arm-03 P12 gated"). `npm run typecheck` reported pass in `SELF-FIX-NOTES.md`; not re-run here (findings-only scope).
- God-file sizes (SR-M7/M8, deferred) re-measured for context, not re-counted as findings: `routes/service.ts` 1028 lines (grew from scrypt + unlock helper), `ops/import.ts` 716, `ops/repeat.ts` 710.
- Admin page guards (SR-M1) re-verified: every page under `src/app/(admin)/admin/**` calls `requireAdminPage` or `requirePermission`; the `(admin)/layout.tsx` fallback that still renders `{children}` for non-staff is now harmless because every child page throws `AuthError(403)` and renders `<Forbidden>`.
- No new blockers found. The two majors (RQ-1, RQ-2) are both in code touched by the self-fix pass and represent incomplete closure of the underlying issues (retry safety for refunds; consistency of the "unlocked" concept across GET vs POST).
