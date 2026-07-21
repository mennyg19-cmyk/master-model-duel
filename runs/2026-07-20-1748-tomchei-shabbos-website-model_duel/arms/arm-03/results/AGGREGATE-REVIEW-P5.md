# Aggregate Review — P5 — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-03
**Phase:** P5 (checkout: delivery rules + fees, hosted Stripe, order lifecycle, payments, POS)
**Inputs:** P5-security, P5-quality, P5-rules, P5-clean-code (arm-03)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 17 |
| Minor | 21 |
| **Total** | **41** |

Source totals (pre-dedupe): security 15, quality 13, rules 13, clean-code 12 = 53. 10 clusters merged; net 41 unique.

## Blockers (3)

### B1 — `claimWebhookEvent` swallows Stripe retries after transient failures
**Sources:** security H1, quality F1, quality F2
**Location:** `lib/payments/webhook.ts:42-50, 282-287`
**Claim:** The `catch {}` returns `false` for any Prisma error, not just `P2002` (unique violation), and the event is claimed *before* `handleCheckoutSessionCompleted` runs. A transient DB blip (connection drop, deadlock, timeout) returns `false` → `processStripeWebhook` returns `ok({ replay: true })` with HTTP 200, so Stripe stops retrying. The order stays unfinalized/unpaid forever; customer is charged, stock never reserved. Fix: scope catch to `P2002`, re-throw everything else (return 500 so Stripe retries), and track `processing`/`processed` state per event so a claimed-but-unprocessed event re-runs.

### B2 — `/api/checkout/mock-complete` is a public backdoor in non-mock envs
**Sources:** security H2, quality F6
**Location:** `app/api/checkout/mock-complete/route.ts:18-43`
**Claim:** The guard is `getStripeMode() !== "mock" && NODE_ENV === "production"`, so `test`/`live` mode in `development`/staging/preview leaves the endpoint open with no `withPublicGuard`, no rate limit, no draft-ownership check. Any caller can POST `{ sessionId, orderId, amountCents }` for any order and run it through `processStripeWebhook`, finalizing the order and posting a Stripe payment. A matching amount completes any order. Fix: gate on `getStripeMode() !== "mock"` only (drop the `NODE_ENV` clause), and add `withPublicGuard` + draft-ownership even in mock.

### B3 — Refund webhook double-counts `refundedCents` (no per-refund idempotency)
**Sources:** security H3
**Location:** `lib/payments/webhook.ts:233-261, 296-300`
**Claim:** `handleChargeRefunded` increments `refundedCents` keyed only on `payment_intent`. The dispatcher matches both `charge.refunded` and `refund.created` (Stripe emits both for one refund) — two distinct events with different IDs and identical `payment_intent`/`amount`, so a single refund increments twice, corrupting `recalcOrderPaymentStatus` (can flip PAID → PARTIAL/UNPAID). No dedupe by `refund.id`. Fix: persist seen refund IDs and skip if already applied.

## Majors (17)

### M1 — Webhook signature has no timestamp freshness / replay window
**Sources:** security M1
**Location:** `lib/stripe/client.ts:60-88`
**Claim:** `verifyWebhookSignature` HMAC-verifies `t.payload` with `timingSafeEqual` but never compares `t` to current time. Stripe's official library rejects events older than ~5 min. Exact-replay is caught by `claimWebhookEvent` on `event.id`, but the missing freshness check is a defense-in-depth gap. Add `if (Math.abs(now - t) > 300) return false`.

### M2 — `checkout.session.completed` handler does not check `payment_status`
**Sources:** security M2
**Location:** `lib/payments/webhook.ts:97-132`
**Claim:** `handleCheckoutSessionCompleted` only compares `amount_total` to `expected`; never asserts `session.payment_status === "paid"`. A deferred/`pay_later` or 3DS-session-completed event would finalize the order and post a `POSTED` Stripe payment for an uncaptured charge. Assert `payment_status === "paid"` before finalizing.

### M3 — `withPublicGuard` same-origin check bypassable by header omission
**Sources:** security M3, quality F5
**Location:** `lib/http/public-guard.ts:40-58, 55-57`
**Claim:** When `Origin` and `Referer` are both absent, the guard allows the request if `Sec-Fetch-Site` is `same-origin`, `none`, or `null`. The `null` branch (header missing entirely) means any non-browser client (curl, server-to-server, CSRF script stripping headers) bypasses the same-origin check on customer-facing checkout endpoints. Fail closed: require `Origin`/`Referer` present and matching; only relax for an explicit internal allow-list.

