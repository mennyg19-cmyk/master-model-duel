# Reviewer specialist — Quality

**Arm:** `arm-03`
**Tree / phase:** P2 — Domain core (seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine)
**Output:** `results/reviews/P2-quality-arm-03.md`
**Reviewer focus:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P2-EXPECTED.md`.

Evidence reviewed: `prisma/schema.prisma`, `prisma/migrations/20260721174000_p2_domain/migration.sql`, `scripts/seed.ts`, `src/lib/orders/{finalize,grouping,state-machine,package-stages,draft-wire}.ts`, `src/lib/inventory/reserve.ts`, `src/lib/customers.ts`, `scripts/domain-p2.test.ts`, `.scratch/PHASE-P2-SMOKE.md`, `.scratch/PHASE-P2-STATUS.md`.

Smoke status (self-reported): S1–S5 PASS, `npm run test:domain-p2` exit 0. Findings below are against EXPECTED and code, not against the self-report.

## Findings

### F1 — `finalizeOrder` never materializes Packages (missing flow vs EXPECTED #4, blocker)
`src/lib/orders/finalize.ts:34-74` flips `Order.status` to `PLACED`, claims an order number, and writes an `AuditLog` — nothing else. It never reads the order's `OrderLine`s, never calls `groupLinesByKey`, and never creates `Package`/`PackageItem` rows. The `groupingKey` column on `OrderLine` and the entire `Package`/`PackageItem`/`PackageAuditLog` schema (EXPECTED #4 — "Package entity: recipient/address/method/greeting grouping key") is dead data. UR-001's keystone invariant (one finalized order → its lines belong to exactly one package per grouping key) is unimplemented, not deferred-with-stub. The S2 smoke only exercises the pure `buildGroupingKey`/`groupLinesByKey` helpers in `scripts/domain-p2.test.ts:14-40`; no test asserts a Package is created on finalize.

### F2 — `finalizeOrder` never reserves inventory (missing flow vs EXPECTED #8, blocker)
`src/lib/inventory/reserve.ts` ships a working atomic `UPDATE ... WHERE (onHand - reserved) >= qty` and is exercised standalone by S5 (`domain-p2.test.ts:136-177`), but `finalizeOrder` never calls `reserveInventory`/`reserveInventoryWithClient` for the order's products/add-ons. A finalized `PLACED` order carries zero reservations; the reserve engine is decoupled from the only code path that should claim stock. EXPECTED #8 requires "Order state machine + finalize + discard; concurrency via row-level locking / optimistic versioning on inventory ... mutations" — the inventory half is wired only to a test, not to finalize.

### F3 — Package stage transition + optimistic versioning unimplemented (stub vs EXPECTED #8, blocker)
`src/lib/orders/package-stages.ts` only exposes `canTransitionPackage`/`assertPackageTransition` — pure predicates. There is no `transitionPackageStage` that flips `Package.stage`, writes a `PackageAuditLog` row, or compares `Package.version` for optimistic concurrency. The `PACKAGE_STAGE_CHANGED` enum value was added to `AuditAction` in the migration (line 36) but is never written anywhere. `Package.version` exists in schema but no P2 code path reads it. The "optimistic versioning on package mutations" half of EXPECTED #8 is unimplemented.

### F4 — No partial unique index enforcing NEW-package merge (latent race / data integrity)
Because of F1 the merge path is dormant, but the schema already lacks the guard EXPECTED #4/#11 imply: there is no partial unique index on `("groupingKey") WHERE "stage" = 'NEW'` (and `Package` has no `seasonId` column at all — see F5). When package materialization is wired in, two concurrent finalizations of **different** orders sharing a grouping key will both `findFirst` no NEW package and both `create` one, producing duplicate NEW packages for the same key — the symmetric race to the reserve-engine race EXPECTED #11 calls out, untested. Add the partial unique index and use `upsert`/insert-on-conflict.

### F5 — `Package` has no `seasonId`; merge lookup cannot be scoped to a season (design)
`schema.prisma:434-462` reaches the season only via `Package.orderId → Order.seasonId`. A merge query "find the open NEW package for this grouping key in this season" cannot be expressed without a join, and a `findFirst({ where: { groupingKey, stage: 'NEW' } })` with no season filter could merge packages across seasons for the same recipient/address/method/greeting. Denormalize `seasonId` onto `Package` (with FK + index) before wiring materialization.

### F6 — `ShippingQuote` has no `packageId` (data integrity vs EXPECTED #5)
`schema.prisma:528-542` attaches a quote only to `orderId`. A multi-package order cannot carry per-package shipping quotes; the quote-to-shipment link EXPECTED #5 implies ("shipping quotes with expiring options") is missing. arm-02 shipped both `orderId`/`packageId` nullable with no CHECK; arm-03 dropped `packageId` entirely. Add `packageId` (nullable) plus a CHECK that at least one of `orderId`/`packageId` is set, mirroring the `InventoryItem_target_xor_check` pattern.

### F7 — S4 smoke does not test same-draft collision (missing smoke vs EXPECTED #10)
`domain-p2.test.ts:55-134` finalizes 8 **distinct** drafts concurrently and asserts the resulting numbers are unique and sequential. It never asserts that two concurrent `finalizeOrder` calls on the **same** draft yield exactly one winner and one failure. EXPECTED #10 explicitly requires "concurrent finalizations don't double-claim an order number"; the double-claim guarantee is untested. Note: because `claimNextOrderNumber` and the guarded status flip both run inside one `db.$transaction`, a loser rolls back the counter increment — so no permanent gap is expected here, but the test should assert it.

### F8 — Cached `paymentStatusCached` is never recomputed (stub)
`Order.paymentStatusCached` defaults to `UNPAID` and no P2 code path updates it — there is no `recalcPaymentStatus` helper in arm-03 (unlike arm-02). The column is dead weight this phase. Acceptable as a placeholder, but flag it in `PHASE-P2-STATUS.md` so the payments phase knows to wire it.

### F9 — Seed order idempotency uses `findFirst` + `startsWith` on a random suffix (quality)
`scripts/seed.ts:350-392` guards order creation with `findFirst({ where: { draftRef: { startsWith: "D-2026-SEED" } } })` while the `draftRef` itself is `formatDraftRef(2026, 'SEED' + randomBytes(3))`. `findFirst` has no `orderBy`, so if two seed drafts ever coexist the re-seed picks an arbitrary one; and the `startsWith` guard is the only thing preventing duplicate drafts under concurrent seed runs. Every other seed fixture uses a deterministic key (`savedAddress.id = "seed-addr-customer-home"`); the order should too — fixed `draftRef` or a deterministic `id`.

### F10 — `OrderLine.productOptionId` is `ON DELETE SET NULL` but `optionAdjustCents` snapshot stays (data integrity, minor)
`schema.prisma:409` and migration line 627 set `ON DELETE SET NULL` for `OrderLine.productOptionId`. Deleting a `ProductOption` orphans the link while `optionAdjustCents` remains on the line, so the order total is still correct (snapshot model) but audit/replay loses the option reference. Acceptable for a snapshot, but worth a `RESTRICT` while options are referenced by active orders, or document the snapshot-only contract.

## Summary

- **Blockers (missing flow vs EXPECTED):** F1, F2, F3
- **Latent race / design:** F4, F5
- **Data integrity:** F6, F10
- **Missing smoke:** F7
- **Stubs / dead code:** F8
- **Seed / quality:** F9

Finding count: **10**

Severity counts:
- Blocker: 3 (F1, F2, F3)
- Major: 3 (F4, F5, F6)
- Minor: 4 (F7, F8, F9, F10)
