# P6 Quality Review — arm-03

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P6 — Admin operations hub & POS
Arm: arm-03
Reviewer scope: quality findings only (no grade, no fix).
Expected ref: `shared/phases/PHASE-P6-EXPECTED.md` · Plan ref: `shared/MERGED-BUILD-PLAN.md` § P6.
Smoke: `arms/arm-03/workspace/.scratch/PHASE-P6-SMOKE.md` — 28/28 pass.

## Scope reviewed

- Dashboard / KPIs / Today queue: `src/app/(admin)/admin/page.tsx`, `admin/today/page.tsx`, `api/admin/dashboard/route.ts`, `lib/ops/orders.ts`.
- Orders list + detail + bulk: `admin/orders/page.tsx`, `admin/orders/[id]/page.tsx`, `components/admin/orders-list.tsx`, `order-detail.tsx`, `api/admin/orders/route.ts`, `orders/bulk/route.ts`, `orders/[id]/route.ts`, `orders/[id]/refund/route.ts`, `orders/[id]/repeat/route.ts`, `lib/ops/repeat.ts`, `lib/ops/refunds.ts`.
- POS: `admin/pos/page.tsx`, `components/admin/pos-page-client.tsx`, `pos-customer-panel.tsx`, `api/admin/pos/attach-customer/route.ts`.
- Customers: `admin/customers/page.tsx`, `customers/[id]/page.tsx`, `components/admin/customers-list.tsx`, `customer-detail.tsx`, `api/admin/customers/route.ts`, `customers/[id]/route.ts`, `lib/ops/customers.ts`.
- Imports: `admin/imports/page.tsx`, `components/admin/imports-client.tsx`, `api/admin/imports/route.ts`, `lib/ops/import.ts`.
- Admin chrome + settings: `components/admin/shell.tsx`, `app/(admin)/layout.tsx`, `api/admin/banner/route.ts`, `api/admin/store-settings/route.ts`, `api/admin/season-gate/route.ts`, `components/admin/settings-hub.tsx`, `lib/ops/settings-keys.ts`, `admin/audit/page.tsx`, `api/audit/route.ts`.

## Findings

### High

1. **Order-detail audit fetch does not scale and can miss the order's own audit rows** — `api/admin/orders/[id]/route.ts:29-45`.
   The endpoint runs `db.auditLog.findMany({ where: { action: { in: ORDER_AUDIT_ACTIONS } }, orderBy: desc, take: 250 })` across *all* orders, then filters `meta.orderId === id` in JS and slices to 40. At the P6 crunch target (1k+ orders, many payment/refund events per season), the 250-row window will be dominated by recent orders and frequently contain zero rows for the order being viewed. The audit section will silently render empty for older orders even when audit rows exist. Fix direction: filter in the DB — either a JSON predicate on `meta.orderId`, or (preferred) promote `orderId` to an indexed column on `AuditLog`. Same pattern risk on the bulk-repeat audit trail (`lib/ops/repeat.ts:195-207`) which writes `meta.created[].sourceOrderId` arrays that consumers must scan.

2. **POS customer attach is a non-atomic two-step (create customer, then attach)** — `components/admin/pos-customer-panel.tsx:62-75`.
   `findOrCreate` POSTs to `/api/admin/customers` (which creates or returns a customer) and then calls `attach` as a second request. If the panel unmounts or the network drops between the two calls, a new customer is created with no draft link, leaving an orphan customer row. There is no compensation. R-060 expects find-or-create + attach as one POS action; the API surface should expose a single attach-or-create endpoint (or the create endpoint should accept an optional `draftRef` and attach atomically).

