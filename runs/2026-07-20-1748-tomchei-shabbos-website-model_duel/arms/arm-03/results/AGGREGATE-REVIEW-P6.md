# Aggregate Review — P6 — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-03
**Phase:** P6 (Admin operations hub & POS: dashboard, orders list/detail/refund/repeat/bulk, customers, POS, staged CSV import, settings hub, audit)
**Inputs:** P6-security, P6-quality, P6-rules, P6-clean-code (arm-03)
**Method:** Union + dedupe by location+claim. Security/correctness Highs survive as blockers. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker | 8 |
| Major | 15 |
| Minor | 21 |
| **Total** | **44** |

Source totals (pre-dedupe): security 12, quality 20, rules 15, clean-code 13 = 60. 16 clusters merged; net 44 unique.

## Blockers (8)

### B1 — Refund route validates `paymentId ↔ orderId` AFTER the refund is committed
**Sources:** security H1, rules F2
**Location:** `app/api/admin/orders/[id]/refund/route.ts:20-31`, `lib/ops/refunds.ts:14-101`
**Claim:** `refundPayment` runs the full Stripe + DB money path, then the route checks `result.value.payment.orderId !== orderId` and returns 400. A staff caller can POST another order's `paymentId` to `/api/admin/orders/{anyOrderId}/refund`; the refund commits, the route returns 400 "Payment does not belong to this order," and the caller is misled into believing nothing happened. The ownership check must run before any Stripe or DB write.

### B2 — Stripe refund created outside the DB transaction with no idempotency key and no compensation
**Sources:** security H2, rules F1
**Location:** `lib/ops/refunds.ts:60-99`
**Claim:** `stripe.refunds.create` (no `Idempotency-Key`) runs before `db.$transaction`. Two concurrent POSTs both pass the unlocked `refundable` check and create distinct Stripe refunds — money leaves twice. A crash or tx failure between the Stripe call and the commit orphans a real refund with no DB row, no audit, and no `recalcOrderPaymentStatus` — ledger says PAID while the customer was refunded. Persist refund intent in DB first, or derive an idempotency key from `paymentId + baseline + amount`, and add a compensation/reconciliation path.

### B3 — Order-detail audit fetch over-fetches 250 rows across ALL orders, then JS-filters
**Sources:** quality 1, rules F4, clean-code M2
**Location:** `app/api/admin/orders/[id]/route.ts:29-45`, `app/(admin)/admin/audit/page.tsx:9-16`
**Claim:** `db.auditLog.findMany({ where: { action: { in: ORDER_AUDIT_ACTIONS } }, take: 250 })` has no `orderId` filter; the route then `.filter(meta.orderId === id)` in JS and slices to 40. At 1k+ orders the 250-row window is dominated by recent orders and frequently contains zero rows for the order being viewed — the audit section silently renders empty for older orders. The audit page uses a separate query shape (`take: 50`, different `include`). Promote `orderId` to an indexed column (or a JSON predicate) and route both consumers through one `listAudit({ orderId?, limit })` helper.

### B4 — POS customer attach is a non-atomic two-step (create, then attach)
**Sources:** quality 2
**Location:** `components/admin/pos-customer-panel.tsx:62-75`, `app/api/admin/pos/attach-customer/route.ts`
**Claim:** `findOrCreate` POSTs to `/api/admin/customers`, then `attach` is a second request. If the panel unmounts or the network drops between the two calls, a new customer is created with no draft link — an orphan customer row with no compensation. R-060 expects find-or-create + attach as one POS action; expose a single attach-or-create endpoint (or accept an optional `draftRef` on the create endpoint and attach atomically).

