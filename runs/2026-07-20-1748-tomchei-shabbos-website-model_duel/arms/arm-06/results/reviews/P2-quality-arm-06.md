# P2 Quality Review — arm-06 (blind)

**Phase:** Test 4 P2 — Domain core (seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine)
**EXPECTED:** `shared/phases/PHASE-P2-EXPECTED.md`
**Smoke evidence:** `arms/arm-06/workspace/.scratch/PHASE-P2-SMOKE.md` + `.scratch/smoke-p2/transcript.log`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Findings only — no fixes.

## Verdict

All 11 EXPECTED items are backed by schema + engines + tests. Smoke S1–S5 all PASS in the transcript. No blockers. One major (schema-level data-integrity risk) and several minor reporting/robustness nits.

## Findings

### Major

**M1 — `OrderLine.parentLineId` FK uses `ON DELETE SET NULL`, orphaning add-on lines on parent delete**
`prisma/migrations/20260728164419_domain_core/migration.sql:462`:
```sql
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_parentLineId_fkey"
  FOREIGN KEY ("parentLineId") REFERENCES "order_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```
`prisma/schema.prisma:323` declares the self-relation without an explicit delete rule, so Prisma defaulted to `SET NULL`. Deleting a parent product line nulls every child add-on line's `parentLineId` instead of removing them, leaving orphaned add-on rows that still contribute to `Order.totalCents` and `paymentStatus` recomputation. No P2 flow deletes a single line yet, but the schema choice is locked in once the migration is applied; admin line-editing in a later phase will inherit the bug. EXPECTED #3 ("add-ons tree with price snapshots") implies the tree should stay consistent. Recommend `ON DELETE CASCADE` for this FK when the fix lands.

### Minor

**m1 — Smoke report check counts are wrong**
`PHASE-P2-SMOKE.md` S2 says "9 checks" but `scripts/test-grouping.mts` has 10 `check()` calls (lines 23, 27, 32, 37, 42, 47, 52, 57, 62, 70). S3 says "14 checks" but `scripts/test-state-machine.mts` has 15 `check()` calls (lines 23–31 = 7, 39 = 1, 45–52 = 7). Cosmetic, but the smoke doc is the evidence of record — a future re-run that produces the real count will look like a regression.

**m2 — `test:unit` does not include the concurrent-finalization test; EXPECTED #10 calls it a "unit test"**
`package.json:12` `test:unit` runs `test-permissions.mts`, `test-grouping.mts`, `test-state-machine.mts` only. `test-order-numbers.mts` and `test-inventory-race.mts` live in `test:domain` (`package.json:13`). EXPECTED #10 lists "concurrent finalizations don't double-claim an order number" under "Unit tests". Functionally covered by `ci` (which runs both), but the split mislabels the test tier. The concurrent-finalization test is DB-integration (it creates a season/customer/orders), so `test:domain` is the right home — the EXPECTED wording is the mismatch, not the script. Worth a note in the status doc.

**m3 — `npm run ci` green claim is not directly evidenced in the transcript**
`.scratch/smoke-p2/transcript.log` captures S1–S5 individually (`prisma migrate deploy`, `npm run seed`, `node --import tsx --test`, `npx tsx scripts/test-order-numbers.mts`, `npx tsx scripts/test-inventory-race.mts`). It does **not** capture a `npm run ci` invocation (lint + typecheck + migration-guard + test:unit + test:domain). `PHASE-P2-SMOKE.md` line 6 asserts "CI: `npm run ci` green", but the only evidence is the decomposed checks. Lint/typecheck/migration-guard results are not in the transcript at all. Likely true given the pieces, but the claim is unsubstantiated.

**m4 — `ShippingQuote` allows orphan rows (both `orderId` and `packageId` nullable, no XOR)**
`prisma/schema.prisma:433-436` — `orderId String?` and `packageId String?` are both nullable with no CHECK requiring exactly one. A quote could be inserted with neither target. No P2 flow creates quotes yet, so no live bug, but the schema permits a state EXPECTED #5 ("shipping quotes with expiring options") doesn't address. Contrast with `InventoryItem`, which got an explicit XOR CHECK (`migration.sql:504`).

**m5 — `InventoryItem` XOR constraint lives only in migration SQL, not `schema.prisma`**
`migration.sql:503-504` hand-adds `CHECK (("productId" IS NULL) <> ("addOnId" IS NULL))`. Prisma cannot express CHECK in `schema.prisma`, so this is the only option — but a future `prisma migrate dev --create-only` reset or `db push` would drop it silently. `migration-guard` catches schema drift only when a migration is created; it won't flag a missing CHECK that isn't in the datamodel. The `check-xor.mts` probe verifies it today, but there's no regression guard in `ci` (the XOR check is a standalone `.scratch` script, not in `test:unit` or `test:domain`). Recommend promoting the XOR probe to a `ci` test.

