# P2 clean-code review — arm-04 (blind)

Scope: P2 delta only — `prisma/schema/*`, `prisma/migrations/20260726131500_p2_domain_core/`, `prisma/seed-domain.ts`, `prisma/seed-identity.ts`, `prisma/seed.ts`, `scripts/smoke-p2.ts`, `src/lib/orders/*`, `src/lib/inventory/reserve.ts`, `src/lib/fulfillment/*`, `src/lib/geocode-cache.ts`, `src/lib/seasons.ts`, and the small P2 edits to `audit.ts`, `core/normalize.ts`, `core/result.ts`, `migration-guard.ts`, `prisma.config.ts`. Findings only — no fixes.

## Blocker

None.

## Major

### M1. Pattern drift: `advancePackageStage` is not transactional and audit can detach
`src/lib/fulfillment/packages.ts:16-56`

`finalizeOrder` and `transitionOrder` wrap every mutation + audit row in one `db.$transaction` so a failed audit write rolls the stage change back. `advancePackageStage` calls `db.package.updateMany` (`:32`) and then `recordAudit` (`:48`) as two independent writes on `db` (not a tx client). If the audit insert throws, the package stage has already moved and there is no `package.stage_changed` row — the exact "who marked this box sent" trail UR-001 requires is gone. The optimistic-lock + audit pattern is implemented two different ways in the same phase.

### M2. Pattern drift: `type Client = Prisma.TransactionClient | typeof db` duplicated
`src/lib/inventory/reserve.ts:14`, `src/lib/orders/payment-status.ts:7`

The same local alias is declared in two P2 files, while `audit.ts:26` and `staff-service.ts:23` inline the full union instead. Four call sites, three spellings of "accepts a tx or the db." One shared `type DbClient` in `core/` covers all of them; the P2 split was the moment to introduce it.

### M3. Implicit shape coupling: `PackageDestination` → `Package` via spread
`src/lib/orders/order-service.ts:239`, `src/lib/orders/grouping.ts:80-93`

`createPackages` does `tx.package.create({ data: { orderId, groupingKey, ...group.destination } })`. This only works because the fields of `PackageDestination` happen to line up with the writable fields of `Package`. Neither side asserts that contract — rename or drop one column on either type and the spread silently produces wrong data or a Prisma runtime error deep in finalize. `destinationOf` (grouping.ts:80-93) hand-copies 11 fields for the same reason. A single shared Prisma-aware type (or a `pickPackageWritable(destination)` helper) makes the coupling explicit.

## Minor

### m1. Duplicated inventory loop
`src/lib/orders/order-service.ts:200-212`

`reserveInventoryFor` and `releaseInventoryFor` differ only in `reserveUnits` vs `releaseUnits`. One `applyInventoryOp(tx, lines, op)` removes the copy. Borderline — Rule of 2 says two call sites is enough to extract, and the bodies are byte-identical apart from the call.

### m2. Duplicated optimistic-lock + audit block
`src/lib/orders/order-service.ts:66-92` and `:118-147`

The `updateMany({ where: { id, status }, data: { status: to, version: increment } })` → `count === 0` → `CONCURRENT_CHANGE` → `recordAudit` shape repeats for finalize and transition. A `claimOrderStatus(tx, id, from, to, extra)` helper would collapse both.

### m3. Vague names
- `src/lib/orders/order-service.ts:270` `totalsFor` — describes neither input nor output clearly; `computeOrderTotals` reads at the call site.
- `src/lib/orders/order-service.ts:177` `inventoryDemandOf` — `mergeInventoryDemand` says what it does (merge by target + sort).
- `src/lib/orders/payment-status.ts:38` `statusFor` — `paymentStatusForAmount` is unambiguous.
- `scripts/smoke-p2.ts:163` `run` — too generic next to `runTests`; `runCommand` / `spawnCmd`.
- `scripts/smoke-p2.ts:197` `lastLine` — actually returns the first line containing a needle, falling back to the last line; `lineContaining` is honest.

### m4. Magic dates in seed
`prisma/seed-domain.ts:113-114`

`Date.UTC(year, 0, 5)` and `Date.UTC(year, 2, 1)` are hardcoded month/day with a comment explaining the rationale but no named constant. `SEASON_OPENS_MONTH = 0`, `SEASON_OPENS_DAY = 5`, etc., keeps the comment's intent in the code.

### m5. Defensive `?? 0` for an FK-guaranteed row
`src/lib/orders/order-service.ts:286`

`feeByMethod.get(row.fulfillmentMethodId) ?? 0` — `Package.fulfillmentMethodId` is `onDelete: RESTRICT` and the methods are fetched straight from the same DB, so a missing key is impossible. The fallback is dead code per the "no defensive code for conditions that can't happen" rule.

### m6. `seasons.ts` cron is not atomic across open + close
`src/lib/seasons.ts:21-33`

Two separate `db.season.updateMany` calls (open, then close) outside a transaction. A failure between them leaves one applied and the run row marked FAILED — recoverable on the next sweep, but the "all or nothing per run" guarantee the rest of the file aims for is not held. Wrap both in `db.$transaction`.

### m7. `\u0000` separator is a magic literal
`src/lib/orders/grouping.ts:58`

`parts.join('\u0000')` — the NUL separator is chosen because it cannot appear in the inputs, but that reason lives in a reviewer's head. A one-line `const KEY_SEPARATOR = '\u0000'` with a comment makes the choice visible.

## Counts

- blocker: 0
- major: 3
- minor: 7