### B5 — Import commit does not re-check duplicates under the transaction
**Sources:** quality 3, rules F5
**Location:** `lib/ops/import.ts:278-330, 297, 310`
**Claim:** Classification runs at stage time. Between stage and commit, another path (POS find-or-create, a second import, manual admin) can create the same customer/product. The commit loop `tx.customer.create` / `tx.product.create` for every VALID row without re-checking, so a late-arriving duplicate throws inside `db.$transaction` and rolls back the entire batch — one colliding row voids all valid rows. The outer catch only does `err(maskError(error), "Could not commit import.")` with no P2002 branch, so the user gets a generic "Something went wrong." Re-check inside the tx (downgrade colliding rows to SKIPPED) or upsert. Commit also stores normalized email in both `email` and `emailNorm`, losing the operator's original casing.

### B6 — `bulkUpdateOrderStatus` bypasses the order state machine
**Sources:** security M1
**Location:** `lib/ops/repeat.ts:216-296`, `lib/orders/state-machine.ts:3-18`
**Claim:** The bulk path skips DRAFT/DISCARDED and checks `version`, then writes `status: input.toStatus` directly — it never calls `assertOrderTransition`. The state machine allows `PLACED → {PAID, CANCELLED}` and `PAID → {FULFILLING, CANCELLED, COMPLETED}`; the bulk path accepts `FULFILLING | COMPLETED | CANCELLED` from any non-draft status, so a PLACED (unpaid) order can be marked COMPLETED or FULFILLING. A staff member with `admin.access` can close out unpaid orders in bulk, defeating the payment-gated transition single-order flows enforce. Apply `assertOrderTransition` per item and report illegal transitions as conflicts/skips.

### B7 — Bulk-repeat version re-check is not a row lock; concurrent same-order repeats create duplicates
**Sources:** rules F8
**Location:** `lib/ops/repeat.ts:157-159, 244-266`
**Claim:** The re-check uses `findUniqueOrThrow` (no `SELECT … FOR UPDATE`) inside `db.$transaction`. Under READ COMMITTED, two concurrent bulk-repeats of the same order both read `version=N`, both pass, both create a draft, both increment. Two duplicate repeats, no conflict reported — the spec's "deterministic conflict reporting at crunch scale" (S4) fails for concurrent same-order repeats. `bulkUpdateOrderStatus` has the same shape. Use a row lock or a conditional update guarded by `version`.

### B8 — Audit write outside the mutation transaction for import commit and bulk actions
**Sources:** rules F3
**Location:** `lib/ops/import.ts:349-353`, `lib/ops/repeat.ts:195-207, 280-290`, `lib/ops/customers.ts:114-118`, `lib/ops/import.ts:229-233`, vs `lib/ops/refunds.ts:82-95`
**Claim:** `IMPORT_COMMITTED`, `BULK_ACTION_APPLIED`, `findOrCreateCustomer`, and `stageImport` write their audit rows after the per-item transactions (or outside any tx), while `refundPayment` writes audit INSIDE the tx. Two audit-atomicity contracts in one phase. A crash after commit and before the audit write leaves a committed mutation with no audit row — the invariant `lib/audit.ts` exists to guarantee. Pick one contract (audit inside the mutation tx) and apply it everywhere.

## Majors (15)

### M1 — CSV import has no row cap and does N+1 DB lookups per row
**Sources:** security M2, rules F7
**Location:** `app/api/admin/imports/route.ts:10`, `lib/ops/import.ts:86-128, 109-113, 142-187, 169-171`
**Claim:** `stageImport` accepts up to 2 MB CSV with no row limit. `classifyCustomerRows`/`classifyProductRows` issue one `db.customer.findFirst`/`db.product.findFirst` per row in a sequential loop — no `findMany` batch. A 2 MB CSV can be tens of thousands of rows, each issuing a sequential query in a single request, pinning a server worker and saturating the connection pool. One compromised `settings.write` account can DoS the admin plane and starve checkout. Cap rows (e.g. 5k) and batch existence checks with one `findMany({ where: { OR: [...] } })`.

