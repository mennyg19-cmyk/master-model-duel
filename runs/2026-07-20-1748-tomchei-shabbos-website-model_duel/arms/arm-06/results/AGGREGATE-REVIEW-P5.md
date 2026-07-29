# P5 Aggregate Review â€” arm-06 (blind)

**Phase:** P5 â€” Checkout: delivery rules, fees, Stripe hosted checkout, POS, order lifecycle
**Sources (specialist reviews, union + dedupe by location+claim):**
- `results/reviews/P5-security-arm-06.md`
- `results/reviews/P5-quality-arm-06.md`
- `results/reviews/P5-rules-arm-06.md`
- `results/reviews/P5-clean-code-arm-06.md`

**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings introduced during aggregation. Each item tagged with source specialist(s).

## Counts summary

| Severity | Raw (sec/qual/rules/clean) | Deduped |
|---|---|---|
| Blocker | 0 / 0 / 0 / 0 | **0** |
| Major | 2 / 1 / 1 / 2 | **4** |
| Minor | 4 / 3 / 4 / 9 | **19** |
| **Total** | 26 | **23** |

Dedupe merges:
- Race "POS finalize / Stripe webhook" â€” Security M-1 + Security M-2 + Quality M1 â†’ 1 Major.
- Client/server bulk-dedupe key divergence â€” Quality m1 + Clean-code Major-1 â†’ 1 Major.
- 3 raw items collapsed into 1 (net âˆ’2); plus the dedupe-key pair âˆ’1. 26 âˆ’ 3 = 23.

No security blockers were raised; the highest-severity security items are Major.


## Blockers

None.

## Majors (prioritized)

### MAJ-1 - POS finalize / Stripe webhook race: captured card charge with no Payment row, no auto-refund (double payment)
**Sources:** security (M-1, M-2), quality (M1)
**Where:** `lib/checkout/checkout.ts` `finalizePosOrder` (lines 407-435) and `completeCheckoutSession` (lines 308-310).
**Claim:** `finalizePosOrder` finalizes a DRAFT order (cash/check) without checking or clearing `order.stripeSessionId`, so a customer mid-hosted-Stripe-checkout on the same draft can still complete the Stripe session. The webhook then reaches `completeCheckoutSession`, finds `order.status === "FINALIZED"`, and returns `outcome: "duplicate"` - without posting a `Payment`, without calling `safetyRefund`, and without an audit row. Net: Stripe captured the card, the order has zero card payments, `paymentStatus` stays UNPAID, and the POS cash/check payment also stands (double payment). The web `submitCheckout` path releases the reservation and clears `stripeSessionId` on edit; the POS path has no equivalent guard. The FINALIZED branch in `completeCheckoutSession` is missing the `safetyRefund` that the DISCARDED/non-DRAFT branch calls. The existing test (`scripts/test-checkout.mts:388-403`) never creates a Stripe session before POS-finalizing, so the gap is uncovered. EXPECTED #4 (charged-amount safety + auto-refund) and #6 (POS) both assume the two paths never collide on the same submitted draft; nothing enforces that.

### MAJ-2 - Client/server bulk-delivery dedupe keys diverge (duplicated logic + drift)
**Sources:** quality (m1), clean-code (Major-1)
**Where:** server `lib/checkout/fulfillment.ts:84-94` (`bulkAddressKey`) + `lib/checkout/checkout.ts:140-151`; client `app/(storefront)/checkout/checkout-form.tsx:93-96`.
**Claim:** The client "mirrors the server's fee math for display only" but uses a different dedupe key. Server key: `[line1, city, region, normalizePostalCode(postalCode), country]` with `normalizeWhitespace` + `toLowerCase`. Client key: `normalizePostalCode(postalCode) + addressLine.toLowerCase()` where `addressLine` is the formatted line1/line2/city/region/postalCode string. Two differences: (1) the client does not call `normalizeWhitespace` on the parts - a recipient stored with `line1 = "123  Main St"` collapses to `"123 main st"` on the server but stays `"123  main st"` on the client; (2) the client key includes `line2` via `addressLine`, the server key does not. Two recipients can dedupe as one destination on the server but two on the client (or vice versa), so the displayed total can differ from the server's frozen total and surface as a misleading 409 "totals changed since the draft was saved" on a clean re-submit. Violates `clean-code.mdc` Consistency / one pattern per concern; the math is duplicated and the two copies use different keys. Fix: expose `bulkAddressKey` from `fulfillment.ts` and call it from the client with the recipient's structured fields.

