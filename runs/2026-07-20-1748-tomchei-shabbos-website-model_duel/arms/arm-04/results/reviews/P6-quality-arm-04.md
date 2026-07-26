# P6 quality review — arm-04 (blind)

Reviewer: external quality specialist. Scope: P6 delta + regressions vs `shared/phases/PHASE-P6-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P6. Findings only — no fixes, no new scope.

## Verdict

All 6 EXPECTED items delivered; 23/23 smoke checks pass; 13 P6 unit tests green; `npm run ci` exits 0. No stubs found in the P6 surface. No regressions in P1–P5 paths exercised by the smoke. Three minor findings below.

## Findings

### Minor 1 — Dashboard "Latest security events" bypasses `audit.view`
`src/app/(admin)/admin/page.tsx:148-168` (`RecentSecurityEvents`) reads `db.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })` and renders the latest 5 events on every dashboard render. The dashboard route is gated by `dashboard.view` only; the dedicated log at `src/app/(admin)/admin/audit/page.tsx:11` requires `audit.view`. The STAFF role default (`src/lib/auth/permissions.ts:31`) grants `dashboard.view` but not `audit.view`, so a restricted staff member who is refused `/admin/audit` (smoke S1f confirms 403) still sees 5 audit rows on `/admin`. Either gate the panel behind `audit.view` (and drop it for staff without it) or fold the permission into `dashboard.view` deliberately. Inconsistent with the permission model the rest of P6 enforces.

### Minor 2 — Bulk cancel money check is read outside the transition transaction
`src/lib/orders/bulk-actions.ts:64-92` reads every order up front (`readOrders(ids)`, line 65), then for each order checks `order.amountPaidCents > 0` (line 75) before calling `transitionOrder` (line 85). `transitionOrder` (`src/lib/orders/order-service.ts:127-166`) re-reads and locks status inside its own transaction but does not re-check money. If an order is unpaid at batch-read time and a card payment lands before the per-order transition, the bulk path cancels a now-paid order without forcing the refund the single-order `changeOrderStatusAction` requires (`src/app/(admin)/admin/orders/actions.ts:113-121`). The single-action path has the same TOCTOU shape, but the bulk path amplifies it across 100 rows. Narrow race; refund can still be issued after cancel, but the guard's intent is subverted.

### Minor 3 — Bulk audit row drops `droppedCount`
`src/app/(admin)/admin/orders/actions.ts:174-184` writes `orders.bulk_action` with `{ action, applied, skipped, conflicts }`. `BulkReport.droppedCount` (`src/lib/orders/bulk-actions.ts:42-43`) — orders past the 100-row cap that were never attempted — is reported on the redirect notice (`summarizeBulk`, line 193) but not in the audit detail. A batch that silently dropped 50 rows leaves no audit trace of the drop; only the URL notice carries it. The audit is the durable record; the notice is not.

## Non-findings (verified correct)

- POS checkout has no card field anywhere; `sellAtCounter` only accepts `CASH`/`CHECK` (`src/lib/pos/counter.ts:60-65`, `src/app/(admin)/admin/pos/[customerId]/checkout/page.tsx:121-124`). Matches UR-011/G-028.
- Stripe refund path is implemented, not stubbed: `refundThroughGateway` calls `getPaymentGateway().refund` with a per-call idempotency key (`src/lib/payments/offline-payments.ts:230-248`). Satisfies R-054 "Stripe path".
- Import is two transactions; commit re-reads verdicts and re-looks-up matched records inside `runInTransaction`; double-press on a settled batch aborts via `updateMany ... where status='STAGED'` claim (`src/lib/imports/import-service.ts:144-176`). Matches R-063/R-143.
- List paging is bounded in one place: `readPageRequest` clamps page size to `MAX_PAGE_SIZE=100` and page to `MAX_PAGE=10_000` (`src/lib/admin/list-query.ts:16-21`). Every admin list (`orders`, `customers`, `imports`) routes through it.
- Bulk report is deterministic: records sorted by `label` (order number), so the same batch in a different order reads the same way (`src/lib/orders/bulk-actions.ts:158-172`). Smoke S4c confirms "0 updated, 6 conflicted" replay.
- `Order.posStaffUserId` CHECK constraint `Order_pos_has_customer` enforces a till always has a customer (`prisma/migrations/20260726230000_p6_ops_hub_pos_imports/migration.sql:80-81`). Customer's own draft filter excludes POS carts (`src/lib/orders/draft-access.ts:106-112`), so the customer web session cannot see the counter's cart (smoke S2c).
- Customer directory counts only real orders (`status: { notIn: ['DRAFT','DISCARDED'] }`) and non-archived addresses (`src/lib/customers.ts:140-148`).
- Repeat copies to a draft (no order number), prices at this season, names skipped products, refuses a second till for the same customer (`src/lib/orders/repeat-order.ts:56-66, 74-86`). Matches R-057 shell; P10 replacement flow correctly absent.
- No P7+ scope leaked: no package board, print batches, routes, Shippo live rates, or repeat replacement UI in the P6 delta.

## Counts

- Blocker: 0
- Major: 0
- Minor: 3