### M2 — `store-settings` PATCH accepts arbitrary JSON for most keys
**Sources:** security M3
**Location:** `app/api/admin/store-settings/route.ts:56-86`
**Claim:** Only `deliveryZips` is schema-validated. `shippingRates`, `shippingRules`, `emailFrom`, `emailReplyTo`, `developerNotes`, `storeStatus` are stored as `z.unknown()` with no per-key shape enforcement. `shippingRules`/`shippingRates` feed the shipping engine; arbitrary shapes can break checkout pricing or inject unexpected rules. `emailFrom`/`emailReplyTo` as arbitrary JSON can later break transactional email or redirect replies. The client `SettingsHub` already sends structured values — the API should reject anything else with per-key zod schemas.

### M3 — Customer phone/email search uses raw fields while dedup uses normalized fields
**Sources:** rules F6, quality 18
**Location:** `lib/ops/customers.ts:24, 76, 99, 122-136, 130`; `lib/ops/import.ts:95`
**Claim:** `listCustomers` and `searchCustomersForPos` match `phone: { contains: q }` / `email: { contains: q }` on raw strings. `findOrCreateCustomer` and import dedup on `normalizePhone` → `phoneNorm` / `emailNorm`. A customer stored as "+1 (555) 111-2222" is not found by searching "5551112222"; a walk-in who typed their phone differently last season is not found by POS search and is re-created as a duplicate. Search the normalized fields too.

### M4 — Hand-rolled CSV parser drops newlines inside quoted cells, no recorded dep decision
**Sources:** quality 4, rules F15
**Location:** `lib/ops/import.ts:16-58`
**Claim:** The 40-line state machine only handles `"` and `""`; `\n`/`\r` inside quotes fall through to the row terminator and split the row. Any address or name with an embedded newline (common in exported spreadsheets) is mis-parsed. It also `trim()`s every cell, silently stripping intentional whitespace, and drops rows where no cell has content. Ponytail's ladder says prefer stdlib/existing deps; a vetted CSV parser (e.g. papaparse) is the standard answer for 2 MB imports. Acceptable if deliberately rejected, but the choice isn't recorded in DECISION-LOG or a comment.

### M5 — `/api/admin/dashboard` route is dead code
**Sources:** quality 5
**Location:** `app/api/admin/dashboard/route.ts`
**Claim:** No caller in `src/` references the path. The dashboard server component calls `dashboardKpis()` / `todayWorkQueue()` from `lib/ops/orders.ts` directly. The route duplicates the lib call and adds the banner, but nothing fetches it. Either wire the client to it or delete it.

### M6 — Settings hub writes have no optimistic-concurrency; last-write-wins
**Sources:** quality 6
**Location:** `components/admin/settings-hub.tsx:63-99`, `app/api/admin/store-settings/route.ts:56-86`, `app/api/admin/banner/route.ts`
**Claim:** `setSetting` accepts `expectedVersion` and the PATCH schemas accept `expectedVersion`, but the UI never sends it. Two managers editing delivery ZIPs or the alert banner will silently last-write-wins. The banner is loaded into the admin layout on every navigation, so a stale banner can also overwrite a concurrent change without warning. Send `expectedVersion` from the client and enforce it server-side.

### M7 — Bulk status UI is hardcoded to one transition (FULFILLING)
**Sources:** quality 7, clean-code L4
**Location:** `components/admin/orders-list.tsx:61-90, 77`; `lib/ops/repeat.ts:216-296, 227-231`
**Claim:** `runBulk("status")` always sends `toStatus: "FULFILLING"`. The API supports `CANCELLED`, `FULFILLING`, `COMPLETED`, but the UI offers no picker. Operators cannot bulk-cancel or bulk-complete from the list, which limits the "bounded bulk actions with deterministic conflict reporting" goal to a single hardcoded action. Add a target picker (or three buttons) reflecting the API.

### M8 — Refund reason is hardcoded to "Admin refund"
**Sources:** quality 8
**Location:** `components/admin/order-detail.tsx:58-72`; `lib/ops/refunds.ts:82-95`
**Claim:** The refund form sends `reason: "Admin refund"` for every refund. The audit row records that string, so the trail cannot distinguish a partial refund, a goodwill refund, or a fraud reversal. R-054 expects a real refund path; a reason input is the minimum audit quality bar.

