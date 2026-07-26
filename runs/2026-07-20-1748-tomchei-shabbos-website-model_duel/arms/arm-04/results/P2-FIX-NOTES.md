# P2 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P2.md` (0 blockers, 6 majors, 22 minors)
**Scope:** one pass over `workspace/`. No new features, no P3.
**Outcome:** 6/6 majors fixed, 17 of the 21 listed minor items fixed, 4 deferred.
**Gates after the pass:** `npm run lint`, `npm run typecheck`, `npm run db:guard` green · 68/68 tests · **21/21 P2 smoke checks** · **28/28 P1 smoke checks**.

## Fixed — majors

| # | Fix | Where |
|---|---|---|
| 1 | `actor` is now a required argument on `finalizeOrder`, `transitionOrder`, `discardDraft` and `advancePackageStage`. The `= null` default is gone, so "log this as system" is a decision a caller writes down rather than the shape of the easy path. The doc comment on `finalizeOrder` names where the real gate lives (`requirePermission` for staff, the draft reference for a customer) so P4/P5 routes copy the contract instead of inventing one. No new guard was invented here: the engine has no request to authorize, and a second half-authorization primitive would be the wrong thing to hand the route layer. | `src/lib/orders/order-service.ts`, `src/lib/fulfillment/packages.ts` |
| 2 | New `Reservation` table: one row per order per stock-tracked target, written inside the finalize transaction, with a HELD/RELEASED status, `releasedAt`, and the same XOR CHECK constraint `InventoryItem` carries plus `quantity > 0`. Cancel now releases from those rows instead of recomputing demand from the current lines, and marks them RELEASED, so a second cancel releases nothing and a P5 post-place edit cannot make the release disagree with what was taken. `InventoryItem.reserved` stays as the counter the CHECK constraint guards. | `prisma/schema/inventory.prisma`, `prisma/migrations/20260726140500_p2_review_fixes/`, `src/lib/orders/order-service.ts` |
| 3 | `advancePackageStage` runs the read, the version-guarded move and the audit row in one `db.$transaction`. A failed audit write now rolls the stage back rather than leaving a box that moved with no trail (UR-001). | `src/lib/fulfillment/packages.ts` |
| 4 | `PackageDestination` is `Pick<Prisma.PackageUncheckedCreateInput, …>` over one exported field list, and the hand-copy is replaced by `pickPackageDestination`, which maps that same list. Renaming or dropping a `Package` column is now a type error in `grouping.ts` instead of a wrong insert inside finalize. | `src/lib/orders/grouping.ts` |
| 5 | One `DbClient` type in `src/lib/core/db-client.ts` (type-only import of `db`, so `core/` gains no runtime dependency on the server-only client). All four spellings — `reserve.ts`, `payment-status.ts`, `audit.ts`, `staff-service.ts` — now use it. | `src/lib/core/db-client.ts` + 4 call sites |
| 6 | New service-level test "a placed order walks forward to completed, versioned and audited at every step": PLACED → IN_FULFILLMENT → COMPLETED through `transitionOrder`, asserting the status write, both version bumps, that `discardedAt` stays null, that a completed order keeps its stock, and both `order.status_changed` audit rows in order. Smoke check P2-12 names it. | `tests/order-lifecycle.test.ts`, `scripts/smoke-p2.ts` |

## Fixed — priority minors

| Item | Fix |
|---|---|
| `applyScheduledSeasonFlips` has no bearer guard | Took the "document the required wrapper" option rather than inventing a `CRON_SECRET` this phase has no route for. The doc comment now states in as many words that the function authenticates nobody, that it is the job body and not the endpoint, and that the P12 route must reject before calling — because opening a season early puts the store live. |
| Season cron not atomic | Both `updateMany` calls run in one `db.$transaction`, so a failure cannot leave the season list half-flipped behind a FAILED run row. |
| `recordAudit` writes free-form detail | `AuditDetails` maps every action to its allowed detail shape and `recordAudit` is generic over it; actions that carry no detail are typed `never` so one cannot be passed. Adding an action means adding a line to that map first, which is where someone notices they were about to log a check number. The `AuditEvent.detail` schema comment now points at it. |
| Duplicated optimistic-lock block | `claimOrderStatus(tx, move)` holds the conditional UPDATE and the conflict failure; finalize and transition pass their own timestamps and their own conflict message. |
| Duplicated inventory loop | Gone as a consequence of major 2: reserve writes reservation rows, release reads them back. The two functions no longer differ only by the op call. |
| `recomputeOrderPaymentStatus` not concurrency-safe | Takes `SELECT … FOR UPDATE` on the order row and runs in a transaction when the caller did not supply one. Two concurrent postings now serialize instead of both reading a partial set. |
| `InventoryItem.version` dead code | Dropped, in schema, migration, the reserve/release SQL and the raw-insert test. Concurrency was always the conditional UPDATE. |
| Migration guard ignores CHECK constraints | The guard now replays the migrations into a fresh shadow database with `migrate deploy` and asserts all four hand-written CHECK constraints exist in `pg_constraint`. Verified both ways: green as shipped, and `exit 1` with "the migrations no longer create …" when a name is removed from the list. |
| `codegraph init` not run | Run. `.codegraph/` now holds 101 files / 891 nodes / 2,352 edges, and the folder is gitignored. This reverses the P1 deferral: the P1 note leaned on the harness-level "indexing is the user's decision", but this arm's `codegraph.mdc` says to run it in the project when the CLI is on PATH, and the arm rule governs the arm. |
| Magic literals | `GROUPING_KEY_SEPARATOR` in `grouping.ts`; `SEASON_OPENS_ON` / `SEASON_CLOSES_ON` in `seed-domain.ts`, with the zero-based-month trap stated once. |

