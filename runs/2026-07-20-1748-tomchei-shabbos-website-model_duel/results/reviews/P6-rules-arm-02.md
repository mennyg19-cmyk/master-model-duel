# P6 Rules Review — arm-02

Reviewer: Rules specialist. Blind to model name. Scope: P6 (Admin operations hub & POS) additions in `arms/arm-02/workspace/`.
Phase spec: `shared/phases/PHASE-P6-EXPECTED.md`. Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol. Findings only, no fixes.

## Findings

### F1 — Stripe refund issued before the DB row and with no idempotency key (clean-code §Error Handling; ponytail §Never cut: data-loss) — High
`app/api/admin/orders/[id]/refund/route.ts:44-52` calls `gateway.createRefund(...)` and only then `recordRefund(...)`. `lib/payments/stripe.ts:69-75` posts to `/v1/refunds` with no `Idempotency-Key`. The `refundable` check at lines 31-42 is a plain read with no lock. Two concurrent POSTs both pass the check, both call Stripe (distinct refund ids), both record — money leaves twice. A crash between the Stripe call and `recordRefund` orphans a real refund with no DB row. `recordRefund`'s `stripeRefundId` unique key only dedupes *replays of the same refund event*, not two independent staff clicks. Record intent in DB first (or use an idempotency key derived from the order+amount).

### F2 — Refund `alreadyRefunded` is not scoped to the chosen payment intent (clean-code §Inconsistent patterns / correctness) — Medium
`app/api/admin/orders/[id]/refund/route.ts:23-35` picks the latest STRIPE POSTED payment (`stripePayment`, line 23-26) but aggregates ALL STRIPE negative payments on the order for `alreadyRefunded` (line 31-34, `where: { orderId: id, method: "STRIPE", ... }` — no `stripePaymentIntentId` filter). On an order with two Stripe payments, `refundable = latestPayment.amountCents + sum(allRefundsOnOrder)` can be too high (over-refund the latest PI) or too low. The refundable math must be per-payment-intent.

### F3 — POS checkout posts payment outside the audit transaction and finalizes after the money is committed (clean-code §Consistency; §Error Handling) — Medium
`app/api/admin/pos/checkout/route.ts:73-101` calls `postPayment` (its own transaction, line 74), then `writeAudit` for `pos.payment.post` as a separate write (line 80), then `finalizeOrder` in a try/catch (line 90). Two issues: (a) the `pos.payment.post` audit is not atomic with `postPayment` — if the audit throws, the payment is committed and unaudited, unlike the `/api/admin/orders/[id]/payments` route which wraps both in `db.$transaction` (`payments/route.ts:32-51`). (b) If `finalizeOrder` throws (stock conflict), the order stays DRAFT with a real payment attached. The comment acknowledges (b); (a) is an unaudited-money gap.

### F4 — `discard`/`finalize` audit outside the state-change transaction; `void`/`post` audit inside (clean-code §Consistency: one error-handling approach) — Medium
`app/api/admin/orders/[id]/discard/route.ts:16-17` runs `discardOrder(id)` then `writeAudit(...)` as a separate call. `finalize/route.ts:20-26` does the same. `lib/payments/post-payment.ts:73-94` (`voidPayment`) and `app/api/admin/orders/[id]/payments/route.ts:32-51` write the audit row INSIDE the same `db.$transaction` as the mutation. If `writeAudit` throws after a successful `discardOrder`/`finalizeOrder`, the state change is committed but unaudited — exactly the "no audited action without its audit entry" invariant `lib/audit.ts:12-13` claims. Two audit patterns in one phase.

### F5 — Import commit doesn't catch P2002 from `createMany` (clean-code §Error Handling) — Medium
`lib/imports.ts:132-169` runs `tx.customer.createMany` / `tx.product.createMany` inside `db.$transaction`. The stage-time duplicate check (lines 67-82) and the in-transaction phone check (lines 139-146) are reads; a customer/product created by another writer between stage and commit (or between the in-tx `findMany` and `createMany` under READ COMMITTED) trips a unique constraint. Neither `commitImport` nor `app/api/admin/import/route.ts` catches Prisma's `P2002` — it bubbles as an unhandled 500 with no `error` body, where the route's contract is `{ error }`.

### F6 — Missing `.scratch/PHASE-P6-SMOKE.md` and `.scratch/phase-plan.md` (workflow §Expectation Files, §Gate discipline) — Medium
`PHASE-P6-EXPECTED.md` names the evidence path `arms/{id}/workspace/.scratch/PHASE-P6-SMOKE.md`. arm-02 has no `.scratch/` directory at all — no `run-state.md`, no `phase-plan.md`, no smoke evidence. `scripts/seed-scale.ts` and `scripts/concurrency-smoke.ts` exist, but there is no record the S1–S4 checklist was walked with observed evidence. The phase gate is unlogged.

