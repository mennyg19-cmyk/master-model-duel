# P6 Security Review — arm-04 (blind)

**Scope:** P6 delta only (ops hub, POS, imports, refunds, bulk actions, customer directory).
**Method:** static read of `src/app/(admin)/admin/**`, `src/lib/pos/**`, `src/lib/imports/**`, `src/lib/orders/bulk-actions.ts`, `src/lib/orders/repeat-order.ts`, `src/lib/payments/offline-payments.ts`, `src/lib/addresses/address-book.ts`, `src/lib/auth/**`. No fixes written; no scope beyond P6.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 4 |

The money path is well-gated: every payment, void, and refund re-checks `orders.manage` inside the service (`requireMoneyPermission` in `offline-payments.ts:250`), so a route that forgets the gate still cannot move money. POS draft ownership is `(staffUserId, customerId)` via `posOwner` (`pos/counter.ts:32`) and `ownerFilter` excludes the customer's own web session from the till (`orders/draft-access.ts:106`), which closes the "customer finds the counter's cart" hole. Bulk actions are bounded at 100 and report per-order outcomes. CSV import is staged/committed in two transactions with re-lookup inside the commit, and the phone unique index is preserved (`phoneIfFree`, `imports/import-service.ts:253`).

The findings below are real but narrow. None reach card data (none exists on POS by design) or account takeover.

## Major

### M1 — `bulkAction` audit loses per-order actorship for repeat
`src/app/(admin)/admin/orders/actions.ts:174` writes one `orders.bulk_action` row with `entityId: 'batch'`. For `bulkChangeStatus`, `transitionOrder` writes a per-order `order.status_changed` audit, so the trail survives. For `bulkRepeat`, `repeatOrderAtCounter` writes `order.repeated` per call — also fine. **But** the bulk audit's `detail` only carries aggregate counts (`applied/skipped/conflicts`) and the first four `records`. An auditor reconstructing "who moved order #900009" must walk the per-order audit rows, which for `REPEAT` name the staff member on the draft's `posStaffUserId` but for `CANCELLED` bulk name the staff on `order.status_changed`. Two different join paths for the same batch is the kind of gap that hides a bad actor in a busy week. Recommend a single `orders.bulk_action` row per order in the batch, or a `batchId` column on the per-order rows.

### M2 — `returnTo` form field is interpolated into the redirect URL unsanitized
`src/app/(admin)/admin/orders/actions.ts:218` builds `` `/admin/orders?${returnTo}` `` from a raw form field posted by the same form's hidden input (`orders/page.tsx:114`). The value is `new URLSearchParams(query).toString()` on render, so a legitimate post carries `q=...&page=2`. A malicious staff member can replay the action with `returnTo` set to an arbitrary string; the resulting `redirect()` target is always same-origin (`/admin/orders?...`) so it is not an open redirect, but the `notice`/`problem` params are appended with `&` after a user-controlled string with no `encodeURIComponent` on `returnTo` itself. A `returnTo` containing `&` or `#` can forge a flash message or strip the real one. Low impact (staff-only, self-targeted), but it is unvalidated user input reaching a URL. Validate `returnTo` as a query string before using it, or rebuild it from the filters server-side.

### M3 — Import `writeCustomers` overwrites `fullName` on phone-keyed duplicates without audit of the prior value
`src/lib/imports/import-service.ts:222` updates `fullName` unconditionally when a row matched on `normalizedPhone` (a different household's phone). The staging preview (`row-readers.ts:76`) tells the operator "the import will update that one," so it is by design, but the commit does not record the old `fullName` in the audit detail (`import.committed` only carries aggregate counts). A bad import that re-pointed a phone at the wrong row silently rewrites a customer's name with no recoverable prior value in the audit trail. Record the before/after on the per-customer update, or refuse `fullName` overwrite on a phone-only match and require an email match.

## Minor

### m1 — `lookupCustomersForCounter` runs an unbounded `contains` search
`src/lib/customers.ts:160` returns up to 10 rows, but the `OR` over `fullName contains / normalizedEmail contains / normalizedPhone equals` (`customers.ts:121`) runs three substring scans per request. No rate limit on the POS search box. A staff member mashing the box is bounded by `COUNTER_MATCH_LIMIT`, but a scripted client with `orders.manage` could amortize cheap substring scans. Not a P6 blocker (the page is `force-dynamic` and the staff is authenticated), but the same query shape is reused by the customer directory (`listCustomerDirectory`) and the order desk (`orderDeskWhere`) — all three share the unbounded `contains` pattern. Worth a `take` clamp and a min-length gate.

### m2 — `writeCustomers` does N+1 lookups inside the commit transaction
`src/lib/imports/import-service.ts:211` loops up to `CSV_MAX_ROWS` (5,000) rows, each doing 2-3 `findUnique` calls inside `runInTransaction`. That holds a long transaction and row-locks on `Customer` for the duration. Bounded by the 5,000-row cap and the 2MB upload limit, so it is not a DoS blocker, but it is a contention risk on Purim morning if two imports land together. Batch the lookups (`findMany` on the set of normalized emails/phones) before the per-row writes.

### m3 — `readStaffOrderMoney` / `readStaffOrderBoxes` are not scoped by ownership
`src/lib/orders/staff-orders.ts:51` and `:132` take a bare `orderId` with no `ownerFilter`. This is intentional (staff with `orders.view` need to read any order from the desk), and order IDs are CUIDs so enumeration is hard, but it means any staff with `orders.view` can read any order's payments, recipient addresses, and greeting-card messages by ID. That is the feature, not a bug — flagging only because the review brief asked specifically about IDOR on order/customer detail. The customer detail page (`customers/[customerId]/page.tsx:30`) has the same shape. Both are permission-gated and the IDs are unguessable; no fix needed unless the threat model includes a staff member who can read IDs from elsewhere (e.g. shared logs).

### m4 — CSV import does not sanitize formula-leading cell values
`src/lib/imports/csv.ts` parses and `row-readers.ts` stores raw cell values into `Customer.fullName` / `email` / `phone` and `Product.name` / `slug` / `category`. A value beginning with `=`, `+`, `-`, or `@` is stored verbatim. P6 only renders these in HTML (safe) and never re-exports, so there is no CSV-injection sink in this phase. The risk lands in P12 (CSV export center, R-092) where these same rows will be written out. Out of scope to fix here, but worth a `ponytail:` note on the import reader so P12 doesn't inherit a quiet injection sink.

## Out of scope (noted, not scored)

- P5 Stripe webhook idempotency and hosted-checkout amount checks are exercised by P6's refund path but were reviewed under P5.
- `transitionOrder`'s `owner=null` for staff is the intended staff-override path; the `orders.manage` gate is the control.
- The `dashboard.view` shell gate in `admin/layout.tsx:16` correctly 403s a driver who opens `/admin`.
- `findOrCreateCustomerAtCounter`'s race loser reads the winner's row (`customers.ts:226`) — correct P2002 handling.
