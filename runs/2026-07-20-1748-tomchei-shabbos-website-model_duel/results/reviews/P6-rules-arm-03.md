# P6 Rules Review — arm-03

Reviewer: Rules specialist. Blind to model name. Scope: P6 (Admin operations hub & POS) additions in `arms/arm-03/workspace/`.
Phase spec: `shared/phases/PHASE-P6-EXPECTED.md`. Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol. Findings only, no fixes.

Scope reviewed: `app/(admin)/admin/{page,layout,today,orders,orders/[id],customers,customers/[id],pos,imports,audit}`,
`app/api/admin/{dashboard,orders,orders/[id]/refund,orders/[id]/repeat,orders/bulk,customers,customers/[id],pos/attach-customer,imports,banner}`,
`lib/ops/{orders,customers,refunds,import,repeat,settings-keys}`, `lib/{permissions,audit,result,phone,admin-gate}`,
`components/admin/{shell,orders-list,order-detail,customers-list,customer-detail,imports-client,pos-customer-panel,pos-page-client,settings-hub}`,
`app/api/checkout/offline/route.ts`. Smoke evidence present at `.scratch/PHASE-P6-SMOKE.md` (28/28 passed) — gate is logged, unlike arm-01/arm-02.

## Findings

### F1 — Stripe refund issued before the DB transaction and with no idempotency key (clean-code §Error Handling; ponytail §Never cut: data-loss) — High
`lib/ops/refunds.ts:60-72` calls `stripe.refunds.create` (no `Idempotency-Key`) outside `db.$transaction` (opened at line 76). The `refundable` check at lines 37-43 is a plain read with no lock. Two concurrent POSTs both pass the check, both call Stripe (distinct refund ids), both record — money leaves twice. A crash between the Stripe call and the commit orphans a real refund with no DB row. `recordRefund`'s unique `stripeRefundId` only dedupes replays of the same refund event, not two independent staff clicks. Record intent in DB first, or derive an idempotency key from `paymentId + refundedCentsBaseline + amount`.

### F2 — Refund route verifies payment↔order match AFTER the refund is committed (clean-code §Error Handling; correctness) — High
`app/api/admin/orders/[id]/refund/route.ts:20-31` calls `refundPayment` (which calls Stripe and commits the DB tx) and only then checks `result.value.payment.orderId !== orderId` and returns 400. A staff caller posting a `paymentId` belonging to a different order triggers a real refund before the route rejects it. `refundPayment` takes no `orderId`, so it cannot guard internally. Cross-order refund path; the ownership check must run before the side effect.

### F3 — Audit write outside the mutation transaction for import commit and bulk actions (clean-code §Consistency: one error-handling approach) — Medium
`lib/ops/import.ts:349-353` writes `IMPORT_COMMITTED` after `db.$transaction` returns. `lib/ops/repeat.ts:195-207` (`bulkRepeatOrders`) and `:280-290` (`bulkUpdateOrderStatus`) write `BULK_ACTION_APPLIED` after the per-item transactions. `lib/ops/customers.ts:114-118` (`findOrCreateCustomer`) and `lib/ops/import.ts:229-233` (`stageImport`) audit outside any tx. Yet `lib/ops/refunds.ts:82-95` writes the audit INSIDE the tx. Two audit-atomicity contracts in one phase; a crash after commit and before the audit write leaves a committed mutation with no audit row — the invariant `lib/audit.ts` exists to guarantee.

### F4 — Order-detail audit fetch over-fetches and filters in JS (clean-code §Anti-AI-Tics / ponytail §Code rules: shrink; correctness) — Medium
`app/api/admin/orders/[id]/route.ts:29-45` loads the last 250 audit rows across ALL orders (`where: { action: { in: ORDER_AUDIT_ACTIONS } }`, no `orderId` filter), then `.filter` in JS by `meta.orderId === id`, then `.slice(0, 40)`. At 1k+ orders with many audits, 250 recent rows may not contain this order's audits at all, and every detail load scans 250 rows in JS. The audit `meta` already carries `orderId`; filter in the DB (or promote `orderId` to an indexed column).

### F5 — Import commit doesn't catch P2002 and surfaces a generic message (clean-code §Error Handling) — Medium
`lib/ops/import.ts:297` (`tx.customer.create`) and `:310` (`tx.product.create`) rely on stage-time duplicate reads; a row created between stage and commit trips a unique constraint. `commitImport`'s outer catch only does `err(maskError(error), "Could not commit import.")` — no P2002 branch, and `maskError` (`lib/result.ts:17-18`) returns a generic "Something went wrong" in production. The whole batch rolls back (atomic, per spec) but the user gets no signal that a row collided.

### F6 — Customer phone search uses raw `phone` while dedup uses `phoneNorm` (clean-code §Inconsistent patterns) — Medium
`lib/ops/customers.ts:24` (`listCustomers`) and `:130` (`searchCustomersForPos`) match `phone: { contains: q }` on the raw phone string. `findOrCreateCustomer` (:76, :99) and `lib/ops/import.ts:95` dedup on `normalizePhone` → a bare 11-digit `phoneNorm`. A customer stored as "+1 (555) 111-2222" is not found by searching "5551112222". Two phone-match rules for the same field; search and dedup disagree.

