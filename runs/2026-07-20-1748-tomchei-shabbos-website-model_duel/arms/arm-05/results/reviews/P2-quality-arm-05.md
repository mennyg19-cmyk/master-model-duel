# P2 Quality Review — arm-05 (blind)

**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Reviewer specialist:** Quality
**Scope:** correctness vs `shared/phases/PHASE-P2-EXPECTED.md`, schema completeness, engines, dead stubs. Findings only — no fixes.
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P2

## Summary

P2 lands the full domain schema (Season, Product/Option/AddOn/Replacement, Customer/Address, Order tree, Package/PackageLine/PackageAudit, Payment/StripePaymentIntent, ShippingQuote, PickupLocation, PackageType/ShipmentBox, InventoryItem/InventoryReservation, GeocodeCache, CronRunLog, Ingredient/ProductIngredient/AssemblyBatch/AssemblyBatchItem) plus a working grouping engine, order state machine with row-locked seasonal numbering, and atomic inventory reservation. Migration + seed + unit tests pass per the smoke doc. The EXPECTED checklist is largely satisfied. Findings below focus on concurrency gaps, partial test coverage, and weak smoke proof.

## Findings

### M1 — `discardOrder` is not concurrency-safe (no optimistic versioning)

- **Severity:** Medium
- **Location:** `lib/orders.ts:47-56`
- **Claim:** `discardOrder` reads the order, checks status, then issues a plain `prisma.order.update`. The status check and the write are not atomic, and unlike `finalizeOrder` there is no `version` guard in the update. Two concurrent discards (or discard racing a finalize) can both succeed or overwrite each other.
- **Evidence:** `finalizeOrder` (lines 16-45) uses `transaction.order.updateMany({ where: { id, status: "DRAFT", version: order.version }, ... })` and throws if `claimed.count !== 1`. `discardOrder` (lines 47-56) does `prisma.order.findUnique` then `prisma.order.update({ where: { id }, data: { status: "DISCARDED", version: { increment: 1 } } } })` with no version predicate. The `version` increment is written but never checked.
- **EXPECTED ref:** #8 "concurrency via row-level locking / optimistic versioning on inventory and package mutations" — the order state machine is in scope and discard is half of it.

### M2 — No optimistic-versioning helper for Package mutations

- **Severity:** Medium
- **Location:** `lib/packages.ts` (entire file); `prisma/schema.prisma:308-335` (`Package.version` field)
- **Claim:** The `Package` model declares `version Int @default(1)` but no helper exercises it. The only P2 package code is the pure `groupPackageCandidates` function. There is no `updatePackage` / `advancePackageStatus` / `splitPackage` helper that performs an optimistic-versioned write, so the concurrency requirement on package mutations is unproven at the engine layer.
- **Evidence:** `lib/packages.ts` exports only `PackageCandidate`, `createPackageGroupingKey`, and `groupPackageCandidates` — all pure, no DB access. No test references `Package.version`. Plan P2 deliverable: "concurrency: row-level locking / optimistic versioning on inventory and package mutations" — inventory has `reserveInventory` (row-locked UPDATE...RETURNING); packages have nothing equivalent.
- **Note:** Package materialization UI is P7, but the schema field is present and unused now, and the plan puts the concurrency primitive in P2.

### L1 — Grouping engine test only varies `greeting`

- **Severity:** Low
- **Location:** `tests/domain-core.test.ts:8-18`
- **Claim:** The grouping test asserts that an identical key merges and a differing greeting splits, but it never asserts that differing `recipientKey`, `addressId`, or `fulfillmentMethodId` each produce a separate group. A regression that drops one of those fields from the key would not be caught.
- **Evidence:** All three candidates use `recipientKey: "rachel"`, `addressId: "address-1"`, `fulfillmentMethodId: "delivery"`; only `greeting` changes. `createPackageGroupingKey` (`lib/packages.ts:8-15`) does include all four fields, but the test does not verify the other three independently.
- **EXPECTED ref:** #10 / S2 "grouping key combines same recipient/address/method/greeting and splits differing greeting" — only the greeting-split half is asserted; the combine half is implicit.

