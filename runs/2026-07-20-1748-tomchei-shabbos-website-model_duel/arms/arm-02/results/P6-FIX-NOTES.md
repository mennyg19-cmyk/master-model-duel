# P6 Fix Notes — arm-02 (single fix pass)

**Input:** `arms/arm-02/results/AGGREGATE-REVIEW-P6.md`
**Scope:** all 6 blockers + priority majors M1–M5, M7, M8. One pass; re-smoked S1–S4.
**Gate:** `npm run ci` green (lint + typecheck + migration guard + 45 unit tests). Smoke: **ALL PASS** — `arms/arm-02/workspace/.scratch/PHASE-P6-SMOKE.md` (driver: `.scratch/p6-smoke.ts`).

## Blockers

| # | Fix | Where |
|---|---|---|
| B1 | Refund is now DB-first: negative payment row + audit commit in one transaction BEFORE the Stripe call, holding the unique `stripeRefundId` slot with a `pending_{idempotencyKey}` placeholder. Stripe call carries a stable `Idempotency-Key` (sha256 of intent + amount + prior refunded sum); mock gateway derives its refund id from the key so retries map to the same refund. Concurrent duplicates collide on the unique key → 409. Gateway failure deletes the row and re-recalcs (no money moved). Webhook race handled: if the real refund id already landed, the placeholder is dropped. | `lib/payments/post-payment.ts` (`beginStaffRefund`/`resolveStaffRefund`/`cancelStaffRefund`), `lib/payments/stripe.ts` (idempotency key param, both gateways), `app/api/admin/orders/[id]/refund/route.ts` |
| B2 | Single `customerSearchWhere(q)` with the `looksLikePhone` guard; both the directory page and the lookup API consume it. | `lib/customers.ts`, `app/(admin)/admin/customers/page.tsx`, `app/api/admin/customers/route.ts` |
| B3 | `flattenQuoteIssues(priced)` extracted next to the quote engine; both POS and web quote routes use it. | `lib/checkout/quote.ts`, `app/api/admin/pos/quote/route.ts`, `app/api/checkout/quote/route.ts` |
| B4 | `pos-client.tsx` split by concern: shell/orchestration stays (109 lines); `pos-customer-picker.tsx` (find/create step), `pos-checkout.tsx` (quote + payment step). Import path for `PosClient` unchanged. | `components/admin/pos-client.tsx`, `pos-customer-picker.tsx`, `pos-checkout.tsx` |
| B5 | `settings-hub.tsx` reduced to the tab shell + shared `act`/`saveSetting` plumbing (~90 lines); tabs moved to `components/admin/settings/{orders,shipping,email,developer}-tab.tsx` with shared shapes in `settings/types.ts`. `SettingsHubData` re-exported so the page import is unchanged. | `components/admin/settings-hub.tsx`, `components/admin/settings/*` |
| B6 | One `apiFetch` helper (JSON headers, body serialization, `{error}` extraction, typed result) used by all five admin client components: pos-client, pos-customer-picker, pos-checkout, settings tabs, import-client, order-money-actions, order-bulk-actions. | `lib/api-client.ts` + the components above |

## Priority majors

| # | Fix |
|---|---|
| M1 | Refundable math scoped to the chosen payment intent (`stripePaymentIntentId` filter, both the route pre-check and the in-transaction re-check). |
| M2 | POS checkout: payment post, finalize, and both audit rows commit in ONE `db.$transaction` (via new optional `tx` param on `finalizeOrder`/`discardOrder`). Finalize failure rolls the payment back — no DRAFT order with a POSTED payment — and the route now returns 409 with `{error}`, not 200. Draft completion happens only after commit. |
| M3 | Bulk route writes a per-order `order.finalize`/`order.discard` audit row (with `targetId`, `via:"bulk"`) inside each order's transaction; the summary row now carries the full `done`/`skipped` id lists. |
| M4 | Single-order finalize/discard routes wrap state change + audit in one transaction — same pattern as void/post. |
| M5 | `commitImport` catches Prisma `P2002` from `createMany` (row created between staging and commit) and returns a 409-able `{ok:false,error}` instead of an unhandled 500. |
| M7 | Dashboard "Audit entries" KPI (and its count query) gated on `audit.view` — restricted STAFF no longer sees a count for a page they're denied. |
| M8 | Refund form renders only when the API can honor it: order not DISCARDED, a posted Stripe charge with an intent exists, and posted Stripe rows still net positive (fully-refunded orders hide the form too). |

Also addressed in passing: M6's missing smoke evidence — `.scratch/PHASE-P6-SMOKE.md` now exists (written by the re-smoke driver).

## Re-smoke summary (S1–S4, all PASS)

- **S1 Ops hub:** manager + restricted STAFF traverse dashboard/orders/detail/audit with correct 200/403 splits; audit KPI hidden from STAFF. Refund race: two concurrent full refunds → exactly one 200 + one 409, exactly one −5000 refund row with a real (idempotency-derived) refund id, audit row present, third attempt 409 "Only 0 cents", refund form gone from the page.
- **S2 POS:** walk-in created via API, cart saved through the shared builder draft endpoint, pickup quote via shared engine, stale-total checkout → 409 with no payment; correct checkout → order #1017 FINALIZED with 1 POSTED CASH payment and both `pos.payment.post` + `pos.checkout` audits; draft completed (re-quote 404).
- **S3 Import:** preview buckets 1 valid / 1 duplicate / 1 invalid; commit blocked (409, invalidLines) while invalid remains; clean file commits atomically (created 1, skipped 1 dup) with `import.commit` audit.
- **S4 Scale:** 1,225 orders / 5,019 packages; order list page 5 renders in ~170 ms; two racing bulk finalizes over the same 4 ids split deterministically (done sets disjoint, union complete), 4/4 per-order audit rows, every order FINALIZED exactly once.

## Not fixed (out of single-pass priority scope)

Majors M9–M16 (display/duplication refactors) and minors m1–m24 remain as listed in the aggregate review.
