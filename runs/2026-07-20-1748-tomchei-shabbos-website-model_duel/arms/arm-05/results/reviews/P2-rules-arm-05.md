# P2 Rules Review — arm-05 (blind)

**Scope:** P2 domain core — seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine (plan § P2; `shared/MERGED-BUILD-PLAN.md`).
**Rules graded (arm-05 always-on):** ponytail, clean-code, workflow, vocabulary, codegraph.
**Method:** Read every P2 file under `arms/arm-05/workspace/` (`prisma/schema.prisma`, `prisma/migrations/20260727172758_p2_domain_core/migration.sql`, `prisma/seed.ts`, `lib/orders.ts`, `lib/packages.ts`, `lib/inventory.ts`, `lib/foundation.ts`, `lib/settings.ts`, `lib/db.ts`, `scripts/smoke-p2.ts`, `scripts/migration-harness.ts`, `scripts/migration-guard.ts`, `tests/domain-core.test.ts`, `tests/concurrency.test.ts`) and graded adherence to the selected catalog rules only. No fixes. No model names.

---

## Blockers

None. The P2 keystone engines (package grouping, order state machine, row-locked seasonal numbering, atomic inventory reservation) are present, correct, and unit/integration-tested as the plan requires.

---

## Majors

### M1 — Migration harness is still a string-match stub, but P2 status cites it as passed validation
- **Location:** `arms/arm-05/workspace/scripts/migration-harness.ts`
- **Claim:** The P2 status file lists `npm run migration:harness` as one of the validation commands that "passed". The harness does not run `prisma migrate deploy`, does not create a disposable DB, does not detect schema drift, and does not validate the P2 migration. It only `readFile`s `schema.prisma` and string-matches `provider = "postgresql"` and `model StaffUser`. The P2 migration (`20260727172758_p2_domain_core`) is never exercised by this harness — only `smoke:p2` exercises it via `runWithLocalDatabase("prisma", ["migrate", "deploy"])`.
- **Evidence:** Full body of `migration-harness.ts` is `const schema = await readFile(...); if (!schema.includes('provider = "postgresql"') || !schema.includes("model StaffUser")) { throw ... } console.log("... schema is ready ...")`. No `spawn`, no `prisma migrate`, no embedded-postgres, no diff. Plan P1 R-141 requires a "disposable migration harness"; P2 inherits the same gate.
- **Rules:** `clean-code.mdc` Anti-Hallucination ("Do not claim 'fixed/passed/working' without tool output or running-app evidence"); `workflow.mdc` ("Verify in the running app — never mark done from code alone").

---

## Minors

### m1 — `discardOrder` skips the optimistic-version guard that `finalizeOrder` enforces
- **Location:** `arms/arm-05/workspace/lib/orders.ts:47-56`
- **Claim:** `finalizeOrder` reads the order inside its transaction and writes via `updateMany` with `where: { id, status: "DRAFT", version: order.version }`, treating `claimed.count !== 1` as a conflict. `discardOrder` reads the order outside any transaction, calls `assertOrderTransition`, then issues a plain `prisma.order.update({ where: { id } })` with no `version` predicate. Two concurrent discards (or a discard racing a finalize) both pass `assertOrderTransition` and both commit. The Order table has a `version` column and finalize honors it; discard ignores it — two concurrency patterns in the same file.
- **Evidence:** `finalizeOrder` lines 28-36 use `updateMany` + version guard; `discardOrder` lines 47-56 use `prisma.order.update({ where: { id: orderId }, data: { status: "DISCARDED", version: { increment: 1 } } })` with no version predicate and no transaction wrapping the read+assert+write.
- **Rules:** `clean-code.mdc` Consistency ("One error-handling approach per project"; "inconsistent patterns — pick one, apply everywhere"); `workflow.mdc` Execution Discipline (concurrency on order mutations).

### m2 — `reserveInventory` cannot link an add-on reservation to its `OrderLineAddOn`
- **Location:** `arms/arm-05/workspace/lib/inventory.ts:4-31`
- **Claim:** The schema defines `InventoryReservation.orderLineAddOnId` (nullable FK to `OrderLineAddOn`) and `InventoryItem.productAddOnId` (XOR with `productId` via the CHECK constraint), so add-on inventory is a first-class path. `reserveInventory` only accepts `inventoryItemId`, `quantity`, `orderId` — it never sets `orderLineAddOnId`. Add-on reservations are written with a null `orderLineAddOnId`, so the reservation cannot be traced back to the order line add-on that consumed it.
- **Evidence:** `lib/inventory.ts:26` creates `{ inventoryItemId, quantity, orderId }` — `orderLineAddOnId` absent. The migration enforces the XOR on `InventoryItem` (lines 328-329) but the engine has no code path that reserves against an add-on inventory row with its line add-on.
- **Rules:** `clean-code.mdc` Anti-AI-Tics ("No 'just in case' code — every line must have a reason" — here the inverse: a schema field with no producer); plan P2 R-158 "Unified versioned inventory (products + add-ons)".

