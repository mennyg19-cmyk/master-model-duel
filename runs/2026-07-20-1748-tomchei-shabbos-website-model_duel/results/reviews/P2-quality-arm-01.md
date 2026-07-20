# P2 Quality review — arm-01

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Arm: `arm-01`
Phase: P2 — Domain core (seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine)
Reference: `shared/phases/PHASE-P2-EXPECTED.md`
Reviewer focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

## Summary

The P2 schema and domain engine are largely complete and the smoke doc
reports S1–S5 passing. The findings below are quality gaps: two unit tests
that give false confidence by exercising stub classes instead of production
code, untested state-machine paths, a missing DB-level invariant, a
schema/migration drift, and minor CHECK-constraint gaps.

Findings: **8**

## Findings

### F1 — Concurrency unit test exercises a stub allocator, not `finalizeOrder`
**Severity: medium · Type: false-confidence test**

`tests/domain-core.test.ts:75` "concurrent finalizations receive unique
sequential order numbers" tests `OrderNumberAllocator`
(`src/domain/order-engine.ts:95`), an in-memory promise-queue that has no
relationship to the production `claimOrderNumber` / `finalizeOrder` path.
The real invariant — Serializable transaction + `updateMany` guard on
`status: DRAFT, orderNumber: null` — is only exercised by the S4 smoke
(`.scratch/p2-smoke.ts`). The unit test would pass even if the DB claim
logic were broken. EXPECTED item 10 requires this invariant as a unit test;
the arm's unit test does not validate production behavior.

### F2 — Race unit test exercises a stub ledger, not `reserveInventory`
**Severity: medium · Type: false-confidence test**

`tests/domain-core.test.ts:85` "two reservations for the last finished
package allow only one winner" tests `InventoryReservationLedger`
(`src/domain/inventory.ts:35`), an in-memory queue, not the production
`reserveInventory` atomic `UPDATE ... WHERE "onHand" - "reserved" >= qty`
statement. The real race is only in S5 smoke. Same false-confidence pattern
as F1.

### F3 — `discardDraft` and `advancePackageStage` have no test coverage
**Severity: medium · Type: missing test**

`discardDraft` (`order-engine.ts:80`) and `advancePackageStage`
(`package-stage.ts:13`) are both part of the P2 contract (EXPECTED item 8:
order state machine + finalize + discard; item 4: package stage machine;
item 8: optimistic versioning on package mutations). Neither has a unit
test or smoke. The state-machine test only asserts DRAFT→FINALIZED and
FINALIZED→DRAFT rejection; DRAFT→CANCELLED (discard), FINALIZED→CANCELLED,
and all package-stage transitions are untested. A regression breaking the
`updateMany` version guard on packages would not be caught.

### F4 — `PackageAudit` write path untested
**Severity: low · Type: missing test**

`advancePackageStage` writes a `PackageAudit` row on every stage change.
Because the stage advance itself is untested (F3), no test asserts an audit
row is created with the correct `fromStage`/`toStage`/`actorStaffId`.

### F5 — No unique constraint on `Package(orderId, groupingKey)`
**Severity: medium · Type: unenforced invariant**

`Package` has `@@index([orderId, groupingKey])` (non-unique) at
`schema.prisma:390`. The grouping engine produces one package per
`(order, groupingKey)`, but nothing in the schema prevents two `Package`
rows with the same `(orderId, groupingKey)` from being inserted if the
grouping engine is ever bypassed (admin split/merge, future checkout
re-run). A `@@unique([orderId, groupingKey])` would enforce the invariant
the grouping key exists to protect.

### F6 — Schema/migration drift on `CustomerAccount.clerkUserId`
**Severity: medium · Type: schema drift**

`schema.prisma:88` declares `clerkUserId String? @unique` (nullable), but
the init migration creates the column as `TEXT NOT NULL`
(`20260720172337_init/migration.sql:29`) and the P2 migration does not
alter it. `prisma validate` and `prisma migrate status` (the two checks in
`npm run db:guard`) do not catch schema↔migration drift, so this passes CI
silently. The generated client types permit `null` while the DB rejects it.

### F7 — `Product.replacementProductId` self-relation has no self-cycle guard
**Severity: low · Type: data-integrity gap**

`Product.replacementProductId` is a self-relation
(`schema.prisma:212`). No CHECK constraint prevents `replacementProductId
= id` (self-cycle) or longer replacement cycles. A migration-level CHECK
(`"replacementProductId" IS NULL OR "replacementProductId" <> "id"`) would
match the integrity-bar set by the `InventoryItem_target_xor_check`.

### F8 — Inconsistent positivity / non-negativity CHECKs across quantity tables
**Severity: low · Type: schema inconsistency**

`OrderLine` and `OrderLineAddOn` enforce `quantity > 0` and
`InventoryItem` enforces `onHand >= 0 AND reserved >= 0`, but the BOM
tables added in P2 have no such guards:
- `ProductIngredient.quantity` (`schema.prisma:569`) — no `> 0` CHECK.
- `AssemblyBatchUse.quantity` (`schema.prisma:594`) — no `> 0` CHECK.
- `Ingredient.onHand` (`schema.prisma:558`) — no `>= 0` CHECK.

These are schema-only tables (EXPECTED item 7, UR-016 hidden at launch), so
the risk is low, but the inconsistency with the order/inventory tables is
real.

## Not findings (verified OK)

- Season open/closed + scheduled auto-flip fields present.
- Customer normalized email/phone dedupe (`@unique`) + address geocode fields.
- Order price snapshots, per-season numbering, draft wire format, cached
  payment status all present.
- Package grouping key, stage enum, fulfillment methods data-driven.
- Payments (stripe/cash/check/comp, posted/voided), Stripe PaymentIntent,
  shipping quotes with `expiresAt`, pickup locations, package types,
  shipment boxes.
- `InventoryItem_target_xor_check` + `InventoryItem_quantity_check` present.
- Geocode cache TTL (`expiresAt`) + `CronRun` log present.
- BOM/ingredient/assembly-batch tables schema-only, no UI — matches scope.
- Seed creates season + 2 catalog products + customer + address +
  fulfillment method + inventory + draft order (EXPECTED item 9).
- `finalizeOrder` retries on `P2034` (Serializable conflict); custom
  "lost a concurrent update" error is defensive and not a retry path.

## Evidence

- `prisma/schema.prisma`
- `prisma/migrations/20260720210000_p2_domain_core/migration.sql`
- `prisma/migrations/20260720172337_init/migration.sql`
- `prisma/seed.ts`
- `src/domain/order-engine.ts`, `src/domain/inventory.ts`,
  `src/domain/package-grouping.ts`, `src/domain/package-stage.ts`
- `tests/domain-core.test.ts`, `tests/permissions.test.ts`
- `.scratch/p2-smoke.ts`, `.scratch/PHASE-P2-SMOKE.md`,
  `.scratch/PHASE-P2-STATUS.md`