3. **Import commit does not re-check duplicates under the transaction** — `lib/ops/import.ts:278-330`.
   Classification (`classifyCustomerRows` / `classifyProductRows`) runs at *stage* time. Between stage and commit, another path (POS find-or-create, a second import, manual admin) can create the same customer/product. The commit loop then `tx.customer.create` / `tx.product.create` for every VALID row without re-checking, so the atomic commit will throw inside `db.$transaction` and roll back the *entire* batch — one late-arriving duplicate voids all valid rows in the batch. Either re-check existence inside the tx (and downgrade the colliding row to SKIPPED) or upsert. The audit also stores the *normalized* email in both `email` and `emailNorm` (`import.ts:295-304`), so the original casing the operator typed is lost on commit.

### Medium

4. **Hand-rolled CSV parser drops newlines inside quoted cells** — `lib/ops/import.ts:16-58`.
   The `inQuotes` branch only handles `"` and `""`; `\n`/`\r` inside quotes fall through to the row terminator branch and split the row. Any address or name containing an embedded newline (common in exported spreadsheets) is mis-parsed. The parser also `trim()`s every cell, which silently strips intentional leading/trailing whitespace. Ponytail ladder: a stdlib CSV lib (or `papaparse`, already a common dep) would be safer than a 40-line state machine.

5. **`/api/admin/dashboard` route is dead code** — `api/admin/dashboard/route.ts`.
   No caller in `src/` references the path (grep confirms). The dashboard server component calls `dashboardKpis()` / `todayWorkQueue()` from `lib/ops/orders.ts` directly. The route duplicates the lib call and adds the banner, but nothing fetches it. Either wire the client to it or delete it.

6. **Settings hub writes have no optimistic-concurrency** — `components/admin/settings-hub.tsx:63-99`, `api/admin/store-settings/route.ts:56-86`, `api/admin/banner/route.ts`.
   `setSetting` accepts `expectedVersion` and the PATCH schemas accept `expectedVersion`, but the UI never sends it. Two managers editing delivery ZIPs or the alert banner will silently last-write-wins. The banner is loaded into the admin layout (`app/(admin)/layout.tsx:13`) on every navigation, so a stale banner can also overwrite a concurrent change without warning.

7. **Bulk status UI is hardcoded to one transition** — `components/admin/orders-list.tsx:61-90`.
   `runBulk("status")` always sends `toStatus: "FULFILLING"`. The API (`lib/ops/repeat.ts:216-296`) supports `CANCELLED`, `FULFILLING`, `COMPLETED`, but the UI offers no picker. Operators cannot bulk-cancel or bulk-complete from the list, which limits the "bounded bulk actions with deterministic conflict reporting" goal to a single hardcoded action.

8. **Refund reason is hardcoded** — `components/admin/order-detail.tsx:58-72`.
   The refund form sends `reason: "Admin refund"` for every refund. The audit row (`lib/ops/refunds.ts:82-95`) records that string, so the audit trail cannot distinguish a partial refund, a goodwill refund, or a fraud reversal. R-054 expects a real refund path; a reason input is the minimum audit quality bar.

