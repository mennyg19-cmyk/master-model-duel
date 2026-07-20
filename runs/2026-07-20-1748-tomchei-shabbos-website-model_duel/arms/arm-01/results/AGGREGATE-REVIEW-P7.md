# Aggregate review — P7, arm-01

**Phase:** P7 — Package engine live (grouping UI, statuses, print batches, cards)
**Tree:** `arms/arm-01/workspace/`
**Inputs:** `results/reviews/P7-{security,quality,rules,clean-code}-arm-01.md`
**Method:** Union + dedupe by location+claim (highest severity wins). No new findings.
**Severity mapping:** High → blocker · Medium → major · Low/Info → minor.

## Counts

| Blocker | Major | Minor | Total |
|---|---|---|---|
| 4 | 13 | 13 | 30 |

## Blockers

### B1 — Fulfillment-page GET performs bulk write side-effects under `admin:view`
`src/app/(admin)/admin/fulfillment/page.tsx:8-10`, `src/domain/package-operations.ts:94-119`
`FulfillmentPage` (a GET render) calls `materializeMissingFinalizedOrders(db)`, which creates `Package` + `PackageLine` + `PackageAudit` rows inside per-order `$transaction`s for up to 200 finalized orders. The route is gated by `requirePermission("admin:view")`, held by read-only `STAFF`, so a view-only role mutates order/audit state system-wide on every board load — bypassing the `orders:manage` boundary that the equivalent `split`/`regroup`/`status`/print mutations enforce, and violating the GET-must-not-mutate contract.
Sources: sec H1, quality H2, rules M1, clean-code H2.

### B2 — `renderArtifactPdf` strips all non-ASCII, blanking non-Latin names
`src/domain/print-batches.ts:234-239` (`escapePdfText`)
`normalize("NFKD").replace(/[^\x20-\x7E]/g, "")` drops every non-ASCII byte before drawing recipient name, customer, greeting, and product text. On a Purim site, Hebrew/non-Latin recipient names and greetings render as empty strings in slips, labels, greeting cards, and packing slips. Smoke fixtures are ASCII-only, so S2/S3 cannot catch it; the payload JSON preserves the bytes, only the user-visible PDF loses them.
Sources: quality H1, rules H1.

### B3 — Bulk-status conflicts silently dropped from the UI
`src/components/fulfillment-board.tsx:47-49`
`post()` reads `payload.error` only on `!response.ok`; on `response.ok` it shows the canned success string and reloads. `bulkAdvancePackageStage` returns `{ applied, conflicts }`, so per-package transition failures (e.g. `NEW` → `SENT`, rejected by `ALLOWED_PACKAGE_TRANSITIONS`) arrive inside an OK response and are never surfaced — staff see "Selected packages advanced to SENT" even when every package conflicted.
Sources: rules H2.

### B4 — `materializeOrderPackages` return value is overloaded (skip-count vs. created-count)
`src/domain/package-operations.ts:29`, `:105`
Returns `order.packages.length` (existing count) when the order is already finalized or already has packages, but `groups.length` (newly created count) after materialization. The only consumer, `materializeMissingFinalizedOrders` (`:105`), does `packageCount += await materializeOrderPackages(...)`, so any already-materialized order inflates the "created" total by its existing package count. Return a consistent semantic (0 when skipped) or a `{ created, skipped }` shape like the sibling.
Sources: clean-code H1.

## Majors

### M1 — `regroupPackages` has no row lock / inconsistent locking vs. `splitPackage`
`src/domain/package-operations.ts:209-282` (vs. `:134-136`)
`splitPackage` opens `SELECT ... FOR UPDATE`; `regroupPackages` does a plain `findMany` (`:218-223`) with only `version: { increment: 1 }` as a guard — no `FOR UPDATE`, no optimistic-version check. Two concurrent regroups on overlapping packages can double-move lines or resurrect deleted source lines, with audit rows recording contradictory outcomes. Same module, two locking patterns.
Sources: sec M1, quality M1, rules L4.