### M4 — `clientIp` trusts `X-Forwarded-For` blindly; rate limits trivially evadable
**Sources:** security M4, quality F12
**Location:** `lib/http/public-guard.ts:13-17, 78-86`
**Claim:** `clientIp` returns the first comma-delimited XFF entry with no trusted-proxy validation. An attacker rotates XFF per request for a fresh rate-limit bucket on `checkout-prepare`/`checkout-start`. The bucket map is in-module-memory (not shared across instances), so multi-instance deploys multiply the effective limit. Validate XFF only against a trusted hop list; back the limiter with shared storage for production.

### M5 — Dev auth trusts `x-dev-user-id` header for full identity spoofing
**Sources:** security M5
**Location:** `lib/auth.ts:36-54`
**Claim:** In `AUTH_MODE=dev`, `getAuthIdentity` reads `x-dev-user-id` (then a cookie, then `DEV_ACTING_USER_ID`). Any request with `x-dev-user-id: dev_manager_1` is treated as that manager, and `isPublic` middleware exempts `/api/checkout(.*)`, `/api/drafts(.*)`, `/api/dev(.*)` from Clerk `protect()`. A dev/preview instance exposed to the internet is a full auth bypass to manager level. Disable the header path whenever `NODE_ENV=production` regardless of `AUTH_MODE`; preview deploys must never run dev auth.

### M6 — Stale-price conflict has no server-side resolution path
**Sources:** quality F3
**Location:** `lib/checkout/validation.ts:67-86`
**Claim:** `validation.ts` flags `stale_price` when `line.unitPriceCents !== line.currentProductPriceCents` and the conflict message says "Refresh to continue," but nothing in the codebase updates `orderLine.unitPriceCents` after creation — no reprice endpoint and `prepareCheckout` does not re-snapshot. A customer whose product price changed after adding the line is permanently blocked unless they delete and re-add. Smoke only proves the conflict is *detected*, not *resolvable*. Add a reprice action in `prepareCheckout` or a documented re-add flow.

### M7 — `tampered_price` check is a stub
**Sources:** quality F4
**Location:** `lib/checkout/validation.ts:169-175`
**Claim:** The "tamper" loop only rejects `lineSubtotalCents(line) < 0`; it never compares a client-claimed line total against a server-recomputed one. EXPECTED #3 says "tampered price fails validation," but S3 smoke never tests tamper, so this passes by not being exercised. Either implement a client-claimed-line-total field + comparison, or drop the conflict kind to avoid implying protection that isn't there.

### M8 — `prepareCheckout` and `createHostedCheckoutSession` are not transactional
**Sources:** quality F7
**Location:** `lib/checkout/session.ts:221-281, 399-454`
**Claim:** Both functions do a sequence of `db.orderLine.update` (one per recipient line), `db.order.update`, `db.stripeCheckoutSession.create`, `db.auditLog.create`, and (live mode) a Stripe API call, all outside any transaction. A failure midway leaves some lines with the new fulfillment method and some without, `expectedTotalCents` written but no `StripeCheckoutSession` row (or a live Stripe session orphaned with no DB row), and `version` incremented multiple times for one logical op. Wrap the DB writes in `db.$transaction`; only call Stripe after the order row is committed; record the Stripe session in a follow-up transaction.

### M9 — `finalize.ts` 539-line god-file inflated by double-blank-line padding
**Sources:** rules ponytail MEDIUM, clean-code F10
**Location:** `lib/orders/finalize.ts`
**Claim:** The file inserts a blank line between every statement, inflating ~270 lines of logic to 538/539. It now has real P5 callers (`finalizeOrder` from `webhook.ts:150` and `offline.ts:79`; `discardDraft`/`transitionOrder` from `lifecycle/route.ts`), so the P4 YAGNI concern is resolved — but the formatting bloat trips the ponytail/clean-code "split when >500 lines" trigger on a load-bearing file. Reformat to single-spaced (drops under the split line); not a split.

