# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P6 — Admin operations hub & POS
**Output:** `results/reviews/P6-clean-code-arm-01.md`
**Scope:** P6 new/modified files under `arms/arm-01/workspace/` (admin pages, admin API routes, `lib/admin-operations.ts`, `lib/csv-import.ts`, P6 components, migration, smoke). Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Summary

P6 lands a coherent admin surface and reuses prior helpers well (`formatCurrency`, `getCurrentSeason`, `getAvailableQuantity`, `requirePermission`, `recalculatePaymentStatus`, `finalizePosOrder`, `getOrderDraftStorageKey`). The domain layer (`domain/checkout.ts`) stays the single source of truth for finalize/reserve/refund. New concerns cluster around **duplicated phone normalization** (4 divergent copies), **duplicated pagination logic + constant**, and a repeated **audit-log write** block with no helper. Several smaller pattern-drift and naming issues below.

## Findings

### High

1. **Phone normalization duplicated 4× with divergent return semantics** — `csv-import.ts` (`normalizeImportedPhone`, returns `""`), `api/admin/imports/route.ts` (`normalizedPhone`, returns `""`), `api/admin/imports/[batchId]/commit/route.ts` (`normalizedPhone`, returns `null`), `api/admin/customers/route.ts` (`normalizePhone`, returns `null`). All four implement the same `digits.replace(/\D/g,"")` + `+1`/`+` prefix rule but disagree on the empty-input return value, which is exactly the class of drift that produces silent duplicate-customer matches. `lib/normalize.ts` already exists (holds `normalizeEmail`) and is the obvious home for a single `normalizePhone`.

2. **Pagination logic + page-size constant duplicated** — `lib/admin-operations.ts` (`ADMIN_PAGE_SIZE = 25`, `Math.max(1, Math.trunc(...))`, `Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE))`) and `app/(admin)/admin/customers/page.tsx` (`const PAGE_SIZE = 25`, `Math.max(1, Number(query.page) || 1)`, `Math.max(1, Math.ceil(total / PAGE_SIZE))`). Two copies of the same idea with two different page-parsing idioms (`Math.trunc` vs `Number()||1`) and a magic `25` redefined per file. The orders list centralizes its query in `admin-operations.ts`; the customers list re-implements `findMany`+`count` inline in the page component, so the duplication is structural, not just numeric.

### Medium

3. **Audit-log write block repeated with no helper** — `auditLog.create({ data: { actorStaffId, action, targetType, targetId, metadata } })` is hand-rolled in ~9 P6 call sites (`admin-operations.ts`, `imports/route.ts`, `imports/[batchId]/commit/route.ts`, `pos/.../checkout/route.ts`, `orders/[orderId]/payments/route.ts` ×2, `orders/[orderId]/refunds/route.ts`, `customers/route.ts`, `settings/route.ts`) and across earlier phases (~18 total). The shape is identical except `metadata`; a `writeAudit(tx, actorStaffId, action, targetType, targetId, metadata?)` helper would remove the boilerplate and guarantee the `actorStaffId`/`targetType`/`targetId` triple is never mistyped.

4. **Type/schema drift on `ImportBatch.errors` JSONB** — `import-manager.tsx` defines `ImportPreview` with `errors: { rowNumber; code; message }[]`, while `imports/page.tsx` re-derives the same shape via a 12-line inline type guard (`issue is { rowNumber: number; code: string; message: string }` with `typeof` checks). `csv-import.ts` already exports `ImportIssue` with the same fields; neither consumer reuses it. The page-level guard exists only because the JSONB column is untyped end-to-end.

5. **`pos-customer-picker.tsx` filename does not match its export** — file is `pos-customer-picker` but the sole export is `PosCustomerCreator`. `pos/page.tsx` imports `PosCustomerCreator` from `@/components/pos-customer-picker`. The picker-vs-creator mismatch will mislead anyone grepping for a "picker" component.

6. **`admin-order-actions.tsx` bundles two unrelated concerns** — `BulkRepeatButton` (list-page bulk action) and `OrderMoneyActions` (detail-page payment/refund forms) share only the "admin order" namespace. Each has its own state, fetch targets, and rendering. Two single-concern files would read cleaner than one grab-bag.

7. **"Start of today" computed twice in `admin-operations.ts`** — `getOperationsDashboard()` and `getTodayQueue()` both open with `const today = new Date(); today.setHours(0,0,0,0);`. Small, but it is the kind of date boundary that drifts (UTC vs local) once one call site is touched.

### Low

8. **Client "fetch → json → setMessage → reload" pattern repeated** — `BulkRepeatButton`, `OrderMoneyActions.postPayment`, `OrderMoneyActions.refund`, `ImportManager.stage`, `ImportManager.commit`, `PosCheckoutForm.checkout`, `PosCustomerCreator.createCustomer` all follow the same shape (build body, POST, read `payload.error` on failure, `window.location.reload()`/`assign` on success). Not enough to abstract into a generic hook yet, but the `window.location.reload()` reflex in particular is worth a shared `refresh()` convention before it spreads further.

9. **Pagination URL construction diverges between the two list pages** — `orders/page.tsx` builds a `preserved` `URLSearchParams` and spreads `[["page", ...]]` into it (keeps filters across pages); `customers/page.tsx` hand-strings `?q=${encodeURIComponent(...)}&page=${...}`. Both work, but the two admin list pages now demonstrate two different "how to paginate with filters" patterns, and the next list page will pick one arbitrarily.

10. **Audit entry shape inconsistency** — `customers/route.ts` creates an audit log with `action`/`targetType`/`targetId` but **no `metadata`**, while every other P6 audit write includes `metadata`. Either the find-or-create event has nothing worth recording (then say so) or the customer id/displayName of the matched-vs-created branch should be captured like the siblings do.

## Counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 3 |
| **Total** | **10** |