### F7 — N+1 duplicate checks per CSV row at stage time (clean-code §Anti-AI-Tics / ponytail §Code rules; scale) — Medium
`lib/ops/import.ts:109-113` (customers) and `:169-171` (products) run an `await db.customer.findFirst` / `db.product.findFirst` inside the per-row loop. A 2000-row CSV fires ~2000 sequential queries at stage time. Batch the lookups (collect emails/skus, one `findMany` with `in`), or defer the existence check to commit and rely on the unique constraint.

### F8 — Bulk-repeat version re-check is not a row lock (clean-code §Error Handling; ponytail §Never cut: data-loss) — Medium
`lib/ops/repeat.ts:157-159` re-checks `locked.version` inside `db.$transaction` via `findUniqueOrThrow` (no `SELECT … FOR UPDATE`). Under READ COMMITTED, two concurrent bulk-repeats of the same order both read `version=N`, both pass, both create a draft, both increment. Two duplicate repeats, no conflict reported — the spec's "deterministic conflict reporting at crunch scale" (S4) fails for concurrent same-order repeats. Note `bulkUpdateOrderStatus` (:244-266) has the same shape.

### F9 — POS page uses a different page-gate pattern from the rest of admin (clean-code §UI Consistency / §Inconsistent patterns) — Low
`app/(admin)/admin/pos/page.tsx:7-11` uses `await requirePermission(...)` in a bare `catch { return <Forbidden/> }`. Every other P6 admin page uses `requireAdminPage` + `instanceof AuthError && error.status === 403 → <Forbidden/>` + `throw error` (orders/page, customers/page, imports/page, today/page, audit/page, admin/page). The POS page also skips the `isSetupComplete()` redirect that `requireAdminPage` performs (`lib/admin-gate.ts:6-8`). Two page-gate patterns in one phase.

### F10 — Bulk caps duplicated between route schema and lib (clean-code §Magic values) — Low
`app/api/admin/orders/bulk/route.ts:16,21` hardcodes `.max(25)` and `.max(100)` in the zod schema; `lib/ops/repeat.ts:106` (`MAX_BULK_REPEAT = 25`) and `:235` (inline `100`) re-declare the same caps. Two homes per cap; changing one without the other drifts.

### F11 — Audit page renders raw ISO timestamp (clean-code §UI Consistency) — Low
`app/(admin)/admin/audit/page.tsx:25` renders `entry.createdAt.toISOString()`. The order-detail audit panel (`components/admin/order-detail.tsx:175`) uses `new Date(a.createdAt).toLocaleString()`. Two timestamp formats for the same audit surface; the audit page is the one most likely to be screenshotted.

### F12 — `maskError` collapses structured error codes to a generic string (clean-code §Error Handling) — Low
`lib/result.ts:16-22` returns the raw `error.message` in dev and a generic string in prod. Every `Result`-returning lib function (`refundPayment`, `commitImport`, `bulkRepeatOrders`, `bulkUpdateOrderStatus`, `findOrCreateCustomer`) carries a structured `error` code ("amount", "state", "season", "P2002"), but routes map every `!result.ok` to 409 with `publicMessage`. Validation failures (bad amount) and state conflicts (not posted) share one status and one message; the structured code is lost before it reaches the client.

### F13 — `assertOfflinePaymentStaffOnly` redundant catch branches (clean-code §Anti-AI-Tics) — Low
`app/api/checkout/offline/route.ts:132-135`: `catch (error) { if (error instanceof AuthError) return apiErrorResponse(error); return apiErrorResponse(error); }` — both branches return the same thing. Dead conditional; collapse to one `return apiErrorResponse(error)`.

### F14 — Refund form offers refund on every payment regardless of method (clean-code §UI Consistency) — Low
`components/admin/order-detail.tsx:148-152` lists every payment in the refund dropdown; `lib/ops/refunds.ts:47` only handles STRIPE (cash/check refunds are DB-only `refundedCents` adjustments with no money movement). The UI offers a "Refund" on a cash payment that the API treats as a no-op money move. The spec calls out a "Stripe refund path"; the UI doesn't distinguish it from cash/check.

### F15 — Hand-rolled CSV parser with no recorded dep decision (ponytail §Dependency Discipline / clean-code §Anti-AI-Tics) — Low
`lib/ops/import.ts:16-58` implements a 40-line CSV parser (quote-doubling, CR/LF). It handles neither multiline quoted fields nor escapes beyond the doubling rule, and it silently drops rows where no cell has content (`row.some((c) => c.length)`). Ponytail's ladder says prefer stdlib/existing deps; a vetted CSV parser is the standard answer for 2MB imports. Acceptable if the dep was deliberately rejected, but the choice isn't recorded in DECISION-LOG or a comment.

## Count

15 findings — High 2 (F1, F2), Medium 6 (F3–F8), Low 7 (F9–F15).
Hot spots: refund money-path (F1, F2, F14), audit atomicity pattern split (F3, F4), import race/scale (F5, F7), phone-match inconsistency (F6), bulk concurrency (F8). F1 and F2 are the money-loss/correctness axis; F3 is the audit-integrity axis. Positives vs arm-01/arm-02: `writeAudit` is a single shared helper (no 9-site boilerplate), nav gating is consistent (every NAV item carries a permission and is filtered — no half-gated nav), and the smoke gate is logged with evidence.