### M10 — Duplicated `feeLines` mapping across `session.ts` (3 copies)
**Sources:** rules clean-code MEDIUM, clean-code F2
**Location:** `lib/checkout/session.ts:106-115, 286-295, 369-378`
**Claim:** The identical 9-line `order.lines.map((l) => ({ id, recipientName, addressLine1, city, state, postalCode, country, fulfillmentMethodCode }))` block is byte-identical in three places. Drift risk on any `CheckoutLineForFees` shape change. Rule-of-2 met. Extract `toFeeLines(order): CheckoutLineForFees[]` and reuse in `buildCheckoutSummary`, `prepareCheckout`, `createHostedCheckoutSession`.

### M11 — Duplicated PAID-transition logic (`webhook.ts` + `offline.ts`)
**Sources:** rules clean-code MEDIUM
**Location:** `lib/payments/webhook.ts:211-227`, `lib/payments/offline.ts:121-139`
**Claim:** Two copies of the `assertOrderTransition(PLACED, PAID)` + `order.update({status: PAID})` + `auditLog.create({action: ORDER_PAID, via})` pattern. Extract `transitionToPaidIfFullyPaid(tx, orderId, currentStatus, via, actorId)` and call from both.

### M12 — `DECISION-LOG.md` still missing (silent P5 business-logic choices)
**Sources:** rules workflow VIOLATION
**Location:** `arms/arm-03/` (workspace root, `.scratch/`, arm root all checked — no `DECISION-LOG.md`)
**Claim:** P5 made several silent business-logic choices: placeholder delivery fees (500/800/1200¢) and bulk=per-destination vs per-package=per-recipient; hard per-package zip block with "no manager override"; Purim-week day validation tied to BULK/PER_PACKAGE only; charged-amount safety refund on any `charged !== expected` mismatch; mock Stripe as the default P5 mode; `assertPerPackageZipsAllowed` throws in `createHostedCheckoutSession` but returns a conflict in `prepareCheckout`. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." None logged. Same VIOLATION as P4, now spanning two phases.

### M13 — `"US"` magic string — repeat of P4 F4, now 4 new P5 sites
**Sources:** clean-code F1
**Location:** `lib/checkout/delivery.ts:66, 77`, `lib/checkout/greetings.ts:21`, `lib/checkout/session.ts:253`, `lib/orders/finalize.ts:148`
**Claim:** P4 F4 asked for `export const DEFAULT_COUNTRY = "US"` in `lib/constants.ts`; that never happened, and P5 adds five more inlined copies (10 sites across P4+P5). `lib/constants.ts` still holds only `SETUP_LOCK_KEY`. Add `DEFAULT_COUNTRY` and import it everywhere.

### M14 — Order-total formula duplicated 3× in `session.ts`
**Sources:** clean-code F3
**Location:** `lib/checkout/session.ts:148, 320-321, 396-397`
**Claim:** `subtotalCents + breakdown.totalFeeCents + order.donationCents` is recomputed in three places. Extract `computeOrderTotal({ subtotalCents, feeCents, donationCents })`. The formula will drift the day one of them needs a surcharge or discount.

### M15 — `recipients` Zod schema duplicated 2× with a minor variation
**Sources:** clean-code F4
**Location:** `app/api/checkout/route.ts:18-27`, `app/api/checkout/offline/route.ts:20-29`
**Claim:** The recipient array schema is byte-identical except the trailing `.min(1)` becomes `.optional()`. Export `recipientItemSchema` from `lib/checkout/validation.ts` (or a new `lib/checkout/schema.ts`) and compose with `.min(1)`/`.optional()` at the call site. `greetingDefault: z.string().max(500).optional()` is also shared — fold into the same module.

### M16 — Inconsistent error handling for `assertPerPackageZipsAllowed` + fragile string-match
**Sources:** clean-code F7, rules clean-code MINOR
**Location:** `lib/checkout/session.ts:298-312, 471-484`
**Claim:** `prepareCheckout` catches the throw locally and converts to a `zip_blocked` conflict; `createHostedCheckoutSession` calls it unguarded then catches by `error.message.includes("Per-package delivery")`. Two error-handling patterns for one assertion, and the second relies on a substring of a human error message — rename the message and the zip-block path silently degrades to a 500. Replace `assertPerPackageZipsAllowed` with a `Result`-returning function (or typed `ZipBlockedError` with `zips`) and handle identically at both call sites.

