# P6 Aggregate Review — arm-04 (blind)

**Inputs:** P6-security, P6-quality, P6-rules, P6-clean-code specialist files.
**Method:** union + dedupe by (location, claim). Security blockers preserved. No new findings.

## Counts after dedupe

- Blockers: 0
- Majors: 9
- Minors: 18

## Prioritized fix list (builder-readable)

### Majors (fix before gate)

1. **Bulk audit per-order actorship gap** — `src/app/(admin)/admin/orders/actions.ts:174` (bulk_action row). REPEAT names staff via `posStaffUserId`; CANCELLED names staff via `order.status_changed`. Two join paths for one batch hide a bad actor. Emit one `orders.bulk_action` row per order, or add `batchId` to per-order rows. (sec-M1)
2. **`returnTo` form field interpolated unsanitized into redirect URL** — `src/app/(admin)/admin/orders/actions.ts:218`. Staff-controlled `returnTo` reaches `redirect()` with no `encodeURIComponent`; `&`/`#` can forge or strip flash messages. Validate as a query string or rebuild server-side. (sec-M2)
3. **Import `writeCustomers` overwrites `fullName` on phone-keyed duplicates without audit of prior value** — `src/lib/imports/import-service.ts:222`. A bad import re-pointing a phone silently rewrites a customer's name with no recoverable prior value. Record before/after, or refuse `fullName` overwrite on phone-only match. (sec-M3)
4. **Dashboard `customers` KPI is dead code and breaks the file's own scoping promise** — `src/lib/admin/dashboard.ts:51` (`db.customer.count()`) and `:22` (`customers: number`). No caller reads `kpis.customers`; the module header promises season-scoped figures, the dead query is unscoped. Drop the field and query, or wire it season-scoped. (rules-M1)
5. **Closed-season repeat is reported as "that is not something this list can do"** — `src/app/(admin)/admin/orders/actions.ts:198-201,172`. `runBulk` returns `null` for both unknown action and closed season; the error path lies about the cause. Surface the season message or split the null return. (cc-M1)
6. **Payment-status → Badge tone pattern drifts across three screens** — `src/app/(admin)/admin/orders/page.tsx:207-212` (4 tones), `src/app/(admin)/admin/orders/[orderId]/page.tsx:69` (2 tones), `src/app/(admin)/admin/today/order-queue.tsx:48` (2 tones). Extract `paymentStatusTone(status)` into `lib/orders`. (cc-M2)
7. **snake_case → human label duplicated three times with three outputs** — `src/app/(admin)/admin/orders/page.tsx:215-218` (title-cased), `src/app/(admin)/admin/today/order-queue.tsx:49` (lowercased), `src/app/(admin)/admin/orders/[orderId]/page.tsx:70,161` (raw enum). Extract `humanizeStatus(status)`. (cc-M3)
8. **Redirect-with-flash helper forked three ways** — `src/app/(admin)/admin/orders/actions.ts:218-237`, `src/app/(admin)/admin/pos/actions.ts:250-260`, `src/app/(admin)/admin/imports/actions.ts:70-72`. Extract `redirectWithFlash(path, { notice?, problem? })`. (cc-M4)
9. **`pageQuery` duplicates `pageHref` minus the base path** — `src/app/(admin)/admin/orders/page.tsx:201-205`, `src/lib/admin/list-query.ts:49-56`. Extract shared `pageQueryString(query, page)`; both delegate. (cc-M5)

### Minors (priority order)

