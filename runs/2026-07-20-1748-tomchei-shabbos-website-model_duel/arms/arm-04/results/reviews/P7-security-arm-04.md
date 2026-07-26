# P7 Security Review — arm-04 (blind)

**Scope:** P7 delta only (package board, split/regroup, stage machine, channel dashboard, nightly print batch, reprints, group/order PDF routes).
**Method:** static read of `src/app/(admin)/admin/fulfillment/**`, `src/app/(admin)/admin/orders/[orderId]/print/**`, `src/lib/fulfillment/**`, `src/lib/print/**`, `src/lib/admin/bulk-report.ts`, `src/lib/auth/permissions.ts`, `prisma/migrations/20260727000000_p7_print_batches/migration.sql`. No fixes written; no scope beyond P7.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 3 |

The packing path is well-gated. `fulfillment.manage` is its own permission, separate from `orders.manage`, and granted to STAFF/MANAGER only (`permissions.ts:34`); DRIVER is reduced to `routes.drive` and gets 403 on both the board and the PDF routes (smoke S3e confirms the route re-checks rather than trusting the link). Every state-mutating action — `advanceStageAction`, `bulkStageAction`, `editPackageAction`, `buildBatchAction`, `reprintGroupAction`, `reprintOrderAction` — calls `requirePermission('fulfillment.manage')` first. Printing never writes a stage; the only trace a render leaves is a `print.rendered` audit row, and the slip footer says so (G-002/G-004 hold). The hand-written PDF writer escapes `(`, `)`, `\` and replaces non-latin-1 with `?` (`pdf.ts:101`), and `fileNameFor` slugs the download name (`print-service.ts:446`), so no PDF/content-disposition injection from recipient or greeting input. `movePackageLines` correctly enforces `source.orderId === target.orderId` and refuses SENT/PICKED_UP targets via `readEditablePackage` (`package-edit.ts:107`), and `movingLines` verifies every posted line id belongs to the source — no moving arbitrary lines from other orders. Nightly idempotency rests on `printItems: { none: { group: { batch: { kind: 'NIGHTLY' } } } }` plus a `pg_advisory_xact_lock` so two overlapping runs queue rather than double-file. `boundedIds` dedupes and caps the sweep at 100. `version(formData)` returns 0 for a missing/mangled field, and no row holds 0 (`Package.version @default(1)`), so a tampered form fails the optimistic check rather than skipping it.

The one Major is a real concurrency hole in the stated invariant; the Minors are least-privilege scoping gaps that don't reach escalation.

## Major

### M1 — `movePackageLines` never claims or bumps the target package's version
`src/lib/fulfillment/package-edit.ts:115` claims the source's version (`claimPackageVersion(tx, input.fromPackageId, input.expectedVersion)`) but the target is only read by `readEditablePackage` (`:108`) and never version-claimed. The line move is `tx.orderLine.updateMany({ where: { id: { in: moving } }, data: { packageId: target.id } })` (`:117`) — no version bump on the target. When the source is emptied, the target's fee is overwritten with `target.fulfillmentFeeCents + source.fulfillmentFeeCents` (`:138-141`) using the snapshot read at the top of the transaction, again with no version increment.

The status doc claims as decision 10: *"Every package edit posts the version it was drawn with. The second person to press a button on a stale screen is told to reload rather than obeyed."* This holds for the source and for `advancePackageStage`/`splitPackage`, but not for the target of a move. Two packers moving lines into the same target box, or a packer moving lines while another advances the target's stage, both succeed against a stale target version. Under READ COMMITTED (Prisma default) the fee `update` is a lost update: a concurrent edit to the target's fee or stage lands first, this transaction's snapshot is unaffected, and the overwrite commits on top. The audit trail records `package.regrouped` on the target and `package.stage_changed` on the target from the other actor, with no conflict reported and the target's `version` unchanged by the regroup — so the next person to open the target sees a contents/fee that don't match the version they were handed. At the G-024 crunch target (5k packages, 10 concurrent staff on one board) this is the realistic collision, not a theoretical one. The target's `version` must be claimed and incremented the same way the source's is.

## Minor

### m1 — `advancePackageStage` / `bulkAdvanceStage` do not scope by season or order status
`src/lib/fulfillment/packages.ts:24` reads the package by bare `id` with no `order: { seasonId, status: { in: [...] } }` filter; `bulk-stages.ts:40` likewise `db.package.findMany({ where: { id: { in: ids } } })`. The board UI scopes to `PLACED | IN_FULFILLMENT | COMPLETED` via `boardScopeWhere` (`channel-summary.ts:44`), but the actions do not, so a packer who posts a package id from a CANCELLED order or a past season can advance its stage. IDs are `uuid()` so enumeration is hard, and `fulfillment.manage` is the broad packing permission, so this is a least-privilege gap, not a breach. Worth a `boardScopeWhere(seasonId)` clamp on both read paths so the action cannot drift past what the list would show.

### m2 — Print and package-detail reads are not scoped by season (cross-season IDOR for `fulfillment.manage`)
`renderGroupArtifact` (`print-service.ts:257`) looks the group up by `id + batchId` with no season check; `renderOrderArtifact` (`:287`) reads packages by bare `orderId`; `readPackageDetail` (`package-board.ts:155`) reads by bare `packageId`. A staff member holding `fulfillment.manage` can render PDFs (recipient name, full address, greeting message) or open the package detail for any season's batch/order/package by guessing the id. The dashboard only lists recent batches from the active season, so this is not reachable through the UI, but the routes themselves are unscoped. Same threat model as P6 m3 (`orders.view` reading any order by id) — permission-gated, unguessable ids, low risk; flagging because the brief asked specifically about IDOR on packages/orders/PDF routes.

### m3 — `reprintOrder` / `reprintGroup` accept any orderId / batchId without season or status scoping
`print-service.ts:198` (`reprintOrder`) reads the order by bare id and builds a reprint batch off `order.seasonId` — so a packer can create a reprint batch for an order in a past season, or for a CANCELLED/DRAFT order (a DRAFT has no packages and returns `NOTHING_TO_PRINT`, but a CANCELLED order with leftover packages would reprint). `reprintGroup` (`:139`) reads the group by `id + batchId` and creates the reprint in the original batch's season with no check that the original is in the active season. Both are audited (`print.batch_created`), both are `fulfillment.manage`-gated, both produce paper that the board would not have offered. Low impact, but the action should refuse anything the nightly build would have refused.

## Out of scope (noted, not scored)

- `buildNightlyBatch`'s advisory lock key is `hashtext('print.nightly-batch')` — a fixed string, so nightly builds across all seasons serialize on the same lock. A performance concern at multi-season scale, not a security finding.
- The `packages.bulk_stage` audit row uses `entityId: report.batchId` where `batchId` is a synthetic `randomUUID()` from `bulk-stages.ts:37`, not a `PrintBatch` row. Fine for correlation; not a security issue.
- `bulkAdvanceStage` reads versions itself and passes them into `advancePackageStage`, which re-checks via `updateMany ... where version: expectedVersion`. The read-then-claim window is safe because the claim is atomic — a concurrent bump yields `moved.count === 0` and is reported as `conflict`, not silently applied. This is the deliberate exception the status doc calls out (decision 10) and it is correct.
- `filingGroupOf` buckets by `pickupLocationId` / `deliveryDay` / `methodCode` — all server-derived from the package row, not user-controlled in the filing key, so no key-collision injection.
- The `print.rendered` audit is written after the PDF is built but before the response leaves; a render that throws leaves no audit row, which is acceptable (nothing was produced).