### M17 — Hand-rolled `Summary` client type drifts from server
**Sources:** clean-code F9
**Location:** `components/checkout/checkout-client.tsx:7-40`
**Claim:** The client redeclares the checkout summary shape by hand, collapsing `CheckoutConflict` (a 7-variant discriminated union in `validation.ts:30-38`) to `Array<{ kind: string; message: string }>`, losing every discriminant and payload field (`stale_price.expected`, `stock.needed`, `zip_blocked.zips`, …). `buildCheckoutSummary` returns an inline literal with no shared type. Export a `CheckoutSummary` type from `lib/checkout/session.ts` (and reuse `CheckoutConflict` directly) so the client can't drift. Same class as P4 F3.

## Minors (21)

### m1 — `assertOfflinePaymentStaffOnly(true)` is dead code / no-op guard
**Sources:** security L1, quality F9, clean-code F6
**Location:** `app/api/checkout/offline/route.ts:42, 141`; `lib/payments/offline.ts:203-207`
**Claim:** The route calls `assertOfflinePaymentStaffOnly(true)` with a hardcoded literal after `requirePermission("admin.access")` already guaranteed staff, so the `!isStaff` branch can never fire. R-127 is actually enforced by routing. The named guard is dead and misleading. Either delete it, or wire it to the real runtime staff boolean.

### m2 — `voidPayment` / `transitionOrder` / `discardDraft` have no per-order scoping
**Sources:** security L2
**Location:** `app/api/orders/lifecycle/route.ts`; `lib/payments/offline.ts:151-200`
**Claim:** Any staff with `admin.access` can void any CASH/CHECK payment by ID, transition any order, or discard any customer's draft. All actions are audited and `admin.access` is broad by design, but there is no ownership/region scoping. Worth noting if `admin.access` is ever granted broadly.

### m3 — `setup` bootstrap allows any signed-in user to seize first manager
**Sources:** security L3
**Location:** `app/api/setup/route.ts:28-97`
**Claim:** `POST /api/setup` only requires `getAuthIdentity()` (any signed-in Clerk user) plus the setup-lock mutex. The unique `appSetting.create` serializes concurrent bootstraps (P2002 → 409), but whoever wins becomes the first manager. If the site is reachable before setup completes, any registered user can take admin. Restrict bootstrap to an allow-list or an out-of-band claim.

### m4 — `dev/session` sets `dev_user_id` cookie `httpOnly: false`
**Sources:** security L4
**Location:** `app/api/dev/session/route.ts:17`
**Claim:** The dev identity cookie is JS-readable, so any XSS on a dev/preview instance can exfiltrate the acting user ID. Dev-only and gated by `AUTH_MODE=dev`, but the cookie should still be `httpOnly: true` to limit blast radius.

### m5 — `claimWebhookEvent` stores only `{ type }` as `meta`
**Sources:** security L5
**Location:** `lib/payments/webhook.ts:43-45`
**Claim:** The idempotency row records only `event.type`, not the event body or key fields, so forensics on a dropped/replayed event are limited. Store a redacted digest (sessionId, orderId, amount) for auditability without retaining PII.

### m6 — `donationCents` has no upper bound
**Sources:** security L6
**Location:** `app/api/checkout/route.ts:16`
**Claim:** `donationCents: z.number().int().min(0).optional()` has no max. The total is server-computed and the Stripe amount is derived from it, so a client can inflate the donation arbitrarily (the customer just pays more). Not exploitable for fraud, but cap it to a sane maximum to prevent accidental huge charges and keep `expectedTotalCents` arithmetic clean.

### m7 — Guest draft token lookup iterates up to 25 rows non-constant-time
**Sources:** security L7
**Location:** `lib/orders/drafts.ts:118-136`; `app/api/drafts/route.ts:44-57`
**Claim:** `findGuestDraftByToken` / drafts GET loop over the 25 most-recent guest drafts and return on first `guestTokenMatches` hit. The loop length leaks a weak timing signal about match position. Guest tokens are 24 random bytes, so enumeration is infeasible; the signal is negligible. Acceptable, noted for completeness.

