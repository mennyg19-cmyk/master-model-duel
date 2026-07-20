# Reviewer specialist — Quality

**Arm:** `arm-02`
**Tree / phase:** P2 — Domain core (seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine)
**Output:** `results/reviews/P2-quality-arm-02.md`
**Reviewer focus:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P2-EXPECTED.md`.

Evidence reviewed: `prisma/schema.prisma`, `prisma/migrations/20260720180500_p2_domain_core/migration.sql`, `prisma/seed.ts`, `lib/domain/{finalize,grouping,inventory,order-numbers,order-state,draft-reference,payment-status}.ts`, `lib/customers.ts`, `tests/{domain-db,grouping,order-state,permissions}.test.ts`, `.scratch/PHASE-P2-SMOKE.md`, `.scratch/PHASE-P2-STATUS.md`, `.scratch/p2-ci-output.log`.

Smoke status (self-reported): S1–S5 PASS, `npm run ci` exit 0, 19/19 tests pass. Findings below are against EXPECTED and code, not against the self-report.

## Findings

### F1 — Order-number gap on losing concurrent finalize (correctness)
`lib/domain/finalize.ts:22-29` calls `claimNextOrderNumber` (which atomically increments `Season.orderCounter` under a row lock) **before** the guarded status flip `tx.order.updateMany({ where: { id, status: "DRAFT" } })`. When two requests finalize the same draft, both pass `assertTransition`, both claim a distinct number, then only one `updateMany` returns `count === 1`; the loser throws — but the Season counter was already incremented, permanently wasting a number.

The S4 test `double finalize of the same order: exactly one wins` only asserts `fulfilled.length === 1`; it does not assert the counter stayed gap-free. EXPECTED #10/#S4 require "concurrent finalizations → unique sequential numbers" and the spec framing (R-151) implies no-gap numbering; a gap on every collision is a real defect.

Fix: flip status first (guarded `updateMany`, abort on `count !== 1`), then `claimNextOrderNumber` inside the same transaction. The Season row lock still serializes the counter; the loser now aborts before touching it.

### F2 — Package merge is not concurrency-safe (correctness / race)
`lib/domain/finalize.ts:72-90` does `tx.package.findFirst({ where: { seasonId, groupingKey, stage: "NEW" } })` then `tx.package.create(...)` with no lock, no `upsert`, and no unique constraint. Two concurrent finalizations of **different** orders sharing a grouping key can both find no NEW package and both create one, producing two NEW packages for the same `(seasonId, groupingKey)` — the exact opposite of the merge guarantee UR-001 is built on.

The S2 merge test (`same grouping key merges packages across orders`) runs `await finalizeOrder(first.id); await finalizeOrder(second.id); …` sequentially, so it never exercises this race. EXPECTED #11 explicitly calls out a concurrency race for the reserve engine; the package-merge race is the symmetric one and is untested.

Fix: add a partial unique index `CREATE UNIQUE INDEX ... ON "Package"("seasonId","groupingKey") WHERE "stage" = 'NEW'` and use `upsert` (or insert-on-conflict) so the second finalize joins the existing NEW package instead of creating a duplicate.

### F3 — `findFirst` is non-deterministic when duplicate NEW packages exist (correctness)
`lib/domain/finalize.ts:72` uses `findFirst` with no `orderBy`. If F2 ever produces multiple NEW packages for one key, the line batch attaches to an arbitrary one. Even without F2, determinism matters for replay/audit. Add `orderBy: { createdAt: "asc" }` so the oldest NEW package wins, and resolve F2 so the case can't arise.

### F4 — `finalizeOrder` never reserves inventory (missing flow vs EXPECTED #8)
The reserve engine (`lib/domain/inventory.ts`) exists and is exercised standalone by S5, but `finalizeOrder` never calls `reserveInventory` for the order's products/add-ons. EXPECTED #8 states "Order state machine + finalize + discard; concurrency via row-level locking / optimistic versioning on inventory and package mutations." Inventory is untouched on the only code path that should claim stock, so the engine is decoupled from finalize and a finalized order carries no reservation. Either wire `reserveInventory` into `finalizeOrder` (per line, gated on `product.trackInventory`/`addOn.trackInventory`) or document the deferral to a later phase in `PHASE-P2-STATUS.md`.

### F5 — `Package.version` optimistic locking is unused (stub vs EXPECTED #8)
`Package.version` and `InventoryItem.version` exist, but no P2 code path reads `version` for optimistic concurrency on Package. There is no stage-transition function at all in P2, so the "optimistic versioning on package mutations" half of EXPECTED #8 is unimplemented, not just deferred-with-stub. `InventoryItem.version` is incremented in the raw `UPDATE` but never compared. Either ship a minimal `transitionPackageStage` that uses `version`, or mark `version` as reserved-for-future in the status doc so EXPECTED #8 isn't claimed as done.

### F6 — `recalcPaymentStatus` is dead code (stub)
`lib/domain/payment-status.ts` recomputes `Order.paymentStatus` but is called from nowhere in P2. The cached `paymentStatus` column therefore never changes from its `UNPAID` default. Acceptable as a placeholder, but it is currently unreachable; flag for the payments phase so it isn't forgotten.

### F7 — `ShippingQuote` permits neither orderId nor packageId (data integrity)
`schema.prisma:407-417` makes both `orderId` and `packageId` nullable with no CHECK. A quote attached to nothing is meaningless and will orphan on cleanup. Add a CHECK that at least one is set (`("orderId" IS NOT NULL) OR ("packageId" IS NOT NULL)`), mirroring the `InventoryItem_target_xor` pattern already in the migration.

### F8 — No uniqueness on per-line option/add-on snapshots (data integrity)
`OrderLineOption(orderLineId, productOptionId)` and `OrderLineAddOn(orderLineId, addOnId)` have no `@@unique`. Duplicate rows on the same line are not prevented at the DB level; price-snapshot aggregation could double-count an add-on or option. Add `@@unique([orderLineId, productOptionId])` and `@@unique([orderLineId, addOnId])`.

### F9 — Missing FK indexes (quality / performance)
Prisma does not auto-create indexes on scalar FK columns. The migration adds explicit indexes only for `PackageAudit` and `CronRunLog`. `Payment.orderId`, `OrderLine.orderId`, `OrderLineOption.orderLineId`, `OrderLineAddOn.orderLineId`, `StripePaymentIntent.orderId`, `ShippingQuoteOption.quoteId`, `OrderLine.packageId`, `PackageAudit.packageId` (composite, ok), and `OrderLine.fulfillmentMethodId` are all unindexed. Will degrade list/lookup queries at scale. Add `@@index` for the hot FKs.

### F10 — Seed idempotency gap for `AddOnRestriction` (regression risk)
`prisma/seed.ts:90-100` upserts the add-on with a nested `restrictions: { create: { productId } }`. Nested `create` only runs on the upsert's **create** branch. On a re-seed where the AddOn already exists but its restriction row was deleted, the restriction is never recreated. The later `if (existingOrder) return` only short-circuits when an order already exists, so a partially-seeded DB (product+addOn present, order deleted) silently loses the restricted-add-on fixture that S1 relies on. Either move the restriction into its own upsert keyed on `(addOnId, productId)`, or guard it explicitly.

### F11 — `recalcPaymentStatus` COMPED edge on zero-total orders (correctness edge)
`lib/domain/payment-status.ts:20` short-circuits `postedTotal <= 0 → UNPAID` before comparing to `totalCents`. A free order (`totalCents === 0`) with no payments is therefore marked `UNPAID` forever instead of `PAID`/`COMPED`. Minor edge; may not occur in practice, but the branch order is wrong — compare against `totalCents` first.

### F12 — `OrderLine.packageId` is `ON DELETE SET NULL`, breaking the finalize invariant (design)
`schema.prisma:299` and migration line 456 set `ON DELETE SET NULL` for `OrderLine.packageId`. Deleting a Package silently orphans its lines from any grouping. Once an order is finalized, its lines must belong to exactly one package (UR-001 keystone invariant); SET NULL can break that invariant without an audit trail. Consider `ON DELETE RESTRICT` (force explicit re-group) or a re-group-on-delete path.

## Summary

- **Blockers (correctness/race vs EXPECTED):** F1, F2, F4, F5
- **Data integrity:** F7, F8, F12
- **Quality / determinism:** F3, F9
- **Stubs / dead code:** F6, F11
- **Regression / seed:** F10

Finding count: **12**
