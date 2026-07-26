# P2 Aggregate Review — arm-04 (blind)

**Phase:** P2 — Domain core (schema + engine)
**Inputs:** P2-security, P2-quality, P2-rules, P2-clean-code (arm-04)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.

## Counts (post-dedupe)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 6 |
| Minor | 22 |

No duplicates merged — all specialist findings target distinct location+claim pairs. Two locations are each cited by two findings with different claims (`packages.ts:16-56`: no-auth vs not-transactional; `seasons.ts`: no-bearer vs not-atomic); both survive per rule 1.

## Prioritized fix list (builder-readable)

### Majors (in priority order)

1. **[SEC] No authorization/ownership primitive in order engine** — `src/lib/orders/order-service.ts:37-159` (`finalizeOrder`, `transitionOrder`, `discardDraft`). `actor = null` default makes the wrong path the easy one; no `assertOwnedBy` / `requirePermission` guard for routes to lean on. Drop the `actor = null` default on `transitionOrder` so callers must pass a `StaffContext` or explicit `null`.

2. **[SEC] No per-order inventory reservation record** — `src/lib/inventory/reserve.ts:41-59`, `src/lib/orders/order-service.ts:207-212`, `prisma/schema/inventory.prisma:9-24`. `InventoryItem.reserved` is a single integer; release-on-cancel derives from current lines, not a snapshot. Once P5/P7 add post-place edits or fulfillment progress, release will over/under-release against the shared counter and the CHECK constraint cannot detect it. Add a `Reservation` table now (structural, cheaper pre-P7).

3. **[CC] `advancePackageStage` is not transactional — audit can detach** — `src/lib/fulfillment/packages.ts:16-56`. `db.package.updateMany` then `recordAudit` as two independent writes; if audit throws, the stage has moved with no `package.stage_changed` trail (UR-001 violation). Wrap both in `db.$transaction` to match `finalizeOrder`/`transitionOrder`.

4. **[CC] Implicit shape coupling: `PackageDestination` → `Package` via spread** — `src/lib/orders/order-service.ts:239`, `src/lib/orders/grouping.ts:80-93`. `...group.destination` and the 11-field hand-copy in `destinationOf` only work because the two types happen to align; rename or drop a column and finalize silently writes wrong data or throws deep inside Prisma. Introduce a shared Prisma-aware type or `pickPackageWritable(destination)` helper.

5. **[CC] Duplicated `type Client = Prisma.TransactionClient | typeof db`** — `src/lib/inventory/reserve.ts:14`, `src/lib/orders/payment-status.ts:7`, plus inlined unions in `audit.ts:26` and `staff-service.ts:23`. Four call sites, three spellings. Extract one `type DbClient` in `core/`.

6. **[QUAL] Forward order lifecycle untested at service level** — `tests/order-lifecycle.test.ts` covers DRAFT→DISCARDED and PLACED→CANCELLED via `transitionOrder`, never PLACED→IN_FULFILLMENT→COMPLETED. A regression in `transitionOrder` affecting only forward moves would land green in P2 and surface in P5+. Add a service-level forward-progress test (audit row + version bump + status write).

### Priority minors (top items)