### m8 — `CachedPaymentStatus.REFUNDED` is dead code
**Sources:** quality F8
**Location:** `lib/payments/offline.ts:18-27`
**Claim:** `computeCachedPaymentStatus` never returns `REFUNDED` even though the enum value exists. A fully refunded order (posted net ≤ 0) reports `UNPAID`, misleading staff dashboards and the lifecycle route's `recalc_payment` consumer. Either compute `REFUNDED` when `postedNet < 0` and there is at least one non-zero historical posting, or remove the enum value.

### m9 — `safetyRefund` on charged-mismatch leaves a recoverable-but-inconsistent state
**Sources:** quality F10
**Location:** `lib/payments/webhook.ts:117-132`
**Claim:** On charged≠expected, the code refunds, marks the `StripeCheckoutSession` `safety_refunded`, and returns `ok` leaving the order in `DRAFT`. A later legitimate `checkout.session.completed` for the same `session.id` with the correct amount would skip the mismatch branch and proceed to finalize + post a second payment. The first refund payment row (amount 0, refunded = charged) remains in `order.payments`, so `recalcOrderPaymentStatus` nets it as negative and the order could flip to `UNPAID`/`PARTIAL` despite the second successful charge. Mark the session terminal on `safety_refunded`, or clear the orphan refund row when a valid retry lands.

### m10 — `transitionOrder` allows cancellation of PAID orders with no inventory release
**Sources:** quality F11
**Location:** `lib/orders/state-machine.ts`; `lib/payments/offline.ts`
**Claim:** `state-machine.ts` allows `PAID → CANCELLED` and `PLACED → CANCELLED`, and `transitionOrder` performs no inventory release or refund on cancel. For P5 this is arguably fine (admin ops hub is P6, package lifecycle P7–P9), but a staff member cancelling a PAID order via `/api/orders/lifecycle` right now leaves stock reserved and the customer charged. Add a guardrail ("cancel PAID requires refund + release") or an explicit deferral note in the route.

### m11 — `prepareCheckout` writes `expectedTotalCents` from stale line snapshots
**Sources:** quality F13
**Location:** `lib/checkout/session.ts:320-339`
**Claim:** When `validation` reports `stale_price` conflicts, `prepareCheckout` still writes `order.expectedTotalCents = validation.subtotalCents + fees + donation`, where `subtotalCents` is computed from stale `line.unitPriceCents`. The route returns the conflicts (so checkout is blocked), but the order row now carries a stale expected total. A subsequent `createHostedCheckoutSession` re-validates and recomputes, so this is self-correcting on the happy path, but any code that reads `order.expectedTotalCents` between the two calls (POS, lifecycle recalc) sees a wrong number. Skip the `expectedTotalCents` write when `validation.ok === false`.

### m12 — `ponytail:` ladder marker missing on P5 deliberate shortcuts
**Sources:** rules ponytail MINOR
**Location:** `lib/checkout/delivery.ts:96-99` (placeholder rate-resolution, Shippo deferred to P8), `lib/stripe/client.ts:38-48` (mock Stripe id minters + `whsec_mock_dev_only`), `lib/payments/webhook.ts:308-330` (`buildMockCheckoutCompletedEvent`)
**Claim:** Three P5 shortcuts name their ceiling/upgrade path in prose but omit the `ponytail:` tag. Same gap as arm-01/arm-02 P4. Add the `ponytail:` comment naming ceiling + upgrade path.

### m13 — Redundant `typeof pi === "string" ? pi : String(pi)` on typed `payment_intent`
**Sources:** rules clean-code MINOR, clean-code F8
**Location:** `lib/payments/webhook.ts:118-125, 152-158, 163-166`
**Claim:** `session.payment_intent` is typed `string | null` and `mintMockPaymentIntentId()` returns `string`, so `pi` is always `string`. The `typeof`/`String()` casts are defensive code for a condition the type already excludes. Pass `pi` directly. Anti-AI-tics: "No defensive code for conditions that can't happen."

### m14 — Dead `if (error instanceof AuthError)` catch branch (×2)
**Sources:** rules clean-code MINOR, clean-code F5
**Location:** `app/api/checkout/route.ts:106-108`; `app/api/checkout/offline/route.ts:132-134`
**Claim:** Both routes end with `if (error instanceof AuthError) return apiErrorResponse(error); return apiErrorResponse(error);` — both arms do the identical call. `apiErrorResponse` already special-cases `AuthError`. Collapse to a single `return apiErrorResponse(error);`. Keeping the branch implies a distinction that does not exist.

