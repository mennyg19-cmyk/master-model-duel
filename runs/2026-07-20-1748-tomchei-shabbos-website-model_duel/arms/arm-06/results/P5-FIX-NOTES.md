# P5 FIX NOTES — arm-06 (Test 4 fix pass)

**Date:** 2026-07-29 · **Source list:** `AGGREGATE-REVIEW-P5.md` (4 majors / 19 minors)
**Result:** **4/4 majors fixed. 19/19 minors fixed, 0 deferred.**
**Verification:** lint ✓ · typecheck ✓ · migration-guard ✓ (9 migrations, in sync) · test:unit ✓ (6 suites; test-p5 now 51 checks) · test:domain ✓ (6 suites; test-checkout now 62 checks) · build ✓ · **re-smoke S1–S5: 43 checks, 0 failures** (`.scratch/PHASE-P5-SMOKE.md`).

---

## Majors — all 4 fixed

### MAJ-1. POS finalize / Stripe webhook race — FIXED
Two-sided guard. **POS side:** `finalizePosOrder` (`lib/checkout/pos.ts`) refuses with `SessionInFlightError` → **409** when `order.stripeSessionId` is set — staff wait for the session to complete or expire instead of double-taking payment. **Webhook side:** `completeCheckoutSession` (`lib/checkout/webhook.ts`) now handles a payment landing on an already-FINALIZED order: if the same session replayed or a payment with the session's `payment_intent` was already posted → `duplicate` (no-op); a *different* session that never posted → `safetyRefund` (keyless on this host; with keys it refunds first, then releases + audits in one tx). DB checks cover the gate, the 409-mapped error, the post-POS safety refund with zero card payments, the audit row, and the replay-vs-foreign-session split. Smoke: **S4h** (409 while in flight), **S4i** (finalize proceeds once cleared, next sequential number), **S4j** (late foreign session → safety refund + `payment_auto_refund` audit, order keeps 0 payments).

### MAJ-2. Client/server bulk-delivery dedupe keys diverge — FIXED
The checkout form now imports the server's own `bulkAddressKey`/`normalizeWhitespace` from `lib/checkout/fulfillment.ts` (single implementation; the client copy is deleted) and `app/(storefront)/checkout/page.tsx` passes the structured address fields (`line1/city/region/country/postalCode`) the key needs. UI totals and server totals group identically by construction. Smoke **S2a** still proves the rule end-to-end (3 recipients, 2 destinations → fees 1000/0/1000).

### MAJ-3. Public guard triad consistency on `/api/drafts/*` — FIXED
`POST /api/drafts` and `DELETE /api/drafts/[draftRef]` now run the same triad as checkout: `assertSameOrigin` → rate limit (`draftSaveRateLimit`) → Zod. GETs stay unguarded-by-origin on purpose (non-mutating, ownership-gated 404-on-miss). Smoke: **S1o** (POST cross-origin 403), **S1p** (DELETE cross-origin 403, finalized order untouched), **S1q** (malformed body 400).

### MAJ-4. `lib/checkout/checkout.ts` mixed-concerns split — FIXED
The 600-line module is gone, split by concern: `order-load.ts` (shared include + loaders), `finalize.ts` (`commitSubmittedOrder` — the one stock-commit + greeting-remember path both webhook and POS use; this also closes MIN-11/MIN-12), `submit.ts` (validation/freeze/reserve), `pay.ts` (hosted-session creation), `webhook.ts` (zod event schemas, complete/expire/refund-sync, `safetyRefund`), `pos.ts` (`finalizePosOrder`), plus `access.ts` (MIN-13). All call sites re-import from the focused modules.

---

## Minors — all 19 fixed

