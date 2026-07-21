# Reviewer — Rules — arm-03 (Test 5, P5)

**Arm:** arm-03
**Tree / phase:** `arms/arm-03/workspace/` — Phase P5 (checkout: delivery rules + fees, hosted Stripe, order lifecycle, payments, POS)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer:** orchestrator (independent of contestants, blind to model name)
**Scope:** findings only — adherence to arm-03's selected catalog rules. Grill-protocol out of scope this pass.

---

## ponytail

- **MEDIUM — `lib/orders/finalize.ts` is a 539-line god-file inflated by double-blank-line padding.** The file inserts a blank line between every statement (538 LF bytes; ~270 lines of logic doubled to 539). It now has real P5 callers (`finalizeOrder` is invoked from `lib/payments/webhook.ts:150` and `lib/payments/offline.ts:79`; `discardDraft`/`transitionOrder` from `app/api/orders/lifecycle/route.ts:23,44`), so the P4 YAGNI concern is resolved — but the formatting bloat flagged in P4 (MINOR then) is still unaddressed and the file now trips the ponytail/clean-code "split when >500 lines" trigger while being load-bearing for checkout. ponytail § "God files: split when refactor command, >500 lines, or mixed concerns"; clean-code § Anti-AI-tics: "no over-verbose code that does in 10 lines what could be done in 3." Fix is reformat to single-spaced (drops under the split line), not a split.
- **MINOR — `ponytail:` ladder marker missing on P5 deliberate shortcuts.** Three P5 shortcuts name their ceiling/upgrade path in prose but omit the `ponytail:` tag: `lib/checkout/delivery.ts:96-99` ("Placeholder rate-resolution (live Shippo deferred to P8)"), `lib/stripe/client.ts:38-48` mock Stripe id minters + `whsec_mock_dev_only` webhook secret, and `lib/payments/webhook.ts:308-330` `buildMockCheckoutCompletedEvent`. Same gap as arm-01/arm-02 P4. ponytail § "`ponytail:` comment on deliberate shortcuts (name ceiling + upgrade path if any)."
- **PASS — dependency discipline.** No new packages for P5. Stripe is loaded via `require("stripe")` only when not in mock mode (`lib/stripe/client.ts:23`), reusing the already-installed dep; webhook signature uses `node:crypto` (`createHmac`, `timingSafeEqual`); rate limiter is in-memory stdlib. Placeholder delivery fees live as named `DEFAULT_DELIVERY_FEES` constants, not magic values.

## clean-code

- **MEDIUM — duplicated `feeLines` mapping across `lib/checkout/session.ts`.** The same 9-line `order.lines.map((l) => ({ id, recipientName, addressLine1, city, state, postalCode, country, fulfillmentMethodCode: l.fulfillmentMethod?.code ?? null }))` block is copy-pasted at lines 106-115 (`buildCheckoutSummary`), 286-295 (`prepareCheckout`), and 369-378 (`createHostedCheckoutSession`). Three copies; drift risk on any `CheckoutLineForFees` shape change. Extract a `toFeeLines(order)` helper and reuse. § duplicated logic.
- **MEDIUM — duplicated "if PAID/OVERPAID and PLACED → transition to PAID + ORDER_PAID audit" logic.** The same transition block appears in `lib/payments/webhook.ts:211-227` (inside the checkout-completed transaction) and `lib/payments/offline.ts:121-139` (inside `postOfflinePayment`). Two copies of the `assertOrderTransition(PLACED, PAID)` + `order.update({status: PAID})` + `auditLog.create({action: ORDER_PAID, via})` pattern. Extract a `transitionToPaidIfFullyPaid(tx, orderId, currentStatus, via, actorId)` helper. § duplicated logic / one error-handling approach.
- **MINOR — fragile string-match to classify zip-blocked errors.** `lib/checkout/session.ts:471` catches `assertPerPackageZipsAllowed`'s throw and branches on `error.message.includes("Per-package delivery")` to build a `zip_blocked` conflict. The same function is also called bare on line 380 (letting it throw to the outer catch). Relying on a substring of a human error message is a typed-error smell — if the message text drifts the branch silently degrades to a generic 500. Use a typed error (e.g. `ZipBlockedError` with `zips`) or have `assertPerPackageZipsAllowed` return a `Result`. § Error Handling / one error-handling approach.
- **MINOR — redundant `typeof ... === "string"` guards against a typed `string | null`.** `lib/payments/webhook.ts:118-124,152-156,163-166` wraps `session.payment_intent` (typed `string | null` on `CheckoutCompletedObject:25`) in `typeof pi === "string" ? pi : String(pi)` and `?? mintMockPaymentIntentId()` chains. The `typeof`/`String()` casts are defensive code for a condition the type already excludes. Anti-AI-tics: "No defensive code for conditions that can't happen" / "No redundant type assertions the compiler already guarantees."
- **MINOR — dead/redundant catch branches.** `app/api/checkout/route.ts:106-108` and `app/api/checkout/offline/route.ts:132-134` both end with `if (error instanceof AuthError) return apiErrorResponse(error); return apiErrorResponse(error);` — both arms do the identical call. Collapse to a single `return apiErrorResponse(error);`. § dead code.
- **MINOR — `lib/orders/package-stages.ts` import block has double-blank-line padding (lines 1-10).** Same formatting bloat as `finalize.ts` but contained to the import header; cosmetic but inconsistent with the rest of the P5 files which use single spacing.
- **MINOR — inconsistent button styling despite shared `<Button>`.** `components/checkout/checkout-client.tsx:340-369` renders raw `<button>` + hand-rolled Tailwind (`rounded bg-[var(--color-leaf)] px-4 py-2 …`) for Pay-with-Stripe / Post cash / Post check instead of the shared `<Button>` component referenced in P4. Same pattern P4 flagged; still present on the new P5 checkout screen. § UI Consistency / one styling approach.
- **MINOR — magic rate-limit numbers inline.** `app/api/checkout/route.ts:58,81` use bare `limit: 30` and `limit: 20` for the prepare/start guards. Other timings in the arm live as named constants; these two are inline. § magic values.
- **PASS — `draftInclude` duplication from P4 is fixed.** `lib/orders/drafts.ts:13-27` now exports a single shared `draftInclude` (with `orderBy: { createdAt: "asc" }`); the previous 3-copy spread across `drafts.ts` / `api/drafts/route.ts` / `api/drafts/[draftRef]/route.ts` is consolidated. Good response to the P4 MEDIUM.