### m15 — `package-stages.ts` import block has double-blank-line padding
**Sources:** rules clean-code MINOR
**Location:** `lib/orders/package-stages.ts:1-10`
**Claim:** Same formatting bloat as `finalize.ts` but contained to the import header; cosmetic but inconsistent with the rest of the P5 files which use single spacing. Reformat to single-spaced.

### m16 — Inconsistent button styling despite shared `<Button>`
**Sources:** rules clean-code MINOR
**Location:** `components/checkout/checkout-client.tsx:340-369`
**Claim:** The checkout screen renders raw `<button>` + hand-rolled Tailwind (`rounded bg-[var(--color-leaf)] px-4 py-2 …`) for Pay-with-Stripe / Post cash / Post check instead of the shared `<Button>` component referenced in P4. Same pattern P4 flagged; still present on the new P5 checkout screen. Use `<Button>` variants.

### m17 — Magic rate-limit numbers inline
**Sources:** rules clean-code MINOR
**Location:** `app/api/checkout/route.ts:58, 81`
**Claim:** Bare `limit: 30` and `limit: 20` for the prepare/start guards. Other timings in the arm live as named constants; these two are inline. Hoist to named constants alongside the other P5 timing constants.

### m18 — No `.scratch/run-state.md`
**Sources:** rules workflow MINOR
**Location:** `arms/arm-03/workspace/.scratch/` (absent)
**Claim:** P5 is a multi-phase feature; workflow § "Run checkpoint" requires the rolling `protocol / phase / last_gate_passed / next_action` file for multi-phase runs. No `.scratch/` directory exists under `arms/arm-03/workspace/` at all. Same MINOR as P4.

### m19 — No `.scratch/phase-plan.md` with EXPECTED blocks
**Sources:** rules workflow MINOR
**Location:** `arms/arm-03/workspace/.scratch/` (absent)
**Claim:** Workflow § "Expectation Files" requires a rolling phase plan with an EXPECTED block written **before each todo** (route, control, behavior — observable). `shared/phases/PHASE-P5-EXPECTED.md` exists at the shared level, but arm-03 has no pre-todo expectation file. Same MINOR as P4.

### m20 — Three near-identical mock-id minters in `stripe/client.ts`
**Sources:** clean-code F11
**Location:** `lib/stripe/client.ts:38-48`
**Claim:** `mintMockSessionId`, `mintMockPaymentIntentId`, `mintMockEventId` — three functions with identical bodies modulo the prefix. Rule-of-2 met. Extract `function mintMockId(prefix: string): string { return \`${prefix}_mock_${randomBytes(12).toString("hex")}\`; }` and keep the three named wrappers as one-liners if their call-site names matter for grep.

### m21 — `checkoutSnapshot` + `order.update` block duplicated 2× in `session.ts`
**Sources:** clean-code F12
**Location:** `lib/checkout/session.ts:323-339, 399-412`
**Claim:** The snapshot construction and the `order.update` that persists `expectedTotalCents`/`fulfillmentFeeCents`/`checkoutSnapshot`/`version: { increment: 1 }` appear twice with near-identical bodies (the second omits `capturedAt`). Rule-of-2 met. Extract `persistCheckoutSnapshot(orderId, { breakdown, subtotalCents, donationCents, expectedTotalCents })`. The two copies will drift the moment one snapshot gains a field the other doesn't.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| B1 | security H1 ; quality F1 ; quality F2 |
| B2 | security H2 ; quality F6 |
| M3 | security M3 ; quality F5 |
| M4 | security M4 ; quality F12 |
| M9 | rules ponytail MEDIUM ; clean-code F10 |
| M10 | rules clean-code MEDIUM ; clean-code F2 |
| M16 | clean-code F7 ; rules clean-code MINOR (string-match zip-blocked) |
| m1 | security L1 ; quality F9 ; clean-code F6 |
| m13 | rules clean-code MINOR (typeof guards) ; clean-code F8 |
| m14 | rules clean-code MINOR (AuthError catch) ; clean-code F5 |

All other aggregate IDs are single-source. No new findings introduced.

## Pass notes (not counted)

