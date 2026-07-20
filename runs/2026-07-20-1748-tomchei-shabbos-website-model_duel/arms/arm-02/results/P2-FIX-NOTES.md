# P2 fix notes — arm-02 (single fix pass)

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel · **Input:** `results/AGGREGATE-REVIEW-P2.md` (only doc read)
**Result:** `npm run ci` exit 0 — lint + typecheck + migration guard + **21/21 tests** (19 pre-fix + 2 new). Smoke S1–S5 re-run: all PASS (`workspace/.scratch/PHASE-P2-SMOKE.md`).

## Fixed (mandated)

### A4 — Order-number gap on losing concurrent finalize
`lib/domain/finalize.ts`: reordered exactly as prescribed — the guarded `updateMany({ status: "DRAFT" })` flips FIRST; the loser aborts before `claimNextOrderNumber` ever runs, so only the winning transaction touches the Season counter (also shortens the Season row-lock hold). The double-finalize test now additionally asserts `Season.orderCounter === count(FINALIZED)` (gap-free).

### A5 — Package merge race (two NEW packages for one key)
Two-layer fix in `assignLinesToPackages`:
1. **Serialization:** `pg_advisory_xact_lock(hashtextextended(seasonId|groupingKey, 0))` per grouping key before the find-or-create, keys locked in sorted order (no deadlock between multi-key orders). The second racing finalize now waits, sees the committed NEW package, and merges into it — proven by new test "concurrent finalizations of different orders sharing a key merge into one package".
2. **DB backstop:** partial unique index `Package_seasonId_groupingKey_new_key ON ("seasonId","groupingKey") WHERE "stage" = 'NEW'` in migration `20260720220500_p2_fix_pass`.

*Deviation from the review's suggested fix:* the review suggested `upsert`/insert-on-conflict. Prisma cannot express partial unique indexes in the schema, so `upsert` can't target this constraint; the advisory lock gives the same single-NEW-package guarantee through normal Prisma code, with the index as the DB-layer invariant. `migration:guard` (`prisma migrate diff --exit-code`) confirmed no drift.
Also folded in **A22**: the `findFirst` now has `orderBy: { createdAt: "asc" }` (oldest NEW package wins, deterministic).

### A6 — `finalizeOrder` never reserved inventory
New `reserveLineInventory` in `finalize.ts`: aggregates needed quantities per inventory item across all lines (products gated on `product.trackInventory`, add-ons on `addOn.trackInventory`), then calls the existing `reserveInventory` conditional UPDATE; any shortfall throws and rolls the whole finalize back (order stays DRAFT, no number kept — asserted by new test). Seed verified end to end: finalizing the seed order leaves `Classic Basket reserved = 2`.

### A27 — `groupByPackageKey` duplicate
`finalize.ts` now calls `groupByPackageKey(lines)` instead of the inline Map reimplementation; the helper has a production caller.

## Fixed (quick wins)

- **A8** — `ShippingQuote_target_present` CHECK (`orderId IS NOT NULL OR packageId IS NOT NULL`), mirroring `InventoryItem_target_xor`.
- **A9** — `@@unique([orderLineId, productOptionId])` on `OrderLineOption` and `@@unique([orderLineId, addOnId])` on `OrderLineAddOn` (schema + migration).

All three schema changes live in `prisma/migrations/20260720220500_p2_fix_pass/migration.sql`; guard passes.

## Not fixed (out of single-pass scope)

A1–A3 (auth/security), A7 (documented instead: `Package.version` marked reserved-for-future in `PHASE-P2-STATUS.md`, per the review's "or document" option), A10–A13, all minors except A22.

## Files touched

`lib/domain/finalize.ts` · `prisma/schema.prisma` · `prisma/migrations/20260720220500_p2_fix_pass/migration.sql` · `tests/domain-db.test.ts` (2 new tests + gap-free assertion + cleanup widened) · `.scratch/PHASE-P2-SMOKE.md` · `.scratch/PHASE-P2-STATUS.md` · scratch helpers (`reset-domain.ts`, `check-reserved.ts`).