### MAJ-3 - Public guard triad applied unevenly across the public mutation surface
**Sources:** rules (M-1)
**Where:** `app/api/checkout/{submit,pay}/route.ts` carry all three P5 guards (same-origin via `assertSameOrigin`, 20/min IP rate limit via `checkoutRateLimit`, zod via `parseBody`). `app/api/drafts/route.ts` POST: rate-limit + zod, no same-origin. `app/api/drafts/[draftRef]/route.ts` GET + DELETE: no same-origin, no rate limit, no zod.
**Claim:** `clean-code.mdc` Consistency (one error-handling approach per project) and `workflow.mdc` Security Basics; P5 EXPECTED item 5 ("public endpoint guards: same-origin, rate limit, Zod"). The drafts endpoints are equally public mutation endpoints that carry the same anti-enumeration ownership (R-121/R-122) and stock side-effects - `DELETE /api/drafts/[draftRef]` releases a stock reservation; `POST /api/drafts` creates drafts and issues guest tokens. A cross-site POST to `POST /api/drafts` or a logged-in customer's `DELETE /api/drafts/[draftRef]` is equally CSRF-able. Ownership checks (session match or httpOnly guest-token cookie) contain the cross-customer blast radius - a CSRF attacker can only touch the authenticated victim's own drafts, and guest drafts have no session to ride - which is why this is Major and not Blocker. Either apply the triad to the drafts routes or record a README Rule Preferences entry narrowing "public endpoint guards" to checkout-only with the reason.

### MAJ-4 - `lib/checkout/checkout.ts` is a mixed-concerns module (entire checkout lifecycle in one file)
**Sources:** clean-code (Major-2)
**Where:** `lib/checkout/checkout.ts` (436 lines, 7+ exports).
**Claim:** `clean-code.mdc` Abstraction Discipline: "Split files by concern, not by line count - split when >500 lines, mixed concerns, or a refactor command." Mixed concerns applies regardless of the sub-500 line count. The file exports: `OfflinePaymentForbiddenError`, `submitCheckout`, `CheckoutSummary`, `payCheckout`, `StripeSessionCompleted`, `completeCheckoutSession`, `expireCheckoutSession`, `syncChargeRefunded`, `finalizePosOrder` - plus private helpers `loadAccessibleOrder`, `orderRefForSession`, `findOrderForSession`, `safetyRefund`. That is the entire checkout lifecycle: public submit, hosted-Stripe handoff, webhook completion, session expiry, refund sync, POS finalize, and the safety-refund side-path. Each is a distinct stage with its own callers and audit semantics. Suggested split by concern: `lib/checkout/submit.ts`, `lib/checkout/pay.ts`, `lib/checkout/webhook.ts` (complete/expire/sync/safetyRefund), `lib/checkout/pos.ts`. `reservations.ts` already broke out one shared seam; the same discipline applies to the four lifecycle stages co-located here.
## Minors (prioritized)

### MIN-1 - `safetyRefund` releases the reservation before attempting the Stripe refund (double-charge on persistent failure)
**Sources:** security (m-1)
**Where:** `lib/checkout/checkout.ts:272-297` (`safetyRefund`).
**Claim:** `releaseOrderReservation` runs first, then `createRefund`. If `createRefund` throws (Stripe API outage, merchant balance insufficient), the catch in `app/api/webhooks/stripe/route.ts` deletes the idempotency row and returns 500 so Stripe retries - and the retry is safe because `releaseOrderReservation` is idempotent and `createRefund` uses an idempotency key. But a *persistent* refund failure (not a transient one) leaves the original charge captured while the order is back in DRAFT with `stripeSessionId` cleared and stock released - the customer can re-submit and re-pay, producing a second captured charge with the first still outstanding. No alerting or dead-letter row exists for a refund that keeps failing.

