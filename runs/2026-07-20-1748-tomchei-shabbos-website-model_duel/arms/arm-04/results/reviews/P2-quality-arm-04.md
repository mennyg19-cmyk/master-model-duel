# P2 Quality review — arm-04 (blind)

Reviewer: external quality specialist. Scope: P2 delta + regressions vs `shared/phases/PHASE-P2-EXPECTED.md`.
Source read: `prisma/schema/*.prisma`, `prisma/migrations/20260726131500_p2_domain_core/migration.sql`, `src/lib/{orders,fulfillment,inventory,seasons,geocode-cache,core/normalize}.ts`, `scripts/{smoke-p2,migration-guard}.ts`, `prisma/seed-domain.ts`, `tests/*.test.ts`, `.scratch/PHASE-P2-{SMOKE,STATUS}.md`.

## Verdict

No blockers. Schema, grouping engine, state machine, finalize, reserve, and concurrency are implemented and tested. 18/18 smoke checks pass; 42 new tests cover grouping, state machine, lifecycle, order numbers, inventory race, scheduled jobs, geocode TTL, draft references. All 11 EXPECTED items have evidence. No stubs, no TODOs, no dead UI routes. P2 ships schema + engine only; no storefront/admin routes added (matches EXPECTED out-of-scope).

## Findings

### Major

1. **Forward order lifecycle untested at service level** — `tests/order-lifecycle.test.ts` exercises DRAFT→DISCARDED and PLACED→CANCELLED via `transitionOrder`, but never PLACED→IN_FULFILLMENT→COMPLETED. The pure `canTransitionOrder` is tested, but the service path (audit row, version bump, status write) for forward progress is unverified. A regression in `transitionOrder` that only affects forward moves would land green in P2 and surface in P5+. `src/lib/orders/order-service.ts:102`.

### Minor

2. **`InventoryItem.version` is dead code** — `reserve.ts:33,50` increment `version` on every reserve/release, but neither function reads it. Concurrency is enforced by the conditional UPDATE (row lock) + the `onHand - reserved >= quantity` predicate, not by optimistic versioning. EXPECTED item 8 says "row-level locking / optimistic versioning" — inventory uses row locking only. The `version` column is misleading dead schema. `prisma/schema/inventory.prisma:18`.

3. **Migration guard ignores CHECK constraints** — `scripts/migration-guard.ts` runs `prisma migrate diff`, which does not compare CHECK constraints. The two hand-written constraints (`InventoryItem_single_target`, `InventoryItem_reserved_within_on_hand`, `migration.sql:652,655`) are covered by dedicated tests (`tests/inventory.test.ts:89,104`) but not by the guard. Deleting them from the migration would pass `db:guard`. Status doc acknowledges this; flagging so P5+ doesn't silently regress.

4. **`Product.replacedByProductId @unique` enforces 1:1 replacement** — `prisma/schema/catalog.prisma:62`. A product can be the replacement target for at most one prior product. P10's "replacement mappings per catalog item with cross-season chain resolution" (R-048) is defensible as a 1:1 chain, but if repeat-order ever needs many→1 (two discontinued items both map to this year's deluxe basket), this constraint blocks it and requires a migration. Acceptable for P2; revisit when P10 design firms up.

5. **Add-on inventory reservation untested** — `seed-domain.ts:336` creates an order line with a wine add-on (onHand=60), so `inventoryDemandOf` (`order-service.ts:177`) walks the add-on path at finalize, but no test asserts the add-on's `InventoryItem.reserved` after finalize. The product reservation is asserted (`order-lifecycle.test.ts:147`); the add-on path is exercised only by the seed.

6. **`OrderLine.optionsSnapshot` never populated or tested** — `prisma/schema/orders.prisma:93` defaults to `[]`. Seed and fixtures never set it. No test creates a line with a chosen `ProductOption`. The priced-option path (smoke P2-1 only checks the catalog has options) is untested through finalize. P4/P5 will exercise it; flagging the P2 coverage gap.

7. **`recomputeOrderPaymentStatus` is not concurrency-safe** — `src/lib/orders/payment-status.ts:17` reads posted payments, computes status, writes the order row with no transaction or row lock. Two concurrent payment postings that each trigger a recompute can both read a partial set and the last writer wins, leaving the cache stale until the next recompute. P2 ships no payment service layer (status doc defers to P5), so this is not exercised now; heads-up for P5 wiring.

8. **`Payment.reference` has no uniqueness** — `prisma/schema/orders.prisma:157`. Duplicate check numbers or POS receipt ids are allowed by the schema. Dedup is a P5/P6 concern, but the schema offers no guardrail today.

9. **No index on `Season.opensAt`/`closesAt`** — `src/lib/seasons.ts:21,30` queries `where: { opensAt: { lte: now } }` and `closesAt: { lte: now }` with no supporting index. Full scan is fine for ~2 seasons; will matter once multi-year archives accumulate.

## Counts

Blockers: 0  ·  Major: 1  ·  Minor: 8