### m3 — Greeting case-folding is a silent business decision in the grouping key
- **Location:** `arms/arm-05/workspace/lib/packages.ts:8-15`
- **Claim:** `createPackageGroupingKey` lowercases `recipientKey` (line 10) but only trims `greeting` (line 13). "Happy Purim" and "happy purim" produce different grouping keys and split into two packages for the same recipient/address/method. The plan says the grouping key is "recipient/address/method/greeting"; whether greeting is case-folded is a domain rule, and it is chosen silently.
- **Evidence:** Line 10 `candidate.recipientKey.trim().toLowerCase()`; line 13 `candidate.greeting.trim()`. The unit test only covers two different greeting strings ("Happy Purim" vs "Purim Sameach"), not case variants.
- **Rules:** `workflow.mdc` ("Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag"); `ponytail.mdc` ("Complex requests: build what the user asked — do NOT ship a lazy slice and re-argue").

### m4 — Error messages state what went wrong but not the expected state
- **Location:** `arms/arm-05/workspace/lib/orders.ts:12, 19, 26, 36, 49`; `arms/arm-05/workspace/lib/inventory.ts:10`
- **Claim:** clean-code requires error messages to "say what went wrong AND what the expected state was." Five P2 error strings state only the failure.
- **Evidence:** `"Cannot transition an order from ${currentStatus} to ${nextStatus}."` (no allowed set shown); `"Order was not found."`; `"Order season was not found."`; `"Order changed before it could be finalized."` (no expected version); `"Inventory reservation quantity must be a positive whole number."` (no range).
- **Rules:** `clean-code.mdc` Error Handling ("Error messages say what went wrong AND what the expected state was").

### m5 — Seed clobbers `quantityReserved` to 0 on re-run
- **Location:** `arms/arm-05/workspace/prisma/seed.ts:69-73`
- **Claim:** `inventoryItem.upsert`'s update branch sets `quantityReserved: 0`. If the seed is re-run against a database that already has live reservations, the reservation counter is silently reset to zero while `quantityOnHand` is reset to 25 — the inventory engine's invariant (`quantityOnHand - quantityReserved >= 0`) is preserved numerically, but outstanding reservations become orphaned from the on-hand count.
- **Evidence:** `update: { quantityOnHand: 25, quantityReserved: 0 }`. The `InventoryReservation` rows are not touched by the seed, so they would reference a `quantityReserved` that no longer reflects them.
- **Rules:** `clean-code.mdc` Anti-AI-Tics ("No 'just in case' code"); `workflow.mdc` ("Verify in the running app" — idempotent re-seed is a stated smoke assumption).

### m6 — Seed hand-rolls a normalized address with a magic delimiter and no helper
- **Location:** `arms/arm-05/workspace/prisma/seed.ts:40, 50`
- **Claim:** The seed inlines the literal `"1 seed street|brooklyn|ny|11201|us"` twice (lookup key and create value) using a `|` delimiter. `lib/foundation.ts` ships `normalizeEmail` and `normalizePhone` (plan R-164 normalize helpers) but no `normalizeAddress`. The normalization format is a magic value chosen inline.
- **Evidence:** Lines 40 and 50 duplicate the literal; `lib/foundation.ts:14-20` has email/phone normalizers only. The `Address.normalizedAddress` column is `@unique` with `@@unique([customerId, normalizedAddress])`, so the format is load-bearing but undefined.
- **Rules:** `clean-code.mdc` Naming/Magic Values ("Magic values — named constants / enums"); `clean-code.mdc` Consistency ("inconsistent patterns — pick one, apply everywhere").

### m7 — `settings.ts` is an in-memory static map, not the typed key-value `AppSetting` store
- **Location:** `arms/arm-05/workspace/lib/settings.ts:1-19`
- **Claim:** The schema ships an `AppSetting` key-value model (plan P1 R-161 "typed key-value settings store"). `lib/settings.ts` is a hardcoded in-memory `SettingMap` object — `getSetting` reads a module-level constant and `setSetting` mutates it in memory only. Nothing persists to or reads from the `AppSetting` table. P2 relies on this for the scheduled auto-flip: `Season.opensAt`/`closesAt` exist, but `seasonTimezone` (the timezone the flip is evaluated in, open question 7 in the plan) lives only in this non-persistent map.
- **Evidence:** `const settings: SettingMap = { organizationName: "Tomchei Shabbos", supportEmail: "help@example.test", seasonTimezone: "America/New_York" };` — no `prisma.appSetting` call. `Grep appSetting` in `lib/settings.ts` returns zero matches.
- **Rules:** `clean-code.mdc` Consistency ("One data-fetching pattern per project"; "type/schema drift — centralize types, single source of truth"); plan P1 R-161 / P2 auto-flip dependency.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 7 |
| **Total** | **8** |