### M2 — Print-artifact PDF download exposes recipient/customer PII under `admin:view`
`src/app/api/admin/print-artifacts/[artifactId]/route.ts:9-27`, `src/domain/print-batches.ts:50-78`
The artifact endpoint gates on `admin:view` only; `STAFF` can fetch any `PrintArtifact` by id. The payload embeds recipient name, full address snapshot, greeting snapshot, customer display name, order number, and SKU list. No per-artifact authorization or scoping; the unguessable cuid is the only capability token, and the fulfillment page surfaces 24 recent ids as download links — broader PII read than the role's write scope.
Sources: sec M2.

### M3 — `regroupPackages` does not recompute the target `groupingKey`
`src/domain/package-operations.ts:256-263`
Staff can regroup across different P2 grouping keys (recipient/address/method/greeting). The target retains its original `groupingKey` while its `lines` now describe a different group, so `Package.groupingKey` no longer represents contents — violating the P2 grouping-engine invariant and corrupting re-materialization / uniqueness assumptions.
Sources: quality M2.

### M4 — `renderArtifactPdf` silently truncates to 48 lines
`src/domain/print-batches.ts:263` (`.slice(0, 48)`)
No overflow / continued indicator. Orders with many packages or products lose trailing items in the printed PDF with no signal to staff.
Sources: quality M3.

### M5 — `bulkAdvancePackageStage` silently drops requests beyond 100 / redundant defensive slice
`src/domain/package-operations.ts:291`
`requests.slice(0, 100)` duplicates the `.max(100)` cap already enforced by the Zod schema in `packages/actions/route.ts:35`. The slice is dead code today and would silently discard overflow if the cap ever changes. Each request also opens its own `$transaction` (100 round-trips), no bulk path.
Sources: quality M4, rules L3, clean-code L8.

### M6 — `PrintArtifact.sourceArtifactId` column is dead schema
`prisma/migrations/20260721022000_p7_fulfillment_printing/migration.sql:23`, `prisma/schema.prisma:526`
Column is defined but no P7 code reads or writes it (not referenced by `createArtifacts`, reprint routes, or the PDF endpoint). Either scaffolding for a future reprint-chain (then comment it) or dead and should be dropped before the migration is final.
Sources: quality L6, clean-code M5.

### M7 — Missing phase smoke evidence artifact
`shared/phases/PHASE-P7-EXPECTED.md` requires evidence at `arms/{id}/workspace/.scratch/PHASE-P7-SMOKE.md`. No such file exists in `arms/arm-01/workspace/.scratch/`. The `scripts/p7-smoke.ts` harness exists, but the gate evidence file does not.
Sources: rules M3.

### M8 — Skipped-order error reasons computed then discarded
`src/domain/package-operations.ts` (`materializeMissingFinalizedOrders` collects `skipped: { orderId, reason }[]`), `src/app/(admin)/admin/fulfillment/page.tsx`
The page renders only `materialization.skipped.length` as a generic "N older finalized orders need recipient or fulfillment repair" banner; the real per-order reasons never reach staff.
Sources: rules M4.

### M9 — Inconsistent HTTP status mapping (409 as catch-all)
`src/app/api/admin/print-batches/route.ts`, `src/app/api/admin/packages/actions/route.ts`
Every non-`AccessDeniedError` failure returns 409, including "That filing group has no printable packages" (404/422), "That order has no printable packages" (404), and "Split quantity must be a positive whole number" (422). 409 Conflict is reserved for concurrent/version conflicts.
Sources: rules M5.

### M10 — `materializeOrderPackages` does not open its own transaction (pattern drift)
`src/domain/package-operations.ts`
`splitPackage` and `regroupPackages` wrap themselves in `$transaction` with `FOR UPDATE`; `materializeOrderPackages` performs `prisma.package.create` + `prisma.packageAudit.create` pairs with no transaction and no lock, relying on every caller (`checkout.ts`, `order-engine.ts`, `materializeMissingFinalizedOrders`) to wrap it. One new caller that forgets the wrapper creates packages non-atomically. Either open its own transaction or rename to `materializeOrderPackagesInTx`.
Sources: clean-code M6.