## Fixed — remaining minors

| Item | Fix |
|---|---|
| Add-on reservation untested | New test "a stocked add-on is reserved alongside its product, each with its own record" asserts the add-on's own `reserved` count and both reservation rows. |
| No index on `Season.opensAt` / `closesAt` | `@@index([status, opensAt])` and `@@index([status, closesAt])` — the exact shape both sweep queries use. |
| Vague names | `item` → `inventory` (`reserve.ts`), `result` → `geocode` (`geocode-cache.ts`), `totalsFor` → `computeOrderTotals`, `inventoryDemandOf` → `mergeInventoryDemand`, `statusFor` → `paymentStatusForAmount`, `run` → `runCommand`, `lastLine` → `lineContaining`. |
| `destinationOf` violates Rule of 2 | No longer exported; it is now the single-call-site `pickPackageDestination` that major 4 needs. |
| Defensive `?? 0` on the fulfillment fee | Replaced by `baseFee`, which throws naming the package and the method id. A missing row is a programming error, not a free package. |

## Deferred

| Item | Why |
|---|---|
| `advancePackageStage` / `recomputeOrderPaymentStatus` callable on any id | Partly addressed: `advancePackageStage` now demands an explicit actor. The rest is the trust boundary the aggregate itself defers to the route layer (P4/P5/P6). Adding a second authorization primitive inside the engine, with no request and no session to read, would be the thing P5 has to unpick. |
| `Product.replacedByProductId @unique` forces 1:1 | The aggregate defers it to P10 design. Relaxing it now changes what repeat-order means before repeat-order exists. |
| `OrderLine.optionsSnapshot` never populated | P4/P5 write it. A test today would assert an empty default. |
| `Payment.reference` has no uniqueness | Dedupe rules are P5/P6 (a check number is unique per bank, a Stripe intent id globally). A unique index chosen now would have to be dropped. |

## Two defects found while verifying, and fixed

Both were found by the checks this pass added, and both made an existing gate report success it had not earned.

1. **The migration guard could not fail CI.** `embedded-postgres` installs an async exit hook that ends the process with 0 whatever `process.exitCode` says. Every script that imports `scripts/db-server.ts` — `migration-guard`, `db-fresh`, `test-db` — printed its failure and exited 0. Proven: `npx tsx -e "import('embedded-postgres').then(() => { process.exitCode = 5 })"` exits 0, while `process.exit(5)` exits 5. All three now exit explicitly, and the guard failing on a missing constraint returns 1.
2. **The P2 smoke ran its tests against the seeded development database.** Importing `@prisma/client` loads `.env` into `process.env`, and node's `--env-file` does not override a variable that is already set, so the test run spawned by `scripts/smoke-p2.ts` inherited `DATABASE_URL=…/tomchei`. Evidence: after the first re-smoke, the development database held 25 orders and 23 "Test season …" rows created during the run. `runTests` now passes `TEST_DATABASE_URL` explicitly (exported from `db-server.ts` alongside `DATABASE_URL`), and the smoke migrates that database first (check S1d). P2-13 dropped from a nonsense 22 HELD reservations to the correct 3.

## Verification

Embedded cluster on 4104, dev server on 3104.

- `npm run lint` → clean · `npm run typecheck` → clean.
- `npm run db:guard` → "schema and migrations agree, and all 4 CHECK constraints survive the replay".
- `npm test` → **68/68 pass** (66 before this pass, plus the forward-lifecycle and add-on-reservation tests).
- `npm run smoke:p2` → **21/21 checks pass**, written to `workspace/.scratch/PHASE-P2-SMOKE.md`.
- `npm run db:fresh && npm run smoke` → **28/28 P1 checks pass**, written to `workspace/.scratch/PHASE-P1-SMOKE.md`. P1 needs an unseeded database, so it is run after a reset rather than after the P2 seed.

Checks that exist only because of this pass:

```
PASS  S1d  The tests get their own migrated database, not the seeded one
        3 migrations found in prisma/migrations
PASS  P2-11  Schema and migrations agree, CHECK constraints included
        Migration guard: schema and migrations agree, and all 4 CHECK constraints survive the replay.
PASS  P2-12  The forward lifecycle and per-order reservation records are covered
        "a placed order walks forward to completed, versioned and audited at every step"; "a stocked add-on is reserved alongside its product, each with its own record"
PASS  P2-13  The seeded order holds its stock through named reservation rows
        3 HELD reservations for the seeded order: add-on x1, product x1, product x3
```

## One thing the fix changed about the design

`Reservation` moves the release decision off the order lines and onto a written
record of what was taken. That is the structural half of major 2, and it also
settles a question P5 was going to ask badly: when a placed order is edited, the
reservation rows are what has to be adjusted, one target at a time, rather than
a counter that no longer knows whose units it is holding. The counter stays
because the CHECK constraint that cannot oversell the last unit is defined on
it — the two are now a fast path and its audit trail, not two sources of truth.
