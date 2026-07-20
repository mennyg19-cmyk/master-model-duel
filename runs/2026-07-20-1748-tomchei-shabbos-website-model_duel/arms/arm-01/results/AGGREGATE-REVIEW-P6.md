# Aggregate review — P6, arm-01

Phase: P6 — Admin operations hub & POS. Tree: `arms/arm-01/workspace/`.
Sources: P6-security, P6-quality, P6-rules, P6-clean-code (blind).
Union + dedupe by location+claim. Severity = max across reviewers; security blockers survive. No new findings.

## Blocker

1. **Stripe refund issued before DB transaction — double-refund / lost-record.** `src/app/api/admin/orders/[orderId]/refunds/route.ts:40-83`. `stripe.refunds.create(...)` runs before `db.$transaction` that records `refundedCents`. Concurrent refunds from the same stale baseline each issue a real Stripe refund; only one `updateMany` (optimistic `refundedCents` guard) succeeds, loser returns 409 while the customer was already refunded twice. A crash between Stripe call and commit orphans a refund the ledger never records. Idempotency key `admin-refund:${payment.id}:${refundedCents}:${amount}` mutates with `refundedCents`, so a retry can issue a second real refund. [sec H1, qual H1, rules F6]

## Major

2. **Audit trail exposed under `admin:view`; `audit:view` never enforced.** `src/lib/permissions.ts:7`, `src/app/(admin)/admin/audit/page.tsx:7`, `src/app/(admin)/admin/page.tsx:11-16`, `src/app/(admin)/admin/orders/[orderId]/page.tsx:17-31`, `src/app/api/admin/overview/route.ts:7-13`. STAFF holds `admin:view` and reads the full audit trail (impersonation, refunds, settings, imports) including `actorStaffId`/`targetId`. [sec M1, rules F2]
3. **Guest draft rate limit keyed on spoofable `X-Forwarded-For`.** `src/app/api/order/drafts/route.ts:17-41`. Header is client-controllable unless stripped at a trusted proxy; attacker rotates it to bypass 10/min and burn draft-reference space. `"unknown"` is a shared bucket. [sec M2]
4. **Bulk-repeat authorized by `admin:view`, not a write permission.** `src/app/api/admin/orders/bulk-repeat/route.ts:15`, `src/lib/admin-operations.ts:128-217`. Any `admin:view` user can mass-generate up to 50 draft orders against any finalized order, copying totals/line items. [sec M3, qual M2]
5. **Impersonation cookie is a raw session id with no server-side expiry.** `src/app/api/admin/impersonation/route.ts:30-57`, `src/lib/auth.ts:76-95`. `impersonation_session_id` (bare cuid) sent to every route (path `/`), `maxAge: 1h`, no `expiresAt` on the row; exfiltration within 1h yields a long-lived handle. [sec M4]
6. **POS checkout hardcodes `deliveryDay: null` for every fulfillment method.** `src/components/pos-checkout-form.tsx`, `src/app/api/admin/pos/orders/[orderId]/checkout/route.ts`. BULK/PACKAGE/SHIPPING POS orders finalize with no delivery day the storefront path requires. [qual M3]
7. **Refund form defaults to full `amountCents`, not remaining refundable.** `src/components/admin-order-actions.tsx:106`. Partially/fully refunded payments yield a 409 on submit; form renders with no `refundedCents < amountCents` guard. [qual M4]
8. **`normalizePhone` duplicated 4x with divergent empty-return contracts.** `src/app/api/admin/customers/route.ts:14` (null), `src/app/api/admin/imports/route.ts:14` (""), `src/app/api/admin/imports/[batchId]/commit/route.ts:8` (null), `src/lib/csv-import.ts:11` ("" ). `lib/normalize.ts` already owns `normalizeEmail`; null/"" split is a latent duplicate-customer-match bug. [rules F3, clean #1]
9. **Pagination logic + page-size constant duplicated.** `src/lib/admin-operations.ts` (`ADMIN_PAGE_SIZE=25`, `Math.trunc`) and `src/app/(admin)/admin/customers/page.tsx` (`PAGE_SIZE=25`, `Number()||1`). Two idioms, magic 25 redefined per file; customers list re-implements `findMany`+`count` inline. [clean #2]
10. **Import commit doesn't re-check duplicates and doesn't handle P2002.** `src/app/api/admin/imports/[batchId]/commit/route.ts:31-85`. Outer catch only handles `AccessDeniedError`; a customer inserted between stage and commit surfaces as unhandled 500, not 409. [sec L3, rules F7]
11. **Dead `PATCH /payments` void handler.** `src/app/api/admin/orders/[orderId]/payments/route.ts:85-136`. Implements `payment.offline_voided` audit action with no UI caller (`OrderMoneyActions` only POSTs). [rules F8]
12. **Missing `.scratch/PHASE-P6-SMOKE.md`.** No `.scratch/` dir in the arm; `scripts/p6-smoke.ts` exists but no evidence the checklist was walked. Gate unlogged. [rules F9]
13. **Audit-log write block repeated with no helper.** ~9 P6 call sites hand-roll `auditLog.create({ data: { actorStaffId, action, targetType, targetId, metadata } })`. A `writeAudit(tx, actorStaffId, action, targetType, targetId, metadata?)` helper would remove boilerplate and guarantee the triple. [clean #3]
14. **Type/schema drift on `ImportBatch.errors` JSONB.** `import-manager.tsx` (`ImportPreview`), `imports/page.tsx` (12-line inline type guard), `csv-import.ts` (`ImportIssue`) all re-derive the same `{ rowNumber; code; message }` shape; none reuses `ImportIssue`. [clean #4]
15. **`pos-customer-picker.tsx` filename does not match its export `PosCustomerCreator`.** `pos/page.tsx` imports `PosCustomerCreator` from `@/components/pos-customer-picker`. [clean #5]
16. **`admin-order-actions.tsx` bundles two unrelated concerns.** `BulkRepeatButton` (list bulk action) and `OrderMoneyActions` (detail payment/refund forms) share only the "admin order" namespace. [clean #6]
17. **"Start of today" computed twice in `admin-operations.ts`.** `getOperationsDashboard()` and `getTodayQueue()` both open with `new Date(); setHours(0,0,0,0)` — a UTC/local drift hazard. [clean #7]
18. **Inconsistent nav permission gating.** `src/app/(admin)/admin/layout.tsx:62-100`. Catalog/Media/Settings gate on `settings:manage`, Staff on `staff:manage`, but POS/Imports/Audit are unconditional; STAFF sees links and 403s on POS/Imports. [rules F5]
19. **POS customer-create API under-gated vs the POS page.** `src/app/api/admin/customers/route.ts:21` requires `admin:view`; the POS page that calls it via `PosCustomerCreator` requires `payments:manage`. A STAFF user cannot open POS yet can mint customers. [rules F4, qual L13]
20. **"Season revenue" KPI has no season filter.** `src/lib/admin-operations.ts:61-64`, `src/app/(admin)/admin/page.tsx:32`. Aggregates all `FINALIZED` orders (no `seasonId`) under a per-season label; `getCurrentSeason()` exists and is used elsewhere. [rules F1, qual L5]

## Minor

21. **`deliveryZips` / admin settings strings unbounded.** `src/app/api/admin/settings/route.ts:29-39`, `src/lib/store-settings.ts:32-44`. No max length on `emailSenderName`/`operationsAlert`/`developerWebhookLabel`; ZIPs not validated as ZIPs. [sec L1]
22. **Offline payment amount has no upper bound vs. order total.** `src/app/api/admin/orders/[orderId]/payments/route.ts:32-83`. `postPaymentSchema` only requires positive int; overpayment yields negative balance flowing into `recalculatePaymentStatus`. [sec L2]
23. **Test-auth path trusts `Host` header for localhost gate.** `src/lib/auth.ts:35-57`. Behind a misconfigured proxy forwarding a client-influenced `Host`, the gate could be satisfied remotely; gated by `NODE_ENV` + `ENABLE_TEST_AUTH` + HMAC, so low exploitability. [sec L4]
24. **CSRF relies on JSON content-type preflight, no explicit token.** All state-changing admin routes are cookie-auth + `application/json`; impersonation `DELETE` and any future form-accepting route would not share the implicit protection. [sec I1]
25. **Today queue orders by `cachedPaymentStatus: "asc"` (alphabetical).** `src/lib/admin-operations.ts:94`. `PARTIALLY_PAID < PAID < REFUNDED < UNPAID` — unpaid sorts last, inverted from "outstanding balances" intent. [qual L7]
26. **Admin sidebar has no active-link state.** `src/app/(admin)/admin/layout.tsx:62`. Overview is hard-highlighted; every other nav link has no active variant. [qual L8]
27. **`getOrderDetail` over-fetches unused relations.** `src/lib/admin-operations.ts:122-123`. Includes `product`, `addOns`, `paymentIntents`, `packages`; detail page consumes only snapshots, address, fulfillment, payments. [qual L9, rules F11]
28. **Import stage allows products when no current season is set.** `src/app/api/admin/imports/route.ts:48-56`. `seasonId=""` → empty duplicate set; commit then throws "Current season is required". Stage succeeds, commit fails. [qual L10, rules F16]
29. **Imported products created without inventory, options, or add-ons.** `src/app/api/admin/imports/[batchId]/commit/route.ts`. Packages built `kind: PACKAGE, isFinishedPackage: true`, no `inventoryItem`/`options`/`allowedAddOns`. [qual L11]
30. **`stripePaymentIntent.updateMany` where-clause drops to order-wide when `reference` is null.** `src/app/api/admin/orders/[orderId]/refunds/route.ts:64`. `payment.reference ?? undefined` would update every PI on the order. [qual L12]
31. **Audit trail on order detail misses `Order`-targeted events for the repeat source.** `order.repeated` targets the new draft's id; source order's detail never shows it was repeated. [qual L14]
32. **Audit views render raw `actorStaffId` cuids.** `src/app/(admin)/admin/audit/page.tsx:21`, `src/app/(admin)/admin/orders/[orderId]/page.tsx:63`. Prints cuid, not display name; resolver pattern exists elsewhere. [rules F10]
33. **`result` standalone variable name.** `src/app/api/admin/orders/[orderId]/payments/route.ts:96`. Banned-as-standalone; `paymentOutcome` or inline return reads better. [rules F12]
34. **"Good evening" hardcoded regardless of time.** `src/app/(admin)/admin/page.tsx:25`. Server-rendered `force-dynamic`; a time-aware greeting is cheap. [qual L6, rules F13]
35. **Overview heading weight drifts from the rest of admin.** `src/app/(admin)/admin/page.tsx:24` uses `text-4xl font-bold tracking-tight`; every other P6 admin page uses `text-4xl font-black`. [rules F14]
36. **Inline magic list caps and a duplicated 2000-row limit.** `take: 100/200/50/12/6/8` inline across `admin-operations.ts`, `audit/page.tsx`, `imports/page.tsx`, `overview/route.ts`, `admin/page.tsx`; the `2000`-row import cap appears in four homes. [rules F15]
37. **`StagedRow.rowNumber` typed as string.** `src/lib/csv-import.ts:4`. Forces `Number(row.rowNumber)` at every consumer and a runtime type guard on a JSONB column the app controls. [rules F17]
38. **Client "fetch → json → setMessage → reload" pattern repeated.** `BulkRepeatButton`, `OrderMoneyActions.postPayment/refund`, `ImportManager.stage/commit`, `PosCheckoutForm.checkout`, `PosCustomerCreator.createCustomer`. `window.location.reload()` reflex worth a shared `refresh()`. [clean #8]
39. **Pagination URL construction diverges between the two list pages.** `orders/page.tsx` spreads `[["page", ...]]` into preserved `URLSearchParams`; `customers/page.tsx` hand-strings `?q=...&page=...`. [clean #9]
40. **Audit entry shape inconsistency.** `src/app/api/admin/customers/route.ts` writes audit with no `metadata`, unlike every other P6 audit write. [clean #10]

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 19 |
| Minor | 20 |
| **Total** | **40** |

Hot spots: permission model (#2, #4, #18, #19), money/refund consistency (#1, #7), import stage↔commit integrity (#10, #28, #29), duplicated phone normalization (#8), audit surfaces (#2, #13, #31, #32).