### F7 — Dashboard "Audit entries" KPI shown without `audit.view` (clean-code §UI Consistency / §Consistency) — Medium
`app/(admin)/admin/page.tsx:20-24` counts `db.auditLog.count()` unconditionally and renders it as a KPI (line 191-193). The Audit nav item and the Audit page both require `audit.view` (`layout.tsx:19`, `audit/page.tsx:6`), and STAFF does not receive `audit.view` (`permissions.ts:23`). A restricted STAFF sees the audit-entry count on the dashboard while being denied the audit page — a permission split between the KPI and the surface it summarizes.

### F8 — Refund form renders on DISCARDED orders and orders with no Stripe payment (clean-code §UI Consistency / §Inconsistent patterns) — Medium
`components/admin/order-money-actions.tsx:202` shows the "Refund Stripe payment" form whenever `can.refund`, with no guard on `orderStatus` or on whether a Stripe payment exists. The post-payment form at line 159 guards on `orderStatus !== "DISCARDED"`; the refund form does not. On a DISCARDED order or a cash-only order, the button submits and the API returns 404/409 (`refund/route.ts:27-29`). The two money-action forms use different visibility rules.

### F9 — Customer directory phone search lacks the `looksLikePhone` guard the API uses (clean-code §Inconsistent patterns) — Medium
`app/(admin)/admin/customers/page.tsx:21` runs `normalizePhone(q)` on the raw query and matches `phoneNormalized` when the result is ≥4 digits. `app/api/admin/customers/route.ts:19-20` only treats the query as a phone number when `/^[\d\s\-().+]+$/.test(q)`. A name/email containing digits (e.g. "apt 5") takes a different path on the page vs. the POS customer picker, which calls the API. Two phone-search rules for the same field.

### F10 — `result` standalone variable name (clean-code §Naming) — Low
`app/api/admin/pos/checkout/route.ts:51` `const result = await createOrderFromCart({...})`. `result` is on the banned-as-standalone list; `orderOutcome` (or destructuring `kind`/`orderId`/`totalCents` directly) reads as the thing it is.

### F11 — Defensive `staff?.` after a guaranteed redirect (clean-code §Error Handling) — Low
`app/(admin)/admin/page.tsx:16-17` uses `staff?.actingAs.permissions.has(...)` and `staff?.actingAs.name`, but `layout.tsx:25` already `redirect("/login")` when `!staff`. The optional chaining defends against a condition that cannot happen at this point.

### F12 — `packagesByStage` label only replaces the first underscore (clean-code §Correctness / copy) — Low
`app/(admin)/admin/page.tsx:102` does `row.stage.toLowerCase().replace("_", " ")`. `String.replace` with a string pattern replaces once, so a stage like `OUT_FOR_DELIVERY` renders as `out_for delivery`. Use `replaceAll` or a regex `/_/g`.

### F13 — Bulk failure report leaks the synthetic `id: "request"` key (clean-code §UI Consistency) — Low
`components/admin/order-bulk-actions.tsx:74` on HTTP failure pushes `{ id: "request", reason: ... }` into `skipped`. `labelById.get("request")` is undefined, so the report renders `request: HTTP 400`. An internal sentinel reaches the user instead of a plain "Bulk action failed: HTTP 400" line.

### F14 — Audit page `take: 100` is an inline magic value (clean-code §Magic values) — Low
`app/(admin)/admin/audit/page.tsx:7` uses an inline `take: 100`; the order-detail audit panel uses a named `AUDIT_LIMIT` (`orders/[id]/page.tsx:11`). Same concern, two homes — one named, one literal.

### F15 — POS page and customer-create endpoint disagree on the required permission (clean-code §Consistency) — Low
`app/(admin)/admin/pos/page.tsx:8` requires `orders.manage`; the POS `CustomerPicker.create` POSTs to `/api/admin/customers` which requires `customers.manage` (`customers/route.ts:48`). Default STAFF has both, but a user granted `orders.manage` without `customers.manage` (a per-user override) can open POS yet has the walk-in create silently 403 with no UI hint. The POS page should either also require `customers.manage` or the create path should accept `orders.manage` in the POS context.

## Count

15 findings — High 1 (F1), Medium 8 (F2–F9), Low 6 (F10–F15).
Hot spots: refund money-path (F1, F2), audit atomicity pattern split (F3, F4), import race handling (F5), permission/UX consistency (F7, F8, F9, F15). F1 is the money-loss axis; F3/F4 are the audit-integrity axis. No findings against ponytail §God files, §Duplicated logic, or §Magic values at the level arm-01 hit — `normalizePhone` is single-sourced in `lib/customers.ts`, list/bulk caps are named constants, and admin heading weight is consistent (`text-2xl font-semibold`) across all P6 pages.