**m6 — `migration-guard.mjs` drift branch checks the wrong exit code**
`scripts/migration-guard.mjs:49` checks `error.status === 2` for the drift case, but `prisma migrate diff --exit-code` returns `1` (not 2) when a diff exists. The drift-specific error message ("schema.prisma has drifted") never fires; drift still fails CI via the `else` branch with a misleading "migrate diff failed" message. Pre-existing from P1, not introduced by P2 — flagging because P2 relies on the guard for the hand-added CHECK.

**m7 — `createDraftOrder` does not validate that add-on lines carry a `parentLineId`**
`lib/orders/create-draft.ts:43-54` writes every line in `input.lines` as a top-level create; `parentLineId` defaults to `null` if not passed. A caller could pass an add-on line (with `addOnId` set) without a `parentLineId`, and it would be summed into `Order.totalCents` as if it were a product line. No P2 caller does this (the seed passes one product line), but the engine has no guard. EXPECTED #3's "add-ons tree" implies structure the function doesn't enforce.

## EXPECTED coverage map

| # | EXPECTED | Evidence | Verdict |
|---|---|---|---|
| 1 | Season/Product/options/add-ons/replacements | `schema.prisma:175-266`; `seed.ts:20-68` | DONE |
| 2 | Customer dedupe + saved addresses w/ geocode | `lib/customers/dedupe.ts`; `lib/phone.ts`; `Address` schema `:269-288` | DONE |
| 3 | Order→OrderLine tree, snapshots, numbers, draft ref, payment cache | `lib/orders/{create-draft,numbers,state-machine}.ts`; `Order` schema `:292-338` | DONE (M1 on tree FK) |
| 4 | Package entity, grouping key, data-driven stages, audit | `lib/packages/{grouping,stages}.ts`; `Package`/`PackageEvent`/`FulfillmentMethod` schema | DONE |
| 5 | Payments, Stripe PI, shipping quotes, pickup, package types, boxes | `lib/payments/post.ts`; `Payment`/`StripePaymentIntent`/`ShippingQuote`/`PickupLocation`/`PackageType`/`ShipmentBox` schema | DONE (m4 on quote orphans) |
| 6 | Unified versioned inventory + XOR + geocode cache + cron log | `lib/inventory/reserve.ts`; `InventoryItem`/`GeocodeCache`/`CronRun` schema; `migration.sql:504` | DONE (m5 on CHECK fragility) |
| 7 | BOM/ingredient + assembly batch (schema only) | `Ingredient`/`BomLine`/`AssemblyBatch` schema `:532-567` | DONE |
| 8 | Order state machine + finalize + discard + concurrency | `lib/orders/state-machine.ts` (conditional `updateMany` + atomic claim); `lib/inventory/reserve.ts` (`FOR UPDATE`); `lib/packages/stages.ts` (optimistic `version`) | DONE |
| 9 | Migration harness + seed | `prisma migrate deploy` clean (3 migrations); idempotent seed (S1 PASS) | DONE |
| 10 | Unit tests: grouping, state machine, concurrent finalizations | `test-grouping.mts`, `test-state-machine.mts`, `test-order-numbers.mts` | DONE (m2 on tier naming) |
| 11 | Race: two checkouts for last unit → one commits | `test-inventory-race.mts` (1 win, 1 `InsufficientStockError`) | DONE |

## Smoke verification

| # | Smoke claim | Transcript evidence | Verdict |
|---|---|---|---|
| S1 | Migrations + seed PASS, idempotent | `transcript.log:1-5` — 3 migrations, no pending; counts stable on rerun | Verified |
| S2 | Grouping engine PASS | `transcript.log:6-7` — `# pass 1 / # fail 0` | Verified (count mismatch m1) |
| S3 | State machine PASS | `transcript.log:8-9` — `# pass 1 / # fail 0` | Verified (count mismatch m1) |
| S4 | Order numbers PASS | `transcript.log:10-11` — all `ok:` lines present | Verified |
| S5 | Inventory race PASS | `transcript.log:12-13` — 1 win, 1 stockout, version=2 | Verified |
| CI | `npm run ci` green | Not in transcript | Unsubstantiated (m3) |

## Notes

- `Order.version` is incremented on finalize/discard but isn't used as an optimistic-concurrency guard on `Order` itself — the conditional `where: { id, status: "DRAFT" }` in `finalizeOrder` (`state-machine.ts:38-46`) is the actual guard. The `version` column is bookkeeping. Not a finding, just an observation.
- `lib/seasons.ts` `getOpenSeason` returns the most recent OPEN season by `createdAt`. If two seasons are ever OPEN simultaneously (schema allows it), the "single open season" invariant (UR-008) is enforced by convention, not by the schema. No P2 flow creates a second season except the test (`test-order-numbers.mts:20`), which cleans up. Acceptable for P2; flag for a later unique partial index if the invariant is hard.
- `concurrency-smoke.mjs` (P1 staff-version race) is wired in `package.json` as `concurrency-smoke` but is **not** part of `ci`. Pre-existing from P1, not a P2 regression.
