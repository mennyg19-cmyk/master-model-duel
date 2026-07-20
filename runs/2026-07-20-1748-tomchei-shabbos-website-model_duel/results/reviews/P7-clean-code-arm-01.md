# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P7 — Package engine live: grouping UI, statuses, print batches, cards
**Output:** `results/reviews/P7-clean-code-arm-01.md`
**Scope:** P7 new/modified files under `arms/arm-01/workspace/` (`domain/package-operations.ts`, `domain/print-batches.ts`, `app/(admin)/admin/fulfillment/page.tsx`, `components/fulfillment-board.tsx`, `api/admin/packages/actions/route.ts`, `api/admin/print-batches/route.ts`, `api/admin/print-artifacts/[artifactId]/route.ts`, `prisma/migrations/20260721022000_p7_fulfillment_printing/migration.sql`, `scripts/p7-smoke.ts`, plus P7 touch-ups in `domain/checkout.ts`, `domain/order-engine.ts`, `app/(admin)/admin/layout.tsx`). Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Summary

P7 lands a focused package/print surface with good reuse of prior primitives (`groupLinesIntoPackages`, `createPackageGroupingKey`, `requirePermission`, `AccessDeniedError`, optimistic `version` increments, `FOR UPDATE` row locks). The print-batch domain is correctly idempotent and the print-vs-status separation is enforced cleanly. New concerns cluster around **inconsistent return semantics of `materializeOrderPackages`** (skipped vs. created counts conflated), a **side-effecting write inside a GET render**, a **hand-rolled PDF generator with magic layout constants and silent truncation**, and **duplicated package-with-lines query shape** between the fulfillment page and `loadPrintablePackages`. Smaller pattern-drift and dead-schema items below.

## Findings

### High

1. **`materializeOrderPackages` return value is overloaded (skip-count vs. created-count)** — `package-operations.ts:29` returns `order.packages.length` (existing package count) when the order is already finalized or already has packages, but returns `groups.length` (newly created count) after materialization. The two numbers mean different things. The only caller that consumes the return, `materializeMissingFinalizedOrders` (`:105`), does `packageCount += await ...materializeOrderPackages(...)`, so any already-materialized order it touches inflates the "created" total by its existing package count. Either return a consistent semantic (e.g. always number created this call, `0` when skipped) or return a discriminated `{ created, skipped }` shape like the sibling `materializeMissingFinalizedOrders` does.

2. **Side-effecting materialization runs inside a GET page render** — `fulfillment/page.tsx:10` calls `materializeMissingFinalizedOrders(db)` (which writes `Package` + `PackageAudit` rows inside transactions) directly in the server component body before the read queries. A page GET now mutates up to 200 orders per request. This is the same class of "write-on-render" drift the codebase avoided in `order-engine.ts` (which gates finalization behind an explicit `finalizeOrder` call). Materialization belongs in the finalize path (already wired via `commitStripePayment`/`finalizePosOrder`/`finalizeOrder`) or a scheduled job, not a page render; the backfill here is a hidden write-through cache.

### Medium

3. **Hand-rolled PDF generator carries magic layout constants and silently truncates** — `print-batches.ts:241` `renderArtifactPdf` embeds undocumented magic values (`50 750 Td`, `0 -14 Td`, `612 792` MediaBox, `/F1 11`, and a hard `.slice(0, 48)` line cap at `:263`). The `48` cap drops any content beyond 48 rendered lines with no indication in the payload or PDF — a large multi-recipient filing group loses packages silently. The constants have no named home and the function mixes PDF object assembly, text escaping, and layout in one 57-line body. At minimum the line cap should be a named constant with overflow signaled; the layout/object assembly is a candidate for a small `lib/pdf.ts` once a second caller appears.

4. **Package-with-lines Prisma include shape duplicated** — `fulfillment/page.tsx:12` and `loadPrintablePackages` (`print-batches.ts:11`) both build `package.findMany` with `isActive` + `include: { fulfillmentMethod, order: {...}, lines: { include: { orderLine: {...} } } }`. The two queries disagree on filtering (the page omits `stage: { notIn: ["SENT","PICKED_UP"] }` and `order: { status: "FINALIZED" }`, so the board shows SENT/PICKED_UP packages that the print engine correctly excludes), and the include shape is re-derived in each file. A shared `loadActivePackages` selector (or at least a shared `packageWithLinesInclude` Prisma validator) would remove the drift and make the filter mismatch obvious.

5. **`sourceArtifactId` column is dead schema** — `migration.sql:23` and `schema.prisma:526` add `PrintArtifact.sourceArtifactId String?` but no P7 code writes or reads it (grep finds only the schema/migration definitions). It is not referenced by `createArtifacts`, the reprint routes, or the PDF endpoint. Either it is scaffolding for a future reprint-chain feature (then it should be commented as such in the schema) or it is dead and should be dropped before the migration is considered final.

6. **`materializeOrderPackages` does not open its own transaction — pattern drift vs. siblings** — `splitPackage` and `regroupPackages` in the same file wrap themselves in `prisma.$transaction` and do `FOR UPDATE` locking; `materializeOrderPackages` performs a sequence of `prisma.package.create` + `prisma.packageAudit.create` pairs with no transaction and no lock, relying on every caller to wrap it (`checkout.ts`, `order-engine.ts`, `materializeMissingFinalizedOrders` all do). One new caller that forgets the wrapper creates packages non-atomically. The function should either open its own transaction (matching its siblings) or be named `materializeOrderPackagesInTx` to make the contract unmissable.

7. **`createArtifacts` repeats the same group-by-Map pattern twice** — `print-batches.ts:86` builds `packagesByGroup` and `:112` builds `packagesByOrder` with the same `Map.set(k, [...(map.get(k) ?? []), x])` accumulator loop. A tiny `groupBy(items, keyFn)` helper (the codebase already uses this idiom in `package-grouping.ts` and the fulfillment page's `channels` Map) would replace both loops and the matching `channels` accumulator in `fulfillment/page.tsx:39`.

### Low

8. **`bulkAdvancePackageStage` silently truncates beyond 100** — `package-operations.ts:291` `requests.slice(0, 100)` duplicates the `.max(100)` cap already enforced by the Zod schema in `packages/actions/route.ts:35`. The route-level schema is the authoritative bound; the slice is redundant defensive code that hides overflow from the caller instead of erroring.

9. **Order-label formatting drifts across the admin surface** — `fulfillment/page.tsx:64` and `:115` use `Order #${orderNumber ?? orderId.slice(-6)}`, while `print-batches.ts:67` uses `#${orderNumber ?? order.id}` (no "Order " prefix, full id fallback) and `:123` uses `ORDER-${orderNumber ?? artifactOrderId}`. Every other admin page (`today`, `orders`, `customers/[id]`, `orders/[orderId]`, `admin/page`) uses `#${orderNumber ?? draftReference}`. P7 introduces a third fallback idiom (`slice(-6)`) and a third prefix. A shared `formatOrderLabel(order)` helper would pin one shape.

10. **`fulfillment-board.tsx` `post` reads `payload.error` without a fallback** — `:47` does `setMessage(response.ok ? success : payload.error)`. If a non-OK response has no JSON body or a different error shape, `payload.error` is `undefined` and the message renders the literal string `"undefined"`. The sibling `admin-order-actions.tsx` guards the same case; this handler does not.

11. **`window.location.reload()` reflex repeated** — `fulfillment-board.tsx:49` reuses the same "POST then full reload" pattern flagged in the P6 review (`admin-order-actions.tsx:70`, `:88`). Still no shared `refresh()` convention; P7 adds a third call site.

## Counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **11** |