- **Dependency discipline** (rules ponytail PASS): no new packages for P5. Stripe is loaded via `require("stripe")` only when not in mock mode (`lib/stripe/client.ts:23`), reusing the already-installed dep; webhook signature uses `node:crypto` (`createHmac`, `timingSafeEqual`); rate limiter is in-memory stdlib. Placeholder delivery fees live as named `DEFAULT_DELIVERY_FEES` constants, not magic values.
- **Running-app verification** (rules workflow PASS): `scripts/smoke-p5.mjs` (581 lines) exercises all five P5 smoke checks against a live server with real HTTP + DB assertions (S1 hosted-Stripe + webhook replay, S2 bulk/per-package fees + zip block, S3 stale price/total refusal, S4 staff cash/check post + void + public 401, S5 lifecycle + sequential numbering + discard + safety refund + recalc). Evidence written to `.scratch/PHASE-P5-SMOKE.md` at runtime (gitignored). Not "done from code alone."
- **`draftInclude` duplication fixed** (rules clean-code PASS): `lib/orders/drafts.ts:13-27` now exports a single shared `draftInclude` (with `orderBy: { createdAt: "asc" }`); the previous 3-copy spread is consolidated. Good response to the P4 MEDIUM.
- **`finalizeOrder` YAGNI resolved** (rules ponytail): P4 M9 flagged `finalize.ts` as speculative; P5 wires real callers (`webhook.ts:150`, `offline.ts:79`, `lifecycle/route.ts`). The file is now load-bearing; the remaining concern is formatting (M9), not scope.
- **Term accuracy** (rules vocabulary PASS): P5 terms used consistently across README, smoke script, lib, routes, and UI copy: hosted Stripe Checkout, webhook, idempotency/replay, charged-amount safety refund, draft/placed/paid/discarded, fulfillment method (PICKUP / BULK_DELIVERY / PER_PACKAGE_DELIVERY / SHIP), greeting default vs per-recipient override vs remembered, POS, void, order lifecycle. "Live Shippo deferred to P8" placeholder correctly scoped in `delivery.ts` and the EXPECTED file.
- **Codegraph index** (rules codegraph PASS): `arms/arm-03/workspace/.codegraph/codegraph.db` exists (2.8 MB, updated this session) with `.gitignore`. The init obligation is met; whether the contestant queried the graph vs. grepping cannot be proven from artifacts. Same PASS as P4.

## Smoke coverage gaps (not failures, untested by S1–S5)

- **Webhook retry after transient failure** — B1 not exercised. S1 only replays a *successful* event.
- **Tampered line total** — S3 checks `stale_price`/`stale_total`/`stock`, never `tampered_price` (M7).
- **Refund sync** — `charge.refunded` handler is implemented but no smoke sends a refund event and asserts `refundedCents` increments and cached status updates (B3, m8).
- **Guest checkout end-to-end** — all S1–S5 use `dev_customer_1` (authed). No smoke exercises the guest cookie token, `guestClearedAt` clearing, or anti-enumeration 404 for a wrong-principal draft (m7).
- **POS without prior prepare** — S4 always prepares before posting; the `fresh.expectedTotalCents == null` fallback branch in `offline/route.ts:65-99` is not exercised.
- **Hosted Stripe live mode** — only mock mode runs; the `stripe.checkout.sessions.create` branch is unreachable in smoke.
- **Per-package fee for same recipient at two addresses** — S2 only tests 3 distinct recipients. The `destinationKey` (recipient+address) semantics aren't pinned by a smoke case.

## Bottom line

No Critical. P5 arm-03 is functionally complete against EXPECTED (all 8 items implemented, smoke 5/5 PASS) and is the most complete P5 of the three arms with evidence. The blockers (B1–B3) are real correctness/security gaps in the webhook + mock-complete paths that the smoke does not exercise; they should be fixed before a Test 4 fix pass or any real Stripe live key. The majors are correctness/robustness gaps (M2, M6, M7, M8) plus the carry-over P4 formatting/dedup/DECISION-LOG debt now load-bearing in P5. The minors are dead-code, magic-value, and workflow-discipline cleanups. No regressions vs P1–P4 surfaces are visible; out-of-scope items (live Shippo P8, package board/printing/routes P7–P9, admin ops hub P6) are correctly deferred.
