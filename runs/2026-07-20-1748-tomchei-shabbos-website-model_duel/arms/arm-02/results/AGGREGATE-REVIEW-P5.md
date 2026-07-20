# Aggregate Review — P5 — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Phase:** P5 (Checkout: delivery rules, fees, Stripe hosted checkout, order lifecycle, POS payments)
**Inputs:** P5-security, P5-quality, P5-rules, P5-clean-code (arm-02)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 11 |
| Minor | 18 |
| **Total** | **30** |

Source totals (pre-dedupe): security 8, quality 10, rules 9, clean-code 14 = 41. 21 findings merged into 10 cross-source clusters; net 30 unique.

## Blockers (1)

### B1 — STRIPE_WEBHOOK_SECRET ships with a known default
**Sources:** security HIGH-1
**Location:** `lib/env.ts:25` + `app/api/webhooks/stripe/route.ts:35` + `lib/payments/webhook-verify.ts:15-32`
**Claim:** `STRIPE_WEBHOOK_SECRET` defaults to `whsec_dev_mock_secret`; the webhook route authenticates every event purely with this value. A deployment that omits the env var trusts a public, repo-committed secret on the primary money ingress — anyone who can reach `/api/webhooks/stripe` can forge `checkout.session.completed` (mark orders PAID/FINALIZED + commit stock), forge `refund.*` events, or drive the `!safe` auto-refund branch. No startup guard rejects the default when `STRIPE_SECRET_KEY` is set (real mode). Signature scheme itself is sound; the failure is the default + absence of a fail-closed check.

## Majors (11)

### M1 — Silent fallback to mock gateway in any non-dev environment
**Sources:** security MEDIUM-1
**Location:** `lib/payments/stripe.ts:98-103` + `app/api/dev/stripe-checkout/route.ts:22-61`
**Claim:** Mock mode selected whenever `STRIPE_SECRET_KEY` is unset, with no `NODE_ENV`/production guard. In mock mode `POST /api/checkout` returns a URL to `/dev/stripe-checkout`, which mints a signed `checkout.session.completed` and posts it through the real webhook → `postPayment`+`finalizeOrder` mark the order PAID/FINALIZED with zero real money captured. A misconfigured production deployment (missing key) silently accepts "paid" orders never charged. The `mode !== "mock"` 404 gate on the dev route is itself bypassed in exactly the misconfigured case.

### M2 — Refund sync listens for non-existent Stripe event types
**Sources:** security MEDIUM-3, rules H1
**Location:** `app/api/webhooks/stripe/route.ts:65`
**Claim:** Handler branches on `refund.created` / `refund.updated`; Stripe emits `charge.refunded` / `charge.refund.updated` (and `refund.*` objects, not events). Dashboard-issued refunds never sync back, `recordRefund` is never called for external refunds, and the local ledger diverges from Stripe (customer order still shows balance due). The plan ref / `.scratch/phase-plan.md` specified `charge.refunded` (R-168); mock gateway only emits `checkout.session.completed` so the deviation is invisible to smoke. Trust-boundary gap on the refund path that EXPECTED §4 requires; also a clean-code Anti-Hallucination + workflow "implement plans verbatim" break.

### M3 — Duplicate positive payment row on the finalize-after-payment failure path
**Sources:** security MEDIUM-2, quality M1
**Location:** `app/api/webhooks/stripe/route.ts:113-134` + `lib/payments/post-payment.ts:174-192`
**Claim:** On the safe branch `postPayment` writes a `+amountCents` POSTED row before `finalizeOrder` is attempted. If `finalizeOrder` throws (stock ran out between checkout and webhook), `autoRefund` writes ANOTHER `+amountCents` POSTED row plus the `-amountCents` refund row. Net money is correct, but two charge rows exist for one Stripe charge, `recalcPaymentStatus` runs against an intermediate 2×-charge state, and the ledger no longer matches Stripe's 1:1 charge. The `safe===false` path is correct; only the finalize-failure path double-books. Not covered by smoke (S5 only exercises `safe===false`).