### L2 — `smoke-p2.ts` S1 proof does not verify seed entities exist

- **Severity:** Low
- **Location:** `scripts/smoke-p2.ts:3-13`
- **Claim:** The smoke script runs `prisma migrate deploy`, `prisma generate`, `tsx prisma/seed.ts`, then the test file, then unconditionally prints "S1 migrations and seed passed." It never queries the database to confirm a Season, Product, Customer, and Order actually exist. The proof rests entirely on the seed script not throwing.
- **Evidence:** Lines 4-7 invoke the commands; lines 8-12 are bare `console.log` labels. No `prisma.season.findFirst` / `prisma.product.findFirst` / `prisma.customer.findFirst` / `prisma.order.findFirst` assertions. The smoke doc `PHASE-P2-SMOKE.md` S1 row claims "seed completed" based on this.
- **EXPECTED ref:** S1 "season, catalog, customer, order exist" — verification is indirect.

### L3 — `InventoryReservation` has no link to `OrderLine`

- **Severity:** Low
- **Location:** `prisma/schema.prisma:462-474`; `lib/inventory.ts:4-31`
- **Claim:** `InventoryReservation` references `OrderLineAddOn` and `Order` but not `OrderLine`. Main-product (package) reservations cannot be tied to a specific order line, only to the order. `reserveInventory` only accepts `orderId`, not `orderLineId`.
- **Evidence:** Schema fields are `inventoryItemId`, `orderLineAddOnId`, `orderId`, `quantity`. No `orderLineId`. The add-on side has a per-line link; the main-line side does not. This asymmetry will complicate per-line release on discard/cancel in P5.
- **Note:** May be deferred to P5 wiring, but the schema gap is present now.

### L4 — `Customer` allows neither email nor phone

- **Severity:** Low
- **Location:** `prisma/schema.prisma:200-211`
- **Claim:** Both `emailNormalized` and `phoneNormalized` are nullable and unique. A customer row can exist with neither field set, which defeats the "normalized phone/email dedupe" goal for any such row.
- **Evidence:** `emailNormalized String? @unique`, `phoneNormalized String? @unique`. Postgres allows multiple NULLs on unique indexes, so multiple unidentified customers coexist. No CHECK constraint forces at least one identifier.
- **EXPECTED ref:** #2 "Customer model with normalized phone/email dedupe" — dedupe works when populated, but the schema permits a hole.

## Notes (informational, not findings)

- **N1 — Season auto-flip is schema-only.** `Season.opensAt`/`closesAt` exist but no cron or function flips `status`. Plan defers UR-008 management to P10, so schema support is sufficient for P2. Not a defect.
- **N2 — No dead stubs in P2 scope.** `lib/orders.ts`, `lib/packages.ts`, `lib/inventory.ts` all implement real logic; no `throw new Error("not implemented")` / TODO placeholders.
- **N3 — `Order` state machine treats FINALIZED as terminal.** `allowedTransitions.FINALIZED = []` (lib/orders.ts:6); the test confirms `FINALIZED → DISCARDED` is rejected. Discard is DRAFT-only by design. Acceptable interpretation of "finalize + discard", though P5 may need a finalized-order cancellation path.
- **N4 — Inventory XOR CHECK constraint is correct.** `("productId" IS NULL) <> ("productAddOnId" IS NULL)` (migration.sql:328-329) rejects both-NULL and both-set, allows exactly one. Combined with the two partial unique indexes, the integrity goal is met.
- **N5 — P2 scope respected.** No storefront/admin catalog UI, cart, checkout, POS, printing, labels, routes, or BOM UI added. `app/` tree remains P1-only (admin, staff, audit, health, setup, client-error).

## Counts

- Critical: 0
- High: 0
- Medium: 2
- Low: 4
- Informational: 5
- **Total findings: 6**