### MIN-2 - Audit writes for payment void/refund run outside the engine transaction
**Sources:** security (m-2)
**Where:** `lib/checkout/checkout.ts` `syncChargeRefunded` (lines 392-399) and `safetyRefund` (lines 283-296); POS routes `app/api/admin/payments/[paymentId]/void/route.ts`, `app/api/admin/orders/[orderId]/payments/route.ts`.
**Claim:** All call `recordAudit` *after* the `$transaction` that mutated the payment commits. A process crash between commit and audit leaves a voided/refunded payment with no audit trail. For payment mutations the audit row is the durable regulatory record; it should be inside the same transaction (as `finalizePosOrder`'s caller does for `order_finalize`, but not for the payment verbs).

### MIN-3 - Safety-refund audit row is conditional on the Stripe refund call succeeding
**Sources:** quality (m3)
**Where:** `lib/checkout/checkout.ts:272` (`safetyRefund`).
**Claim:** `safetyRefund` commits `releaseOrderReservation` in its own transaction, then calls `createRefund` (only when a secret key exists), then commits the `payment_auto_refund` audit row. If `createRefund` throws (Stripe API error / network), the audit is skipped and the reservation is already released. The webhook route's catch returns 500 so Stripe retries, and the retry is idempotent on Stripe's side (`refund-${paymentIntent}`), so the audit eventually lands - but during a prolonged Stripe outage the safety event has no durable record while the reservation is already gone. Keyless deployments are unaffected (the audit is written immediately with a null refund id). Related to MIN-2 (audit timing) but a distinct mechanism (conditional skip vs transaction boundary).

### MIN-4 - Dev-auth bypass is open on Vercel preview deployments
**Sources:** security (m-3)
**Where:** `lib/env.ts:31-32`.
**Claim:** `isDevAuthBypass = env.DEV_AUTH_BYPASS === "true" && !isProductionDeploy`, where `isProductionDeploy = process.env.VERCEL_ENV === "production"`. On a Vercel preview deployment (`VERCEL_ENV === "preview"`) with `DEV_AUTH_BYPASS=true` in the env, `/api/dev-auth` and `/api/dev-auth-customer` are live on a public URL - anyone who knows a `staffUserId` / `customerId` (UUIDs, but static per environment) can mint a session. The guard should additionally require `VERCEL_ENV === "development"` or an explicit non-public allow flag. The `.env` in this workspace ships with `DEV_AUTH_BYPASS="true"`.

### MIN-5 - `safeEqual` short-circuits on length mismatch (timing length oracle)
**Sources:** security (m-4)
**Where:** `lib/hmac.ts:32-39`.
**Claim:** `if (a.length !== b.length) return false;` before the byte-wise constant-time loop leaks the expected HMAC length via timing. Practical impact is low because every HMAC consumer here produces a fixed-length base64url output (session codec, guest token, newsletter token, Stripe webhook v1), and the expected length is derivable from the algorithm - so the oracle reveals nothing an attacker doesn't already know. Noted for completeness; the comparison itself is constant-time once lengths match.

### MIN-6 - Status doc misstates the test counts
**Sources:** quality (m2)
**Where:** `arms/arm-06/workspace/.scratch/PHASE-P5-STATUS.md:24`.
**Claim:** Claims "46 unit checks" in `scripts/test-p5.mts` and "44 DB checks" in `scripts/test-checkout.mts`. Actual counts are 38 `check(...)` calls in `test-p5.mts` and 50 in `test-checkout.mts`. Cosmetic, but it overstates unit coverage and understates DB coverage.

### MIN-7 - `.gitignore` ignores `.env` only, not `.env*`
**Sources:** rules (m-1)
**Where:** `workspace/.gitignore:3` - `.env` (single entry).
**Claim:** `workflow.mdc` Security Basics: "`.env*` in `.gitignore`". `.env.example` is correctly NOT ignored (and is committed as a regenerable artifact). But `.env.local`, `.env.production`, `.env.development`, etc. are not matched by the single `.env` line and could be `git add`ed by accident. One-character fix (`.env` -> `.env*`); `.env.example` keeps rendering as a tracked file under both patterns. The P5 secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are the most sensitive values this phase introduced, so the glob tightening is timely.

### MIN-8 - Auto-refund does not cover "season closed before finalize"
**Sources:** rules (m-2)
**Where:** `lib/checkout/checkout.ts:302-328` (`completeCheckoutSession`) calls `finalizeOrderTx` (`lib/orders/state-machine.ts:41`), which throws `DomainRuleError("Season ... is closed; expected OPEN to finalize")` when the season closed between submit and the webhook landing.
**Claim:** P5 EXPECTED item 4: "charged-amount safety + auto-refund of stale/failed; refund sync." `completeCheckoutSession` safety-refunds on status mismatch, session-id mismatch, amount mismatch, no reservation, and paid-for-discarded - but a payment that lands after the season closed fails inside `finalizeOrderTx` rather than in the safety-refund branch. The webhook route's outer catch turns the `DomainRuleError` into a 500 + idempotency-row delete, so Stripe retries indefinitely; the captured charge is never refunded and the reservation stays held. A `season.status !== "OPEN"` check before the finalize attempt (routing to `safetyRefund` with a "season closed before finalize" reason) would close the gap. Narrow real-world window (seconds between submit and webhook), hence Minor. Upstream trigger is MIN-9.

### MIN-9 - `payCheckout` skips the open-season gate
**Sources:** rules (m-3)
**Where:** `lib/checkout/checkout.ts:217-241` (`payCheckout`).
**Claim:** `payCheckout` checks `order.status === "DRAFT"`, `stockReserved`, and fulfillment choices, but not `order.season.status === "OPEN"`. Compare `submitCheckout` (`:95`) and `finalizePosOrder` (`:414`), both of which assert the open season inside their transactions. `clean-code.mdc` "Consistency - one pattern per concern." A session created for a just-closed season captures a card payment that the webhook then can't finalize (this is what triggers MIN-8). The window is small (submit already gated the season), but the gate is cheap and the consistency is worth it - same `DomainRuleError("Season ... is closed; expected OPEN to check out")` the submit path raises.

### MIN-10 - Dead `Select` ui component + hand-rolled `<select>` in checkout form
**Sources:** rules (m-4)
**Where:** `components/ui/select.tsx` (a 1-line `<select>` wrapper with no logic) has zero call sites across the workspace. `app/(storefront)/checkout/checkout-form.tsx:190-212` and `:222-236` hand-roll `<select>` with Tailwind classes instead of using it.
**Claim:** `clean-code.mdc` "Rule of 2 - needs 2+ real call sites right now," "No wrapper components under 5 lines of JSX with no logic - inline it," and "UI Consistency - one styling approach per project." The component satisfies the deletion criteria on both counts (0 call sites, sub-5-line no-logic wrapper). The checkout form already uses the shared `Input`/`Button`/`Label` from `components/ui/`, so the kit is the chosen styling approach for this screen; the select is the one exception. Either delete `select.tsx` (the hand-rolled version is the live pattern) or adopt it and drop the inline classes.

### MIN-11 - Duplicated greeting-remembering loop (Rule of 2 met)
**Sources:** clean-code (Minor-1)
**Where:** `lib/checkout/checkout.ts:360-366` and `:426-432`.
**Claim:** The "remember effective greeting on each book-linked recipient" block appears verbatim in `completeCheckoutSession` and `finalizePosOrder`. Two real call sites right now. Extract `rememberGreetings(tx, order)`.

### MIN-12 - Duplicated stock-commit + reservation-clear block (Rule of 2 met)
**Sources:** clean-code (Minor-2)
**Where:** `lib/checkout/checkout.ts:331-335` and `:420-424`.
**Claim:** Same two functions repeat the stock commit + `stockReserved=false` update. Extract `commitOrderReservation(tx, order)`. Pairs with MIN-11 - both duplications live in the same two functions and would collapse together if a shared `finalizeSubmittedOrder(tx, order)` helper absorbed the post-submit commit + greeting + finalize core.

### MIN-13 - Duplicated checkout access-context construction
**Sources:** clean-code (Minor-3)
**Where:** `app/api/checkout/submit/route.ts:28-33` and `app/api/checkout/pay/route.ts:30-34`.
**Claim:** Two call sites build the same `access` object (`customerId` + `guestToken`). A `checkoutAccess(draftRef)` helper in `lib/orders/drafts.ts` (next to `DraftAccess`) would dedupe and keep the session-or-guest-token ownership rule in one place. Borderline under "if removing duplication adds more lines than it saves" - but the ownership construction is a security-relevant pattern worth centralizing.

### MIN-14 - Duplicated same-origin + rate-limit guard preamble
**Sources:** clean-code (Minor-4)
**Where:** `app/api/checkout/submit/route.ts:19-23` and `pay/route.ts:21-25`.
**Claim:** Both checkout routes repeat the same 5-line public-guard preamble (including the 429 message string verbatim). Two call sites now; a third public mutation route would tip this over. A `guardPublicCheckoutMutation(request)` returning `NextResponse | null` would consolidate the 429 message string and the guard order. Related to MAJ-3 (which is about the drafts routes *missing* the guards); this is about the duplication *within* the two checkout routes that do have them.

### MIN-15 - Duplicated domain-error to HTTP mapping pattern (5 sites)
**Sources:** clean-code (Minor-5)
**Where:** `submit/route.ts:38-49`, `pay/route.ts:41-52`, `finalize/route.ts:29-37`, `payments/route.ts:55-63`, `void/route.ts:38-46`.
**Claim:** Five P5 routes repeat the same `NotFoundError -> 404, DomainRuleError -> 422, rethrow` ladder, each with one or two extra branches. `lib/errors.ts` already owns `NotFoundError` / `DomainRuleError`; a sibling `mapDomainError(error, extras)` that returns a `NextResponse | null` (and accepts an `extras` map for the route-specific typed errors) would collapse the five copies and keep the error-handling approach "one per project" per `clean-code.mdc` Consistency.

### MIN-16 - `// P5:` change-explanation comment prefixes
**Sources:** clean-code (Minor-6)
**Where:** `lib/orders/drafts.ts:121`, `:146`; `lib/orders/state-machine.ts:38`; `lib/inventory/reserve.ts:21`; `lib/payments/post.ts:5`; `lib/checkout/reservations.ts:4`; `lib/checkout/checkout.ts:81`, `:299`, `:403`.
**Claim:** `clean-code.mdc` Comment Quality: "No change-explanation comments." Several P5 files carry `// P5: ...` prefixes (and `// Step N` markers) that mark *when* a block was added rather than *why* it exists. The "why" content of each comment is good and should stay; the `P5:` / `Step N` prefixes are the change-explanation tics and should be dropped so the comments read as durable intent rather than changelog entries.

### MIN-17 - `fulfillmentChoice` schema-as-string vs typed enum (type/schema drift)
**Sources:** clean-code (Minor-7)
**Where:** `prisma/schema.prisma:389` declares `fulfillmentChoice String?` as a free string; `lib/checkout/fulfillment.ts:12-13` declares the closed enum `FULFILLMENT_CHOICES`.
**Claim:** The zod schema (`recipientChoiceSchema`) validates the enum on the way in, but nothing at the schema/DB level stops a stray write (a future script, a manual fix, a Prisma raw query) from storing `"FOO"`. Readers of `order.recipients[].fulfillmentChoice` get `string | null`, not the union. `clean-code.mdc` Abstraction Discipline flags "Type/schema drift - centralize types, single source of truth." The enum is the single source of truth in code; the column should reflect it (Prisma enum, or at minimum a DB CHECK constraint in the migration).

### MIN-18 - Unsafe cast of webhook `data.object` to `StripeSessionCompleted`
**Sources:** clean-code (Minor-8)
**Where:** `app/api/webhooks/stripe/route.ts:48-50` (also `:54-55` and `:59-60` for `expireCheckoutSession` and `syncChargeRefunded`).
**Claim:** `event` is `JSON.parse(rawBody) as StripeEvent` (line 34, also unvalidated), then `event.data.object as unknown as Parameters<typeof completeCheckoutSession>[0]`. The signature check guarantees authenticity, but the *shape* of the payload is still external input asserted via `as unknown as ...`. `completeCheckoutSession` reads `session.id`, `session.amount_total`, `session.payment_intent`, `session.client_reference_id`, `session.metadata.orderId` - a malformed (but correctly signed) payload yields `undefined` flowing into domain logic rather than a clean 400. `clean-code.mdc` Anti-AI-Tics: "No redundant type assertions the compiler already guarantees" - this is the inverse: the compiler guarantees nothing here. A zod schema for the three webhook event shapes would make the assertion honest and the 400 path explicit. (Security reviewer may rate higher; tagged Minor under clean-code lens.)

### MIN-19 - Vague standalone names
**Sources:** clean-code (Minor-9)
**Where:** `lib/rate-limit.ts:17` `function hit(key, limit, now): boolean`; `lib/payments/stripe.ts:21` `let cached: StripeConfig | null = null`.
**Claim:** `hit` is a vague standalone name (the banned list calls out `temp`, `val`, `item`, etc.; `hit` is the same class) - `tryConsume` or `allowRequest` reads as the yes/no the function returns. `cached` is a vague standalone name for a module-level singleton - `stripeConfigCache` (or just inline the config object, since it's read once and never invalidated) would be clearer.

## Notes (not findings)

- Webhook authenticity (raw-body HMAC, 5-min replay window, idempotency row, delete-on-fail for Stripe retry) is correct.
- Charged-amount safety check (`session.amount_total !== order.totalCents`) and session-id mismatch refund are correct on the non-FINALIZED paths.
- Anti-enumeration (404 on ownership miss, never 403) is consistently applied across drafts, checkout, and address book.
- Stock reservation uses `SELECT ... FOR UPDATE` row locks; the conditional `updateMany` guards on finalize/discard prevent double-claim of order numbers.
- Same-origin guard, per-IP rate limits, and Zod validation are present on all public checkout mutation endpoints as required by R-122.
- `.env` is gitignored and untracked (confirmed via git status); no secret commit leak.
- All 8 EXPECTED items are implemented and the 38-check smoke (S1-S5) passes against the real webhook route with fixture-signed payloads.
- No rule violation blocks the P5 gate; the four Majors are consistency/race/dedup concerns that should be reconciled before the gate closes.