## workflow

- **VIOLATION — `DECISION-LOG.md` still missing.** No `DECISION-LOG.md` anywhere under `arms/arm-03/` (workspace root, `.scratch/`, arm root all checked). P5 made several silent business-logic choices: placeholder delivery fees (500/800/1200¢) and bulk=per-destination vs per-package=per-recipient; hard per-package zip block with "no manager override"; Purim-week day validation tied to BULK/PER_PACKAGE only; charged-amount safety refund on any `charged !== expected` mismatch; mock Stripe as the default P5 mode; `assertPerPackageZipsAllowed` throws in `createHostedCheckoutSession` but returns a conflict in `prepareCheckout`. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." None are logged or flagged. Same VIOLATION as P4, now spanning two phases.
- **MINOR — no `.scratch/run-state.md`.** P5 is a multi-phase feature; workflow § "Run checkpoint" requires the rolling `protocol / phase / last_gate_passed / next_action` file for multi-phase runs. No `.scratch/` directory exists under `arms/arm-03/workspace/` at all. Same MINOR as P4.
- **MINOR — no `.scratch/phase-plan.md` with EXPECTED blocks.** Workflow § "Expectation Files" requires a rolling phase plan with an EXPECTED block written **before each todo** (route, control, behavior — observable). `shared/phases/PHASE-P5-EXPECTED.md` exists at the shared level, but arm-03 has no pre-todo expectation file. Same MINOR as P4.
- **PASS — running-app verification.** `scripts/smoke-p5.mjs` (581 lines) exercises all five P5 smoke checks against a live server with real HTTP + DB assertions: S1 hosted-Stripe checkout + webhook replay (one order/payment/stock commit, idempotent replay), S2 bulk=2-dest/2-fees + per-pkg=3-recipients/3-fees + out-of-zone zip block, S3 stale price/total refusal, S4 staff cash/check post + void with audit + public 401/403, S5 lifecycle transitions + sequential numbering + discard + safety refund + payment-status recalc. Evidence is written to `.scratch/PHASE-P5-SMOKE.md` at runtime (gitignored), so the artifact isn't persisted in the tree, but the script itself is strong running-app evidence — not "done from code alone."

## vocabulary

- **PASS — term accuracy.** P5 terms used consistently across README, smoke script, lib, routes, and UI copy: hosted Stripe Checkout, webhook, idempotency / replay, charged-amount safety refund, draft / placed / paid / discarded, fulfillment method (PICKUP / BULK_DELIVERY / PER_PACKAGE_DELIVERY / SHIP), greeting default vs per-recipient override vs remembered, POS, void, order lifecycle. No refactor / tidy / rebuild commands issued this phase, so the scope table is not exercised. "Live Shippo deferred to P8" placeholder is correctly scoped in `delivery.ts` and the EXPECTED file.

## codegraph

- **PASS — index initialized and present.** `arms/arm-03/workspace/.codegraph/codegraph.db` exists (2.8 MB, updated this session) with `.gitignore`. codegraph.md § "Hard rule": "If `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once" — satisfied. Whether the contestant queried the graph vs. grepping cannot be proven from artifacts; the init obligation is met. Same PASS as P4.

---

## Count

13 findings — **0 High, 4 Medium, 9 Low**.

Medium: `finalize.ts` 539-line god-file via double-blank padding (P4 MINOR, now load-bearing in P5); duplicated `feeLines` mapping (3 copies in `session.ts`); duplicated PAID-transition logic (`webhook.ts` + `offline.ts`); missing `DECISION-LOG.md` (silent P5 business-logic choices — VIOLATION).

Low: missing `ponytail:` markers on placeholder-rate + mock-Stripe shortcuts, fragile string-match zip-blocked classification, redundant `typeof` guards on typed `payment_intent`, dead `AuthError` catch arms (2 files), `package-stages.ts` import padding, inconsistent raw `<button>` on checkout screen, inline rate-limit magic numbers, no `.scratch/run-state.md`, no `.scratch/phase-plan.md` EXPECTED file.

Resolved from P4: `finalizeOrder` YAGNI (now has callers); `draftInclude` duplication (now a single shared export).