### M4 — Webhook idempotency ledger commits before the money work; multi-transaction writes block crash recovery
**Sources:** quality H1, rules M2
**Location:** `app/api/webhooks/stripe/route.ts:45-52,84-145`
**Claim:** The `StripeWebhookEvent` row is inserted in its own auto-commit transaction, then `handleSessionCompleted`/`handleRefund` run afterward; `postPayment` and `finalizeOrder` are each their own `$transaction`. If the work throws (DB blip, OOM, crash between postPayment and finalize), the route returns 5xx and Stripe retries — but the retry hits the already-committed event id, gets `P2002`, and returns `{replay:true}` as a no-op. The original event is permanently lost: no payment, no finalize, no stock commit, no refund, with a posted charge orphaned in the ledger. The idempotency record must be written in the same transaction as the work (or marked pending→done). No DECISION-P5 entry records this window or a mitigation.

### M5 — Session marked auto_refunded even when the refund API call failed
**Sources:** quality M2
**Location:** `lib/payments/stripe.ts:169-197`
**Claim:** `autoRefund` swallows `gateway.createRefund` failures with a `console.error` and returns. Both callers (safe-false branch and finalize-failure branch) then unconditionally `db.stripeCheckoutSession.update({ status: "auto_refunded" })` and discard the order. The session row claims a refund that never reached Stripe; the customer is charged with no refund and the only signal is a log line. Status should reflect "refund failed / needs manual" so ops can reconcile.

### M6 — Dead exported voidPayment helper diverges from the live void route
**Sources:** quality M3, clean-code F1
**Location:** `lib/payments/post-payment.ts:63-74` vs `app/api/admin/orders/[id]/payments/[paymentId]/void/route.ts:27-43`
**Claim:** `voidPayment(paymentId, staffId)` has zero callers. The admin void route inlines the same logic and diverges: the route writes an audit row and guards `method === "STRIPE"` (refuse) + "already voided"; the helper does neither. Two void implementations will drift further. Either route the handler through the helper (moving audit + guards inside) or delete the helper.

### M7 — Duplicated checkout-context bootstrap
**Sources:** clean-code F2
**Location:** `app/api/checkout/route.ts:37-50` + `app/api/checkout/quote/route.ts:17-29`
**Claim:** Both routes run the identical 5-step preamble: `guardPublicEndpoint` → `getOpenSeason` → `resolveDraftOwner` → `findActiveDraft` → `buildCheckoutQuote`. Two real call sites now; a third (order-review/quote) would copy it again. Extract `loadCheckoutContext(request, bucket, limit)` returning `{ season, draft, quote } | Response`.