10. **Dashboard "Latest security events" bypasses `audit.view`** — `src/app/(admin)/admin/page.tsx:148-168`. `dashboard.view` staff see 5 audit rows on `/admin` while `/admin/audit` 403s. Gate the panel behind `audit.view` or fold the permission. (q-m1)
11. **Bulk audit row drops `droppedCount`** — `src/app/(admin)/admin/orders/actions.ts:174-184`. Orders past the 100-row cap leave no audit trace; only the redirect notice carries the drop. Add `droppedCount` to audit detail. (q-m3)
12. **Bulk-action summary audit recorded outside any transaction** — `src/app/(admin)/admin/orders/actions.ts:174-184`. If `recordAudit` fails, per-order audits exist but batch summary is missing. Wrap summary write in a transaction, matching `commitImport`. (rules-m3)
13. **Bulk cancel money check read outside the transition transaction (TOCTOU)** — `src/lib/orders/bulk-actions.ts:65,75`. `amountPaidCents` read at batch-read time, not re-checked inside `transitionOrder`. Re-check money inside the per-order transition. (q-m2 / rules-m6)
14. **`writeCustomers` / `writeProducts` do per-row round trips inside the commit transaction (N+1)** — `src/lib/imports/import-service.ts:211-248,270-288`. Up to 5,000 rows × 2-3 `findUnique` calls hold locks for the whole commit. Batch lookups via `findMany` on the email/phone set first. (sec-m2 / rules-m5)
15. **`sellAtCounter` is non-atomic; a throw from `postOfflinePayment` leaves no audit** — `src/lib/pos/counter.ts:85-94`. Order is placed and unpaid with no `Payment` row and no audit of the cash attempt. Record the attempt before throwing. (rules-m2)
16. **`repeatOrderAtCounter` open-cart check is outside the transaction** — `src/lib/orders/repeat-order.ts:58-66,88`. Double-click can pass the check twice and create two carts. Move the `findFirst` inside `$transaction`. (rules-m4)
17. **`lookupCustomersForCounter` runs unbounded `contains` search** — `src/lib/customers.ts:160,121`. Three substring scans per request, no rate limit, same shape reused by `listCustomerDirectory` and `orderDeskWhere`. Add a `take` clamp and min-length gate. (sec-m1)
18. **`readStaffOrderMoney` / `readStaffOrderBoxes` not scoped by ownership** — `src/lib/orders/staff-orders.ts:51,132`. Any staff with `orders.view` reads any order by CUID. Permission-gated and IDs unguessable; flagged per IDOR brief. No fix required unless threat model includes shared logs. (sec-m3)
19. **CSV import does not sanitize formula-leading cell values** — `src/lib/imports/csv.ts`, `row-readers.ts`. Values starting with `= + - @` stored verbatim. No sink in P6; lands in P12 export. Leave a `ponytail:` note on the reader. (sec-m4)
20. **Active-season lookup duplicated inline** — `src/app/(admin)/admin/page.tsx:27`, `src/app/(admin)/admin/today/page.tsx:21`. Extract `readActiveSeason()`; POS variant stays separate. (cc-m1)
21. **`phoneIfFree` returns a partial spread under a boolean-sounding name** — `src/lib/imports/import-service.ts:253-260`. Rename to `claimablePhoneFields` / `phoneFieldsIfFree`. (cc-m2)
22. **Product price round-trips through string** — `src/lib/imports/row-readers.ts:120`, `src/lib/imports/import-service.ts:274`. `String(parsed.data.price)` then `Number(row.parsed.pricecents)`. Store the number directly. (cc-m3)
23. **`input.seasonId!` non-null assertion repeated** — `src/lib/imports/import-service.ts:65,148`. Bind a local `const seasonId = input.seasonId` after the guard. (cc-m4)
24. **`labelOf` and `shortId` are two label helpers for the same record shape** — `src/lib/orders/bulk-actions.ts:178-186`. Rename to `labelOfOrder` / `labelOfMissing` to pair them. (cc-m5)
25. **Admin route-path constants follow three conventions** — `src/app/(admin)/admin/orders/page.tsx:24`, `src/lib/pos/paths.ts:6`, `src/app/(admin)/admin/imports/actions.ts:15`. Soft drift; not worth a paths module per feature. (cc-m6)
26. **`HEADERS` display map drifts from the CSV contract the reader enforces** — `src/app/(admin)/admin/imports/page.tsx:18-21`, `src/lib/imports/row-readers.ts:39-43,108-113`. Derive `HEADERS` from the reader's accepted-key list or document fallbacks in the hint. (cc-m7)
27. **`pos/page.tsx` open-tills narrowing is defensive code for a DB-enforced invariant** — `src/app/(admin)/admin/pos/page.tsx:48-58`. `flatMap` narrows the null branch the CHECK constraint makes unreachable. Acceptable; comment is the only signal the branch is dead. (cc-m8)

## Dedupe map

- `orders/actions.ts:174` (bulk_action row): three distinct claims survive — per-order actorship (sec-M1, Major), droppedCount missing (q-m3, Minor), summary outside transaction (rules-m3, Minor).
- `orders/actions.ts:218` `returnTo`: sec-M2 (validation, Major) and cc-M4 (helper fork, Major) are distinct claims; both survive.
- `bulk-actions.ts:65,75` TOCTOU: q-m2 and rules-m6 same claim → merged (Minor).
- `import-service.ts:211` N+1: sec-m2 and rules-m5 same claim → merged (Minor).