### M9 — Admin page-gate pattern is inconsistent (POS deviates, swallows all errors)
**Sources:** quality 9, quality 10, rules F9, clean-code M1
**Location:** `app/(admin)/admin/pos/page.tsx:7-13`; 8 other admin pages; `lib/admin-gate.ts:6-8`
**Claim:** Eight admin pages use `requireAdminPage` + `instanceof AuthError && error.status === 403 → <Forbidden/>` + `throw error`. `admin/page.tsx` catches 401 and 403; the others rethrow 401 to the global error page, so a signed-out staff member hitting `/admin/orders` gets an unhandled 401 instead of the sign-in prompt. `admin/pos/page.tsx` uses `try { await requirePermission("admin.access") } catch { return <Forbidden/> }` — catches every error (including a 500 from `isSetupComplete()` or a DB outage) and renders it as "Admin access required for POS builder," hiding real outages. It also skips the `isSetupComplete()` redirect. The page-gate try/catch wrapper is copy-pasted across 8 pages. Pick one pattern (the dashboard's 401+403 handling), extract a `withAdminPage(permission, render)` wrapper or `<AdminPage permission>` boundary, and catch only `AuthError` 403.

### M10 — Money formatting duplicated inline despite an existing `formatCents` helper
**Sources:** clean-code H1, quality 11
**Location:** `lib/storefront/catalog.ts:11` (re-exports `formatCents`); `admin/page.tsx:7-10` (local `money()`); `components/admin/orders-list.tsx:193`; `components/admin/order-detail.tsx:122, 133, 134, 150`
**Claim:** 6+ call sites inline `${(cents / 100).toFixed(2)}` despite the shared helper. The local `money()` and `formatCents` disagree on the null case — exactly the drift the shared helper exists to prevent. Extract to `lib/format.ts` and reuse.

### M11 — List-page boilerplate duplicated between orders and customers
**Sources:** clean-code H2
**Location:** `components/admin/orders-list.tsx`, `components/admin/customers-list.tsx`
**Claim:** Both implement `useCallback(load, [page, q])` → `URLSearchParams({ page, pageSize: "50" })` + optional `q` → `useEffect(() => void load(), [load])` → `setRows`/`setTotalPages` → Prev/Next with `disabled={page <= 1}` / `disabled={page >= totalPages}`. Two copies diverging only in resource name and filter set. The next admin list page will pick one arbitrarily. Extract a `useAdminList` hook or `<AdminListPanel>` component.

### M12 — Settings JSONB type-narrowing duplicated in `settings-hub.tsx`
**Sources:** clean-code M3
**Location:** `components/admin/settings-hub.tsx:32-41`
**Claim:** A 10-line `typeof`/`in` block hand-narrows `emailFrom`/`emailReplyTo` for both object (`{ address }`) and string shapes, repeated for two keys. The settings JSONB is untyped end-to-end: `getSetting` returns `unknown`, each consumer re-derives the shape, and `load()` defends against both shapes because no schema owns the value. Add a typed `emailAddressSetting` parser (or a typed `getSetting<T>`).

### M13 — Inline magic list limits with no named constants
**Sources:** clean-code M4
**Location:** `admin/audit/page.tsx:11` (`take: 50`); `api/admin/orders/[id]/route.ts:32` (`take: 250`); `lib/ops/orders.ts:137` (`take: 8`); `lib/ops/orders.ts:166` (`Math.min(100, Math.max(1, limit))`); `lib/ops/customers.ts:133` (`Math.min(25, limit)`); `lib/ops/orders.ts:8-9` (`DEFAULT_PAGE_SIZE = 50`, `MAX_PAGE_SIZE = 100` — named here, re-inlined as `"50"` in `orders-list.tsx:34`, `customers-list.tsx:22`, `orders/route.ts:25`, `customers/route.ts:23`)
**Claim:** List-page sizes are named in one file and literal in six others. One `lib/ops/limits.ts` (or extending `orders.ts` constants) covers the phase.

### M14 — Client fetch → json → setError pattern duplicated across 7 components
**Sources:** clean-code M5
**Location:** `orders-list.tsx`, `customers-list.tsx`, `order-detail.tsx`, `customer-detail.tsx`, `imports-client.tsx`, `pos-customer-panel.tsx`, `settings-hub.tsx`
**Claim:** Each reimplements `fetch(...)` → `await res.json()` → `if (!res.ok) setMessage(json.error || "… failed")` with subtly different fallback strings ("Bulk failed", "Stage failed", "Commit failed", "Save failed", "Attach failed", "Find/create failed"). A shared `requestJson` helper removes the drift.

### M15 — `maskError` collapses structured error codes to a generic string
**Sources:** rules F12
**Location:** `lib/result.ts:16-22`; routes mapping every `!result.ok` to 409
**Claim:** `maskError` returns the raw `error.message` in dev and a generic string in prod. Every `Result`-returning lib function (`refundPayment`, `commitImport`, `bulkRepeatOrders`, `bulkUpdateOrderStatus`, `findOrCreateCustomer`) carries a structured `error` code ("amount", "state", "season", "P2002"), but routes map every `!result.ok` to 409 with `publicMessage`. Validation failures (bad amount) and state conflicts (not posted) share one status and one message; the structured code is lost before it reaches the client. Propagate the code to the route and the response.

## Minors (21)

### m1 — `attach-customer` POS route mutates the draft with no audit row
**Sources:** security L1
**Location:** `app/api/admin/pos/attach-customer/route.ts:28-31`
**Claim:** Attaching a walk-in customer changes `customerId` and bumps `version` but writes no `AuditLog` entry. The customer-attach action (binding an order to a customer identity) is not attributable. Other draft mutations write audit; this one is missing.

### m2 — `requirePermission` 403 discloses the exact missing permission name
**Sources:** security L2
**Location:** `lib/auth.ts:138, 150`
**Claim:** `throw new AuthError(403, \`Missing permission: ${permission}\`)` returns the required permission string (e.g. `payments.refund`, `settings.write`) to any authenticated-but-unauthorized caller. A generic "Forbidden" leaks less about the permission graph to a low-privileged insider probing routes.

### m3 — `getOrderDetail` over-returns PII and raw Stripe objects
**Sources:** security L3
**Location:** `lib/ops/orders.ts:73-100`
**Claim:** The admin order detail payload includes the entire `customer` row (`emailNorm`, `phoneNorm`, `clerkUserId`) and full `stripeSessions`/`stripeIntents` rows. `admin.access` is broad; any staff holding it can read customer PII and Stripe object metadata the admin UI does not render (the UI's `OrderDetail` type only consumes `id`, `displayName`, `email`). Select only the fields the admin UI needs.

### m4 — `listOrders`/`listCustomers` crash on NaN page/pageSize
**Sources:** security L4
**Location:** `lib/ops/orders.ts:20-28`, `lib/ops/customers.ts:16-17`, `app/api/admin/orders/route.ts:24-25`
**Claim:** `Number(url.searchParams.get("page"))` can be NaN. In `clampPageSize`, `NaN < 1` is false so NaN flows to `Math.min(MAX, Math.floor(NaN))` = NaN; in `listOrders`, `Math.max(1, NaN)` = NaN. Prisma then receives `skip: NaN`/`take: NaN` and throws, surfacing as a 500. A caller with `admin.access` can trivially 500 either route. Coerce with `Number.isFinite` guards.

### m5 — Import `filename` stored unsanitized up to 200 chars
**Sources:** security L5
**Location:** `app/api/admin/imports/route.ts:11`, `lib/ops/import.ts:214`
**Claim:** `filename: z.string().max(200).optional()` is persisted verbatim to `ImportBatch.filename`. React escapes by default so no XSS, but no normalization means a 200-char junk/path-like filename is stored and shown as-is in admin surfaces.

### m6 — Customer detail omits available data
**Sources:** quality 12
**Location:** `components/admin/customer-detail.tsx`; `lib/ops/customers.ts:50-66`
**Claim:** The API returns `orders` with `expectedTotalCents` and `_count: { lines, packages }`, but the client type only consumes `id, orderNumber, status, paymentStatusCached, season`. Order history rows show status + payment status with no total and no package count, so the directory detail is less informative than the orders list for the same order.

### m7 — `listOrders` default includes DRAFTs
**Sources:** quality 13
**Location:** `lib/ops/orders.ts:29-34`
**Claim:** The base filter is `status: { not: DISCARDED }`, so the default orders list includes every open draft. Drafts are noise for ops staff scanning the list. Either default to non-draft or add a "hide drafts" toggle.

### m8 — Audit page has no pagination; `/api/audit` route is dead
**Sources:** quality 14
**Location:** `app/(admin)/admin/audit/page.tsx:9-16`; `app/api/audit/route.ts`
**Claim:** The page loads `take: 50` with no paging, no filter, no search. At crunch scale it shows only the last 50 actions and nothing older. The `/api/audit` route (take 100) is also unused — the page queries the DB directly, so the route is dead.

### m9 — `todayWorkQueue` OR clause is broader than "today"
**Sources:** quality 15
**Location:** `lib/ops/orders.ts:148-167`
**Claim:** The OR branch (`status in [PLACED, PAID]` and `paymentStatusCached in [UNPAID, PARTIAL, PAID]`) pulls in every open non-refunded order regardless of when it was placed. The "Today" queue is effectively "all open orders," which at crunch scale defeats the "Today work queue" intent of R-050. Tighten the OR or rename the page.

### m10 — Bulk repeat increments the source order's version
**Sources:** quality 16
**Location:** `lib/ops/repeat.ts:171-174`
**Claim:** After cloning, the source order's `version` is incremented. This invalidates the `expectedVersion` the operator just used and forces a reload before any further bulk action on the same selection. If the increment is meant as a concurrency guard, document why; otherwise drop it (the clone is a new draft, the source is not mutated).

### m11 — POS permission is `admin.access` (too broad)
**Sources:** quality 17
**Location:** `admin/pos/page.tsx:8`, `app/api/admin/pos/attach-customer/route.ts:18`
**Claim:** Any staff with `admin.access` can take cash/check payments and post refunds. The plan separates Manager vs Staff permission toggles; consider a `pos.use` (and `payments.refund`) permission so a restricted Staff can take POS payments without refund access, or vice versa.

### m12 — `admin-gate` redirects to setup before checking auth
**Sources:** quality 19
**Location:** `lib/admin-gate.ts:6-8`
**Claim:** `requireAdminPage` calls `isSetupComplete()` first and redirects to `/admin/setup` if not. For a signed-out staff member on a set-up instance this is fine, but the redirect runs on every gated page render even when the DB is up and setup is complete — an extra query per admin navigation. Cache or short-circuit once setup is known complete.

### m13 — `season-gate` API is not surfaced in the settings hub UI
**Sources:** quality 20
**Location:** `app/api/admin/season-gate/route.ts`, `components/admin/settings-hub.tsx`
**Claim:** The Orders tab copy says "Store status follows the current season Open/Closed gate" but there is no control to flip it. The endpoint exists and is audited, but an operator has no UI path to open/close the season from settings — they must hit the API directly. R-094 expects the settings hub to be wired to live config; the season gate is the most operationally critical config and it is missing from the hub.

### m14 — Bulk caps duplicated between route schema and lib
**Sources:** rules F10
**Location:** `app/api/admin/orders/bulk/route.ts:16, 21`; `lib/ops/repeat.ts:106, 235`
**Claim:** The route hardcodes `.max(25)` and `.max(100)` in the zod schema; `lib/ops/repeat.ts` re-declares `MAX_BULK_REPEAT = 25` and an inline `100`. Two homes per cap; changing one without the other drifts.

### m15 — Audit page renders raw ISO timestamp; order-detail uses `toLocaleString`
**Sources:** rules F11
**Location:** `app/(admin)/admin/audit/page.tsx:25`; `components/admin/order-detail.tsx:175`
**Claim:** Two timestamp formats for the same audit surface; the audit page is the one most likely to be screenshotted. Pick one formatter and reuse.

### m16 — `assertOfflinePaymentStaffOnly` redundant catch branches (dead conditional)
**Sources:** rules F13, clean-code L6
**Location:** `app/api/checkout/offline/route.ts:132-135`
**Claim:** `catch (error) { if (error instanceof AuthError) return apiErrorResponse(error); return apiErrorResponse(error); }` — both branches return the same thing. `apiErrorResponse` already special-cases `AuthError`. Collapse to one `return apiErrorResponse(error)`.

### m17 — Refund form offers refund on every payment regardless of method
**Sources:** rules F14
**Location:** `components/admin/order-detail.tsx:148-152`; `lib/ops/refunds.ts:47`
**Claim:** The refund dropdown lists every payment; `lib/ops/refunds.ts` only handles STRIPE (cash/check refunds are DB-only `refundedCents` adjustments with no money movement). The UI offers a "Refund" on a cash payment that the API treats as a no-op money move. The spec calls out a "Stripe refund path"; the UI doesn't distinguish it from cash/check.

### m18 — `imports-client.tsx` ships test CSV as the production textarea default
**Sources:** clean-code L1
**Location:** `components/admin/imports-client.tsx:22-24`
**Claim:** The textarea is seeded with `"displayName,email,phone\nValid Import,...\nDup Import,customer@tomchei.local,5559990000\nBad Row,,not-a-phone\n"`. A dev fixture baked into the production UI default; a real staff member opens the import page and sees seeded test rows referencing `customer@tomchei.local`. Default to empty (or a header-only line).

### m19 — Import preview hides raw row cells
**Sources:** clean-code L2
**Location:** `components/admin/imports-client.tsx:97-101`
**Claim:** The preview renders `#{r.rowNumber} {r.status} — {r.errors.join("; ")}`. The staged `raw` cells (displayName/email/phone/sku) are fetched but not shown. The user can see a row is INVALID but not what was in it, so they can't fix the source CSV without re-opening it.

### m20 — `load` not in `useCallback` / effect deps incomplete
**Sources:** clean-code L3
**Location:** `components/admin/order-detail.tsx:38-52`; `components/admin/settings-hub.tsx:25-61`
**Claim:** `load` is a plain function and `useEffect(() => { void load(); }, [orderId])` / `[]` omits `load` from deps. Both are recreated each render; the effect only re-runs because of `[orderId]` / `[]`. Lint would flag the missing dep; wrap in `useCallback` or inline.

### m21 — POS/customer debounce fetch has no `.catch` on `res.json()`
**Sources:** clean-code L5
**Location:** `components/admin/pos-customer-panel.tsx:33-37`; `orders-list.tsx:38-44`; `customers-list.tsx:24-29`; `order-detail.tsx:39-51`; `customer-detail.tsx:34-37`
**Claim:** `const res = await fetch(...); const json = await res.json(); if (res.ok) setHits(...)`. A non-JSON response (5xx HTML, gateway error) throws inside the timeout callback with no handler. Add a `.catch` (or guard `res.headers.get("content-type")`).

## Informational (2, not counted)

- **i1 — Bulk actions write one aggregate audit row, not per-order** (`lib/ops/repeat.ts:195-207, 280-290`): `BULK_ACTION_APPLIED` writes a single row whose `meta` includes `created`/`updated`/`conflicts`/`skipped` arrays with order IDs, so per-order attribution is recoverable. Still a single audit row for a multi-target money-adjacent action; if the meta shape ever changes, per-target attribution is lost. Noted for completeness. (security I1)
- **i2 — Admin mutation routes are not rate-limited** (`app/api/admin/**`): `withPublicGuard`/rate limiting is applied to public endpoints only. Admin mutation routes rely on cookie auth + `admin.access`/`settings.write` and same-site=lax. A compromised staff session can hammer refund/import/bulk endpoints without throttling. Staff are trusted, so informational. (security I2)

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| B1 | security H1 ; rules F2 |
| B2 | security H2 ; rules F1 |
| B3 | quality 1 ; rules F4 ; clean-code M2 |
| B5 | quality 3 ; rules F5 |
| M1 | security M2 ; rules F7 |
| M3 | rules F6 ; quality 18 |
| M4 | quality 4 ; rules F15 |
| M7 | quality 7 ; clean-code L4 |
| M9 | quality 9 ; quality 10 ; rules F9 ; clean-code M1 |
| M10 | clean-code H1 ; quality 11 |
| m16 | rules F13 ; clean-code L6 |

All other aggregate IDs are single-source. No new findings introduced.

## Pass notes (not counted)

- **No god files** (clean-code PASS): the largest P6 file (`settings-hub.tsx`, 329 lines) sits under the 500-line threshold and splits tabs by concern; `ops/import.ts` (359 lines) is single-concern. Materially better than arm-02's `pos-client.tsx` (468) / `settings-hub.tsx` (414) god files.
- **Naming** (clean-code PASS): no banned standalone names (`data`, `result`, `item`) in P6 code; `phoneNorm` / `emailNorm` are consistent. The one naming smell — `stripeChargeId` holding either a `pi_` intent or a `ch_` charge — is a schema-naming drift flagged in rules F1's scope.
- **Shared audit helper** (rules PASS): `writeAudit` is a single shared helper (no 9-site boilerplate), unlike arm-01/arm-02.
- **Nav gating consistent** (rules PASS): every NAV item carries a permission and is filtered — no half-gated nav.
- **Smoke gate logged with evidence** (rules PASS): `.scratch/PHASE-P6-SMOKE.md` shows 28/28 passed, unlike arm-01/arm-02.

## Smoke coverage gaps (not failures, untested by P6 smoke)

- **Concurrent same-order bulk repeats** — B7 not exercised. Smoke runs bulk actions sequentially.
- **Cross-order refund via foreign `paymentId`** — B1 not exercised. Smoke refunds only the order's own payment.
- **Refund-then-DB-failure divergence** — B2 not exercised. Smoke uses mock Stripe; no failure injection between Stripe and DB.
- **Audit read at scale (1k+ orders)** — B3 not exercised. Smoke seeds small data; the 250-row window always contains the target order's audits.
- **Import commit with a late-arriving duplicate** — B5 not exercised. Smoke commits a clean batch.
- **Bulk status transition legality** — B6 not exercised. Smoke only bulk-transitions to FULFILLING from PAID.
- **POS customer-attach failure between create and attach** — B4 not exercised. Smoke attaches successfully on the first try.

## Bottom line

P6 arm-03 is functionally complete against EXPECTED (smoke 28/28 PASS) and is the most disciplined P6 of the three arms on structure (no god files, shared audit helper, consistent nav gating, logged smoke evidence). The blockers cluster on the refund money-path (B1, B2), audit integrity (B3, B8), import atomicity (B5), POS attach atomicity (B4), and bulk concurrency/state-machine correctness (B6, B7) — none exercised by smoke. The majors are mostly duplication and pattern drift (M9–M14) plus the unvalidated settings JSONB (M2) and missing optimistic concurrency (M6). The minors are dead-code, magic-value, PII-over-return, and workflow-discipline cleanups. Fix B1/B2/B5/B6 before any real Stripe live key or Test 4 fix pass.