### M8 — Duplicated issues-flattening expression (3 call sites)
**Sources:** clean-code F3
**Location:** `lib/checkout/create-order.ts:60-63`, `app/api/checkout/quote/route.ts:42-45`, `app/(storefront)/checkout/page.tsx:45-48`
**Claim:** The exact expression `[...quote.priced.issues, ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`))]` appears three times. Extract `flattenPricedIssues(priced): string[]` next to `priceCart`.

### M9 — Divergent re-implementation of assignmentKey + dead lines[].recipientKey prop
**Sources:** quality L2, rules L6, clean-code F4
**Location:** `app/(storefront)/checkout/page.tsx:60-66` vs `lib/checkout/recipients.ts:28-35`
**Claim:** The checkout page re-implements `assignmentKey` inline but returns the literal `new` for every `newRecipient` assignment, whereas the real `assignmentKey` returns `new:${recipient|line1|zip}`. Two new-recipient lines at different addresses both collapse to `new`; the `recipients` prop (built from `quote.recipients`, real keys) is inconsistent with `lines[].recipientKey`. `CheckoutForm` never reads `lines[].recipientKey` (only `id/productName/quantity/lineTotalCents`), so the field is also dead — a maintenance trap. Drop `recipientKey` from the `lines` prop or import and call `assignmentKey`.

### M10 — Copy-paste destination-map blocks in computeFees
**Sources:** clean-code F5
**Location:** `lib/checkout/fees.ts:63-73` (BULK_DELIVERY) + `92-102` (SHIPPING) + flush loops `107-122`
**Claim:** Two structurally identical `Map<destination, { methodId, label, keys }>` blocks and two near-identical flush loops differ only in label prefix and which config field supplies `amountCents`. Extract `accumulateDestination(map, method, recipient, labelPrefix)` + a parameterised flush.

### M11 — Inconsistent address-key normalization
**Sources:** clean-code F6
**Location:** `lib/checkout/recipients.ts:33-34` (`assignmentKey`: `trim().toLowerCase()` joined by `|`) vs `126-130` (`destinationKey`: `trim().replace(/\s+/g, " ").toLowerCase()`)
**Claim:** Two "same address" concepts, two normalization rules — internal whitespace collapsed in one but not the other. A recipient at `123  Main St` and `123 Main St` collide on destination but not on assignment. Extract one shared `normalizeAddressKey(address)` helper for both.

## Minors (17)

### m1 — /api/dev/stripe-checkout has no public guard, rate limit, or auth
**Sources:** security LOW-1, rules L4
**Location:** `app/api/dev/stripe-checkout/route.ts:22`
**Claim:** A state-changing money-path trigger (mints a webhook event and finalizes an order) that bypasses `guardPublicEndpoint`, unlike sibling `/api/checkout` and `/api/checkout/quote`. The real-mode 404 gate and random `cs_mock_<24-hex>` session ids keep exploitation marginal, but in mock mode anyone who learns a session id (e.g. from the customer redirect URL) can drive that checkout to completion from any origin with no throttling. workflow § Security Basics: "Least privilege by default"; the opt-out has no documented reason.

### m2 — clientIp trusts the LAST hop of X-Forwarded-For
**Sources:** security LOW-2
**Location:** `lib/rate-limit.ts:28-37`
**Claim:** When `TRUST_PROXY=true`, the rate-limit key is built from the last entry of the client-supplied `X-Forwarded-For` chain. The safe selection behind a single appending proxy is the leftmost hop; the last-hop choice is only correct if exactly one proxy always appends and never passes through a pre-existing header. If the proxy forwards the client's chain as-is (or the chain is multi-hop), the attacker controls the last hop and can mint a fresh rate-limit bucket per request, defeating the 20/60s checkout and 60/60s quote limits. The comment asserts the last hop "cannot be forged," which is only true under a narrow proxy contract.

### m3 — Webhook buffers the full request body before signature verification
**Sources:** security LOW-3
**Location:** `app/api/webhooks/stripe/route.ts:34-37`
**Claim:** `await request.text()` (unbounded) runs before `verifyWebhookSignature`. With no body-size cap, an attacker can POST an arbitrarily large payload to the unauthenticated webhook endpoint and force the server to buffer it fully in memory before rejecting the signature — a cheap memory-amplification vector against the money endpoint. The idempotency ledger and signature check do not mitigate the pre-verification buffering.

### m4 — Checkout throws an unhandled 500 on a client-supplied key that misses the server-resolved map
**Sources:** security LOW-4
**Location:** `lib/checkout/create-order.ts:160-162`
**Claim:** Throws `Error("…lost its pricing or recipient mid-transaction")` when a client-supplied `recipientKey`/`methodId` does not match a server-resolved recipient. `checkoutSchema` accepts arbitrary `z.string().min(1)` recipient keys, so a malformed payload produces a 500 (transaction rolls back) rather than a 4xx. Combined with the 20/60s rate limit this is a minor error-spray / log-noise vector, not a money risk.

### m5 — Refund-sync path has no running-app evidence
**Sources:** rules M1
**Location:** `.scratch/PHASE-P5-SMOKE.md` S5 / `handleRefund`
**Claim:** EXPECTED #4 requires "refund sync"; S5 claims it. But the smoke evidence only exercises the staff-initiated Stripe refund (`.../refund` → negative POSTED row). The webhook-driven refund sync (R-168) is never driven through the running app — no mock event is produced for it, and there is no unit test for `handleRefund`. Workflow § Verification: "never mark done from code alone… every item with evidence from the running app"; the expectation item is checked without evidence for the webhook half. (Compounded by M2 — the handler listens for the wrong event type, so even a real refund would not fire it.)

### m6 — handleSessionCompleted orchestrates money writes outside the transactional pattern
**Sources:** clean-code F12
**Location:** `app/api/webhooks/stripe/route.ts:84-145`
**Claim:** The handler performs `stripeCheckoutSession.update`, then `postPayment` (own tx), then `finalizeOrder` (own tx), then `stripeCheckoutSession.update` (status=completed), then `orderDraft.updateMany` — five separate writes, only some in transactions. A failure between `finalizeOrder` and the session-status update leaves the order finalized but the session record stale. Every other money write in P5 goes through `postPayment`/`recordRefund` (one transaction + status recalc); this orchestration does not follow that pattern. One pattern per concern for money writes. (Related to M4 — same code region, pattern-drift lens.)

### m7 — Out-of-zone recipient can default to a blocked delivery method
**Sources:** quality L1
**Location:** `components/checkout/checkout-form.tsx:49,199`
**Claim:** `defaultMethodId` is the first PICKUP method, else `methods[0]`. If the first method by `sortOrder` is `PER_PACKAGE_DELIVERY` and a recipient is out-of-zone, that recipient initializes to a method whose radio is `disabled`. The customer sees a pre-checked-but-disabled choice and a fee error and must manually pick another method for each such recipient. Default selection should skip methods blocked for that recipient's ZIP.

### m8 — Cart line greeting is dead schema carried through checkout
**Sources:** quality L3
**Location:** `lib/order-builder/cart.ts:25,48,105,164` + `components/builder/order-builder.tsx:132` + `lib/checkout/create-order.ts:177`
**Claim:** `cart.ts` defines a per-line `greeting` field threaded into `PricedLine.greeting`, but the builder only ever sets it to `""` and `create-order.ts` overwrites it with `greetingFor(recipient)` (from `greetingDefault`/`greetingOverrides`). The cart field is never user-settable and never read at checkout. Either wire it through or remove it.

### m9 — TOCTOU between quote and order commit
**Sources:** quality L4
**Location:** `lib/checkout/create-order.ts:51-84`
**Claim:** `buildCheckoutQuote` (which calls `priceCart`) runs outside the create transaction, then the order is created inside `db.$transaction` using the pre-computed totals. Prices/stock are not re-read inside the transaction, so a change in the small window between quote and commit can land on a stale-priced order. The `expectedTotalCents` check only proves the client agreed with the server's quote; it does not prove the order matches the DB at commit time. Narrow race, but real for a money path.

### m10 — checkout.session.expired leaves DRAFT orders behind
**Sources:** quality L5
**Location:** `app/api/webhooks/stripe/route.ts:57-64`
**Claim:** Flips the session to `expired` but never touches the DRAFT order. Re-checkout handles it (the next `createOrderFromCart` discards the stale DRAFT and marks the old session `replaced`), but until then DRAFT orders for abandoned sessions accumulate. No stock leak (reservation is at finalize), so impact is limited to clutter / stale rows.

### m11 — Inconsistent validation-error response shape
**Sources:** clean-code F7
**Location:** `app/api/checkout/route.ts:45` (`{ error: "Checkout payload is invalid" }`), `app/api/checkout/quote/route.ts:25` (`{ error: "Quote payload is invalid" }`), `app/api/admin/orders/[id]/refund/route.ts:21` + `.../payments/route.ts:23` (`{ error: parsed.error.issues[0].message }`)
**Claim:** Zod failures across sibling P5 routes return three different shapes — two generic, one first-issue message. Two policies for the same concern. Pick one (first-issue message is the most useful) and apply everywhere.

### m12 — Magic values
**Sources:** clean-code F8
**Location:** `lib/checkout/quote.ts:34` (`shippingPlaceholderCents: rates[0]?.amountCents ?? 1500` — bare `1500` fallback cents, unlabeled); `.max(200)` for choices/overrides arrays in `app/api/checkout/route.ts:11,16` and `app/api/checkout/quote/route.ts:8` — same magic cap in three places.
**Claim:** Named constants (`DEFAULT_SHIPPING_PLACEHOLDER_CENTS`, `MAX_CHECKOUT_CHOICES`) centralize both.

### m13 — Redundant non-null assertions after a proven early return
**Sources:** rules L1, clean-code F9
**Location:** `lib/checkout/create-order.ts:143` (`customerId!`), `146`/`149` (`quote.fees!.ok`, `quote.fees!.feesCents`, `quote.fees!.feeLines`)
**Claim:** Lines 67–73 already return when `!quote.fees || !quote.fees.ok`, so `quote.fees.ok` is guaranteed true here — the `!` assertions and both ternaries are defensive code for a condition that cannot happen. Bind a local `const fees = quote.fees` (narrowed to the ok variant) before the `$transaction` closure and drop the bangs.

### m14 — Duplicate open-season lookup with two accessors
**Sources:** quality L6, clean-code F10
**Location:** `app/api/checkout/route.ts:40-41` (`getOpenSeason()`) + `lib/checkout/create-order.ts:48` (raw `db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } })`)
**Claim:** Two queries for the same invariant, via two different accessors (`getOpenSeason` vs raw `findFirst` with its own ordering). Two ways to read "the open season" is exactly the pattern drift the rule warns about. Pick one accessor.

### m15 — UI token drift in mock-pay-buttons.tsx
**Sources:** rules L5, clean-code F11
**Location:** `components/checkout/mock-pay-buttons.tsx:38,46,50` (`bg-indigo-600`, `border-slate-200`, `text-slate-600`, `text-red-600`)
**Claim:** Uses raw Tailwind colors while the rest of P5 uses the app's design tokens (`bg-surface`, `border-border`, `text-brand`, `text-muted`, `bg-danger/5`). The `/dev/stripe-checkout` page's raw `slate-900` palette is documented as intentional ("Visually distinct from the store on purpose"), but `MockPayButtons` is a shared component with no such justification — violates "One styling approach per project." Distinctness belongs on the page wrapper, not on a store component using a parallel color vocabulary.

### m16 — JSON.parse(payload) unguarded in the webhook
**Sources:** rules L2
**Location:** `app/api/webhooks/stripe/route.ts:39`
**Claim:** `eventSchema.safeParse(JSON.parse(payload))`. The signature is verified first, so risk is low, but a signed non-JSON body makes `JSON.parse` throw → 500 instead of the 400 the route returns for other malformed inputs. Error-handling pattern is inconsistent within the same route.

### m17 — Vague standalone names
**Sources:** rules L3, clean-code F13
**Location:** `app/api/webhooks/stripe/route.ts:95` (`safe` → `chargeSafe`), `route.ts:75` (`record` → `sessionRecord`), `lib/payments/post-payment.ts:8,37` (`entry` → `paymentInput`), `components/checkout/checkout-form.tsx:89,133` (`fresh` → `freshQuote`)
**Claim:** clean-code: "Boolean names read as yes/no questions." `safe` doesn't. The other three are vague standalone nouns whose meaning is only clear at the call site. Borderline; `safe` and `record` are the vaguest.

### m18 — checkout-form.tsx mixes concerns (god-file by concern, under 500 lines)
**Sources:** clean-code F14
**Location:** `components/checkout/checkout-form.tsx` (338 lines)
**Claim:** Combines quote-fetch effect + abort, order placement + conflict resolution, and the full render of items, per-recipient method grid, greeting/donation, guest contact, and totals. Not over the 500-line threshold, but mixed concerns (state orchestration + four UI sections). Candidate split: a `useCheckoutQuote` hook plus `CheckoutItemsSection` / `CheckoutRecipientSection` / `CheckoutTotalsSection`. Borderline — flag for the next refactor pass, not a blocker.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M2 | security MEDIUM-3 ; rules H1 |
| M3 | security MEDIUM-2 ; quality M1 |
| M4 | quality H1 ; rules M2 |
| M6 | quality M3 ; clean-code F1 |
| M9 | quality L2 ; rules L6 ; clean-code F4 |
| m1 | security LOW-1 ; rules L4 |
| m13 | rules L1 ; clean-code F9 |
| m14 | quality L6 ; clean-code F10 |
| m15 | rules L5 ; clean-code F11 |
| m17 | rules L3 ; clean-code F13 |

All other aggregate IDs are single-source. No new findings introduced.