### M11 — `createArtifacts` repeats the same group-by-Map pattern twice
`src/domain/print-batches.ts:86` (`packagesByGroup`), `:112` (`packagesByOrder`)
Same `Map.set(k, [...(map.get(k) ?? []), x])` accumulator loop, plus the matching `channels` accumulator in `fulfillment/page.tsx:39`. A tiny `groupBy(items, keyFn)` helper (idiom already used in `package-grouping.ts`) would replace all three.
Sources: clean-code M7.

### M12 — Package-with-lines Prisma include shape duplicated (filter mismatch)
`src/app/(admin)/admin/fulfillment/page.tsx:12`, `src/domain/print-batches.ts:11` (`loadPrintablePackages`)
Both build `package.findMany` with `isActive` + `include: { fulfillmentMethod, order: {...}, lines: { include: { orderLine: {...} } } }`. The page omits `stage: { notIn: ["SENT","PICKED_UP"] }` and `order: { status: "FINALIZED" }`, so the board shows SENT/PICKED_UP packages that the print engine correctly excludes. A shared `packageWithLinesInclude` validator (or `loadActivePackages` selector) would remove the drift and make the mismatch obvious.
Sources: clean-code M4.

### M13 — Undocumented "boxes saved by grouping" business calculation
`src/app/(admin)/admin/fulfillment/page.tsx`
`groupedSavings += Math.max(0, giftCount - 1)` is presented as "boxes saved by grouping." The formula assumes one gift per box un-grouped and one box per group otherwise — a domain assumption with no DECISION-LOG entry, no constant, and no comment.
Sources: rules M2.

## Minors

### m1 — Magic layout constants in PDF renderer
`src/domain/print-batches.ts` (`renderArtifactPdf`)
Undocumented literals: `50 750 Td`, `0 -14 Td`, `/F1 11`, MediaBox `[0 0 612 792]`, `.slice(0, 48)`, `padStart(10)`/`padStart(6)` for xref. No named constants for letter-size / line-height / page cap.
Sources: rules L1, clean-code M3 (constants portion).

### m2 — Error responses echo raw `error.message` (existence probing)
`src/app/api/admin/packages/actions/route.ts:79-82`, `src/app/api/admin/print-batches/route.ts:53-56`, `src/domain/package-operations.ts:16,137,226`
`findUniqueOrThrow` and the regroup "same order" check surface Prisma/thrown messages distinguishing "record not found" from "regrouping requires two packages from the same order", letting an authorized user probe id existence / shared-order relationships. Manager-only, so limited to existence/relationship disclosure within a privileged role.
Sources: sec L1.

### m3 — Print-artifact route 404/200 distinguishable; artifact ids enter browser history
`src/app/api/admin/print-artifacts/[artifactId]/route.ts:14-27`, `src/components/fulfillment-board.tsx:308-317`
GET returns 404 on miss vs. 200 + inline PDF on hit; board opens each PDF via `<a target="_blank">` with `content-disposition: inline`, so the cuid lands in browser history/referrer. `cache-control: private, no-store` is set and cuids are unguessable — mild token-leakage surface on a `admin:view` path.
Sources: sec L2.

### m4 — CSRF continues to rely on JSON content-type preflight, no explicit token
`src/app/api/admin/packages/actions/route.ts`, `src/app/api/admin/print-batches/route.ts`
Cookie-authenticated POSTs consuming `application/json` with no CSRF token; simple cross-site submission is blocked by preflight, but any future form-accepting / `multipart` route would lose this implicit guard. Forward-looking.
Sources: sec I1.

### m5 — `loadPrintablePackages` uses string literals for stages instead of enum
`src/domain/print-batches.ts:19`
`stage: { notIn: ["SENT", "PICKED_UP"] }` while `package-operations.ts` uses `PackageStage.SENT` / `PackageStage.PICKED_UP` for the same concept. Drift hazard if the enum changes.
Sources: quality L1, rules L2.