9. **Auth-error handling is inconsistent across admin pages** — `admin/page.tsx` catches both 401 and 403; `admin/today/page.tsx`, `admin/orders/page.tsx`, `admin/customers/page.tsx`, `admin/imports/page.tsx`, `admin/settings/page.tsx`, `admin/audit/page.tsx` catch only 403 and rethrow 401 to the global error page. `admin/pos/page.tsx` uses a try/catch that swallows *any* error as `Forbidden`. A signed-out staff member hitting `/admin/orders` gets an unhandled 401 instead of the sign-in prompt the dashboard renders. Pick one pattern (the dashboard's) and apply it to every admin page.

10. **`admin/pos/page.tsx` swallows all errors as 403** — `admin/pos/page.tsx:7-13`.
    The `try { await requirePermission("admin.access") } catch { return <Forbidden/> }` catches every error — including a 500 from `isSetupComplete()` or a transient DB outage — and renders it as "Admin access required for POS builder." That hides real outages from operators. Catch only `AuthError` with status 403, rethrow the rest.

### Low

11. **`money` helper duplicated** — `admin/page.tsx:7-10` defines `money(cents)`; `orders-list.tsx:191-194` and `order-detail.tsx:122-134` inline the same `$${(c/100).toFixed(2)}` math. Rule of 2: extract to `lib/format.ts` and reuse.

12. **Customer detail omits available data** — `components/admin/customer-detail.tsx`.
    The API (`lib/ops/customers.ts:50-66`) returns `orders` with `expectedTotalCents` and `_count: { lines, packages }`, but the client type only consumes `id, orderNumber, status, paymentStatusCached, season`. Order history rows show status + payment status with no total and no package count, so the directory detail is less informative than the orders list for the same order.

13. **`listOrders` default includes DRAFTs** — `lib/ops/orders.ts:29-34`.
    The base filter is `status: { not: DISCARDED }`, so the default orders list includes every open draft. Drafts are noise for ops staff scanning the list. Either default to non-draft or add a "hide drafts" toggle.

14. **Audit page has no pagination** — `admin/audit/page.tsx:9-16` loads `take: 50` with no paging, no filter, no search. At crunch scale the audit page shows only the last 50 actions and nothing older. The `/api/audit` route (take 100) is also unused — the page queries the DB directly, so the route is dead.

15. **`todayWorkQueue` OR clause is broader than "today"** — `lib/ops/orders.ts:148-167`.
    The OR branch (`status in [PLACED, PAID]` and `paymentStatusCached in [UNPAID, PARTIAL, PAID]`) pulls in every open non-refunded order regardless of when it was placed. The "Today" queue is effectively "all open orders," which at crunch scale defeats the "Today work queue" intent of R-050. Tighten the OR or rename the page.

16. **Bulk repeat increments the source order's version** — `lib/ops/repeat.ts:171-174`.
    After cloning, the source order's `version` is incremented. This invalidates the `expectedVersion` the operator just used and forces a reload before any further bulk action on the same selection. If the increment is meant as a concurrency guard, document why; otherwise drop it (the clone is a new draft, the source is not mutated).

17. **POS permission is `admin.access`** — `admin/pos/page.tsx:8`, `api/admin/pos/attach-customer/route.ts:18`.
    Any staff with `admin.access` can take cash/check payments and post refunds. The plan separates Manager vs Staff permission toggles; consider a `pos.use` (and `payments.refund`) permission so a restricted Staff can take POS payments without refund access, or vice versa.

18. **`searchCustomersForPos` ignores `emailNorm`/`phoneNorm`** — `lib/ops/customers.ts:122-136`.
    The POS lookup searches raw `displayName`/`email`/`phone` with `contains`, while `findOrCreateCustomer` dedupes on `emailNorm`/`phoneNorm`. A walk-in who typed their phone differently last season will not be found by POS search and will be re-created as a duplicate. Search the normalized fields too.

19. **`admin-gate` redirects to setup before checking auth** — `lib/admin-gate.ts:6-8`.
    `requireAdminPage` calls `isSetupComplete()` first and redirects to `/admin/setup` if not. For a signed-out staff member on a fully-set-up instance this is fine, but the redirect runs on every gated page render even when the DB is up and setup is complete — an extra query per admin navigation. Cache or short-circuit once setup is known complete.

20. **`season-gate` API is not surfaced in the settings hub UI** — `api/admin/season-gate/route.ts`, `components/admin/settings-hub.tsx`.
    The Orders tab copy says "Store status follows the current season Open/Closed gate" but there is no control to flip it. The endpoint exists and is audited, but an operator has no UI path to open/close the season from settings — they must hit the API directly. R-094 expects the settings hub to be wired to live config; the season gate is the most operationally critical config and it is missing from the hub.

## Notes

- Smoke is 28/28 green, but smoke exercises seeded data at small scale; findings #1, #3, #4, #15 are scale/correctness issues that smoke would not catch.
- No findings against: permission gating on imports (`settings.write`), audit writes on banner/settings/refund/import/bulk, bounded bulk caps (25 repeat / 100 status), Stripe refund mock vs live branching, alert banner wiring through the admin layout, visit-store + back-link chrome.