- **[SEC] `applyScheduledSeasonFlips` has no bearer-secret guard** — `src/lib/seasons.ts:17-60`. Document the required wrapper or accept a `callerSecret` argument so the contract is explicit before P12 wires the route.
- **[CC] `seasons.ts` cron is not atomic across open + close** — `src/lib/seasons.ts:21-33`. Two `db.season.updateMany` calls outside a transaction; failure between them leaves one applied and the run row FAILED. Wrap both in `db.$transaction`.
- **[SEC] `recordAudit` writes free-form `detail` JSON with no sanitization** — `src/lib/audit.ts:23-40`, `prisma/schema/identity.prisma:84-103`. Introduce a typed `AuditDetail` shape per action to prevent future callers writing check numbers / Stripe intent ids.
- **[CC] Duplicated optimistic-lock + audit block** — `src/lib/orders/order-service.ts:66-92` and `:118-147`. Extract `claimOrderStatus(tx, id, from, to, extra)`.
- **[CC] Duplicated inventory loop** — `src/lib/orders/order-service.ts:200-212`. `reserveInventoryFor` / `releaseInventoryFor` differ only in the op call; one `applyInventoryOp(tx, lines, op)` removes the copy.
- **[QUAL] `recomputeOrderPaymentStatus` not concurrency-safe** — `src/lib/orders/payment-status.ts:17`. No tx or row lock; two concurrent payment postings can both read a partial set and last-writer-wins. Heads-up for P5 wiring.
- **[QUAL] `InventoryItem.version` is dead code** — `prisma/schema/inventory.prisma:18`. Concurrency is enforced by the conditional UPDATE + predicate, not the version column. Drop the column or actually use it.
- **[QUAL] Migration guard ignores CHECK constraints** — `scripts/migration-guard.ts`. `prisma migrate diff` does not compare the two hand-written CHECK constraints; deleting them from the migration would pass `db:guard`. Add an explicit guard or dedicated assertion.
- **[RULES] `codegraph init` still not run** — `.codegraph/` absent despite CLI v1.0.1 on PATH. Repeat from P1.
- **[CC] Magic literals** — `'\u0000'` separator at `src/lib/orders/grouping.ts:58`; hardcoded month/day at `prisma/seed-domain.ts:113-114`. Named constants with a one-line comment.

### Remaining minors (lower priority)

- [SEC] `advancePackageStage` / `recomputeOrderPaymentStatus` exported with no auth, callable on any id — `src/lib/fulfillment/packages.ts:16-56`, `src/lib/orders/payment-status.ts:17-36`.
- [QUAL] `Product.replacedByProductId @unique` forces 1:1 replacement — `prisma/schema/catalog.prisma:62`. Revisit at P10 design.
- [QUAL] Add-on inventory reservation untested — `seed-domain.ts:336` exercises the path but no test asserts the add-on's `InventoryItem.reserved` after finalize.
- [QUAL] `OrderLine.optionsSnapshot` never populated or tested — `prisma/schema/orders.prisma:93`. P4/P5 will exercise; flagging the P2 coverage gap.
- [QUAL] `Payment.reference` has no uniqueness — `prisma/schema/orders.prisma:157`. Dedup is P5/P6; schema offers no guardrail today.
- [QUAL] No index on `Season.opensAt`/`closesAt` — `src/lib/seasons.ts:21,30`. Fine at ~2 seasons; matters with multi-year archives.
- [RULES] Vague name `item` — `src/lib/inventory/reserve.ts:62,67` (`availableUnits`). Rename to `inventory` or `row`.
- [RULES] Vague name `result` — `src/lib/geocode-cache.ts:35`. Rename to `geocode` or `lookup`.
- [RULES] `destinationOf` violates Rule of 2 — `src/lib/orders/grouping.ts:80`. One call site; inline or drop the export.
- [CC] Vague names — `totalsFor`→`computeOrderTotals` (`order-service.ts:270`), `inventoryDemandOf`→`mergeInventoryDemand` (`:177`), `statusFor`→`paymentStatusForAmount` (`payment-status.ts:38`), `run`→`runCommand` (`smoke-p2.ts:163`), `lastLine`→`lineContaining` (`smoke-p2.ts:197`).
- [CC] Defensive `?? 0` for an FK-guaranteed row — `src/lib/orders/order-service.ts:286`. `Package.fulfillmentMethodId` is `onDelete: RESTRICT`; the fallback is dead code.

## Notes for downstream phases

- Trust-boundary enforcement is deferred to the route layer (P4/P5/P6/P12). The engine signatures are the contract future phases will copy — fix `actor = null` and add `Reservation` before P5, not after.
- No blockers; P2 gate is clear on security. The majors are structural debts that compound if landed post-P5/P7.