### m6 — `fulfillment-board.tsx` full-page reloads after every action
`src/components/fulfillment-board.tsx:49`
`window.location.reload()` on every successful POST, losing scroll position, selection, and form state. Third call site of the same reflex (P6 `admin-order-actions.tsx:70`, `:88`); no shared `refresh()` convention.
Sources: quality L2, clean-code L11.

### m7 — No pagination on board / reprint-order list
`src/app/(admin)/admin/fulfillment/page.tsx:14` (`take: 200`), `src/components/fulfillment-board.tsx:287` (`orders.slice(0, 12)`)
Large operations hide packages and make some orders unreachable for reprint via UI. No "more" affordance or count.
Sources: quality L3, rules L6.

### m8 — Regroup/split audit metadata is thin
`src/domain/package-operations.ts:264-279`
`package.regrouped.source/target` records only the other package ID; split metadata records quantity but not resulting line states. Audit trail cannot reconstruct exact line movements.
Sources: quality L4.

### m9 — Bulk-status UI dropdown offers invalid transitions
`src/components/fulfillment-board.tsx:102-106`
SENT/PICKED_UP exposed in the bulk-stage dropdown for all selected packages including `NEW` ones, which `advancePackageStage` rejects. Predictable partial failures instead of pre-filtering valid target stages per current stage.
Sources: quality L5.

### m10 — Order-label formatting drifts across the admin surface
`src/app/(admin)/admin/fulfillment/page.tsx:64`, `:115` (`Order #${orderNumber ?? orderId.slice(-6)}`), `src/domain/print-batches.ts:67` (`#${orderNumber ?? order.id}`), `:123` (`ORDER-${orderNumber ?? artifactOrderId}`)
P7 introduces a third fallback idiom (`slice(-6)`) and a third prefix; other admin pages use `#${orderNumber ?? draftReference}`. A shared `formatOrderLabel(order)` helper would pin one shape.
Sources: clean-code L9.

### m11 — `fulfillment-board.tsx` `post` reads `payload.error` without a fallback
`src/components/fulfillment-board.tsx:47`
`setMessage(response.ok ? success : payload.error)`. If a non-OK response has no JSON body or a different error shape, `payload.error` is `undefined` and the message renders the literal `"undefined"`. Sibling `admin-order-actions.tsx` guards this case.
Sources: clean-code L10.

### m12 — Silent cap on backfill batch (`take: 200`)
`src/domain/package-operations.ts` (`materializeMissingFinalizedOrders`)
`take: 200` with no indication to the caller that more remain. A backlog >200 silently leaves orders un-materialized across page loads.
Sources: rules L5.

### m13 — Copy-paste naming in smoke harness
`scripts/p7-smoke.ts`
`authSecret = "p5-local-smoke-signing-key-2026"` keeps the `p5` prefix from the prior phase's smoke script. Functional but misleading in a P7 artifact.
Sources: rules L7.

## Notes (carried, not findings)

- `package-stage.ts` transition table keeps `SENT`/`PICKED_UP` terminal and never auto-advances on print; `print-batches.ts` never calls `advancePackageStage`. P7 invariant #6 (printing ≠ shipped) is respected in code.
- Nightly idempotency via `runKey` unique + `P2002` catch in `createNightlyPrintBatch` is sound; S3 smoke asserts replay equality.
- `splitPackage`/`regroupPackages` both write `PackageAudit` rows; S1 smoke asserts retained audits. Audit retention invariant met.
- `bulkAdvancePackageStage` server-side cap and `advancePackageStage` transition allow-list + optimistic version guard are correctly enforced.
- `renderArtifactPdf` hand-rolled PDF: `escapePdfText` escapes `\()`; content-disposition filename reduced to `[a-z0-9-]`. No injection vector found in the P7 payload path (the non-ASCII strip in B2 is a separate data-loss issue, not an injection).