| # | Fix |
|---|---|
| MIN-1 | `safetyRefund` reordered: refund attempt **first** (failure rethrows → route 500 → Stripe retries, reservation held), then release + audit in one transaction — no double-charge window |
| MIN-2 | `recordAudit(entry, tx?)` accepts a transaction client; `payment_post`, `payment_void`, `payment_auto_refund`, and refund-sync audits now write inside the engine transaction (admin payments/void routes wrapped in `prisma.$transaction`) |
| MIN-3 | `payment_auto_refund` audit is unconditional (inside the same tx as the release), refund id recorded when Stripe answers, null on the keyless host |
| MIN-4 | `isDevAuthBypass` now also requires `VERCEL_ENV` unset-or-development — bypass is dead on Vercel production **and preview** deploys |
| MIN-5 | `safeEqual` rewritten: no length early-return, constant-time over the max length — timing side-channel closed (unit checks incl. length mismatch + empty strings) |
| MIN-6 | Test coverage extended: test-p5 38 → **51** unit checks (guard preamble, webhook schemas, safeEqual), test-checkout 47 → **62** DB checks (POS gate, post-POS safety refund, replay-vs-foreign split, closed-season pay/webhook, enum enforcement), smoke 38 → **43** (S1o–q, S4h–j, S5f) |
| MIN-7 | `.gitignore`: `.env` → `.env*` with `!.env.example` — `.env.local` etc. can't leak, the example stays tracked |
| MIN-8 | `completeCheckoutSession` checks the season **before** finalizing: payment landing after close → safety refund instead of an infinite 500-retry loop (DB check proves DRAFT + 0 payments + released reservation + audit) |
| MIN-9 | `payCheckout` enforces the same open-season gate as submit (DB check: closed season → DomainRuleError before any session exists) |
| MIN-10 | Dead `components/ui/select.tsx` adopted: both checkout-form dropdowns (fulfillment choice, delivery day) use it — one styled select, no hand-rolled divergence |
| MIN-11 | Stock-commit logic lives once in `commitSubmittedOrder` (`lib/checkout/finalize.ts`), used by webhook + POS |
| MIN-12 | Greeting-remember loop lives in the same `commitSubmittedOrder` — one implementation, both paths |
| MIN-13 | `checkoutAccess(draftRef)` in `lib/checkout/access.ts` builds the DraftAccess (session + guest cookie) once; used by submit/pay routes and the checkout page |
| MIN-14 | `guardPublicCheckoutMutation` in `lib/public-guard.ts` (same-origin + checkout limiter); both checkout routes call it (unit checks: pass/403/429) |
| MIN-15 | `mapDomainError` in `lib/http-errors.ts` maps `NotFoundError`/`DomainRuleError` (+ per-route extras like `SessionInFlightError → 409`, `OfflinePaymentForbiddenError → 403`, `StripeNotConfiguredError → 503`) — five routes deduplicated; `CheckoutConflictError` keeps its custom 409 body |
| MIN-16 | `// P5:` / `// Step N` change-explanation prefixes reworded out of drafts/state-machine/reserve/payments/checkout comments — comments say why, not when |
| MIN-17 | `DraftRecipient.fulfillmentChoice` is now a real Prisma enum (`FulfillmentChoice`), migration `20260729120000_fulfillment_choice_enum`; DB refuses stray values (DB check proves it) |
| MIN-18 | Webhook `data.object` casts replaced by zod schemas (`checkoutSessionObjectSchema`, `chargeRefundedObjectSchema`, event envelope) parsed **before** the idempotency row — signed-but-malformed → 400 (unit checks + smoke **S5f** proves no `StripeWebhookEvent` row is created) |
| MIN-19 | Vague names renamed: `hit` → `tryConsume` (rate-limit), `cached` → `stripeConfigCache` (stripe) |

## Contract changes reviewers should know

1. `POST /api/admin/orders/[orderId]/finalize` returns **409** (`SessionInFlightError`) when a Stripe session is in flight (was: would finalize into a potential double payment).
2. `checkout.session.completed` on a FINALIZED order: `duplicate` when the session/payment is already accounted for, `safety_refund` otherwise — never a second finalize, never a silent charge.
3. Signed-but-malformed webhook payloads now get **400** and leave **no** idempotency row (retries with a corrected payload are accepted).
4. `/api/drafts` POST and DELETE enforce same-origin (403) + rate limit (429) like checkout.
5. `prisma` schema: `fulfillmentChoice` is enum-typed (new migration) — raw SQL writes outside the enum fail at the database.
6. `lib/checkout/checkout.ts` no longer exists; import from `lib/checkout/{submit,pay,webhook,pos,finalize,order-load,access}.ts`.
7. `DEV_AUTH_BYPASS=true` is ignored when `VERCEL_ENV` is `production` or `preview`.

## Notes

- One latent smoke-tooling hazard found and fixed during verification: an interrupted earlier run had left a `smoke-p5-tracked` product + closed 2026 season behind, which tripped the test DB sweep (XOR-constraint on product delete) and the smoke's `make-smoke-product`. The sweep now deletes inventory items by slug pattern before products, and the leftover rows/season state were cleaned; 2026 reopened.
- The keyless-host seam is unchanged: safety refunds skip the Stripe API call without keys (audit records null refund id); every other path — including the new duplicate/foreign-session split — runs for real against the DB.
