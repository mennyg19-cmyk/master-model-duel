# Aggregate Review P2 — arm-05 (blind)

Phase: P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine.
Sources: P2-security, P2-quality, P2-rules, P2-clean-code specialist reviews.
Method: union + dedupe by location+claim; security blockers always survive; no new findings. Quality Critical/High→blocker or major; Medium→major; Low→minor.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 8 |
| P1 residual (carried forward, major-class) | 1 |
| Minor | 17 |
| **Total** | **26** |

Raw input totals: security 4 major + 5 minor + 1 P1 residual; quality 2 medium + 4 low; rules 1 major + 7 minor; clean-code 3 major + 7 minor. Dedupe collapsed 4 overlapping `discardOrder` findings, 2 customer-dedupe findings, 2 draftReference findings, 2 smoke-p2 findings, 2 inventory-linkage findings, and 2 normalizeAddress findings.

## Prioritized fix list (one pass: majors → useful minors)

### Majors (fix first)

**M1 — `discardOrder` has a TOCTOU race with no optimistic version guard.**
Location: `lib/orders.ts:47-56`. Claim: reads order, runs `assertOrderTransition` against the snapshot, then issues a plain `prisma.order.update` with no `status`/`version` predicate. A concurrent `finalizeOrder` committing between the read and the update will be silently overwritten, producing an illegal `FINALIZED → DISCARDED` transition. `finalizeOrder` protects itself with `updateMany` + `version` predicate; `discardOrder` does not. Tags: security-M1, quality-M1, rules-m1, cleancode-M2.

**M2 — Engine functions accept raw IDs with no authz or ownership scoping (IDOR-ready).**
Location: `lib/orders.ts:16` (`finalizeOrder`), `lib/orders.ts:47` (`discardOrder`), `lib/inventory.ts:4-31` (`reserveInventory`). Claim: every P2 engine entrypoint trusts caller-supplied entity IDs and performs no staff-permission, customer-ownership, or season-tenancy check. `reserveInventory` accepts an `orderId` it does not verify belongs to the caller, so a network caller can pin reservations to another customer's order. Latent trust-boundary gap; P5/P6 will wrap this engine and inherit no defensive layer. Tags: security-M2.

**M3 — Deleting a customer or address silently orphans orders and packages.**
Location: `prisma/schema.prisma:261` (`Order.customer` `onDelete: SetNull`), `prisma/schema.prisma:322` (`Package.address` `onDelete: SetNull`), `prisma/schema.prisma:228` (`Address.customer` `onDelete: Cascade`). Claim: cascading address delete nullifies `Package.addressId` while `Order.customerId` is also nullified; later phases enforcing R-042/R-043 ownership cannot reconstruct ownership. Tags: security-M3.

**M4 — Audit attribution is silently nullified on staff deletion.**
Location: `prisma/schema.prisma:98` (`AuditEvent.actor`), `prisma/schema.prisma:355` (`PackageAudit.actor`), `prisma/schema.prisma:110` (`SessionLoginStamp` `onDelete: Cascade`). Claim: audit trails retain `actorId` only as nullable FK with `onDelete: SetNull`; deleting a staff user severs attribution of past actions. `SessionLoginStamp` is worse — `Cascade` deletes login history outright. A malicious manager-class actor can erase attribution by deleting the implicated staff record. Tags: security-M4.

**M5 — No optimistic-versioning helper for Package mutations.**
Location: `lib/packages.ts` (entire file); `prisma/schema.prisma:308-335` (`Package.version`). Claim: `Package.version` is declared but never exercised. Only `groupPackageCandidates` (pure, no DB) ships in P2; no `updatePackage`/`advancePackageStatus`/`splitPackage` performs an optimistic-versioned write. Plan P2 deliverable "concurrency: row-level locking / optimistic versioning on inventory and package mutations" — inventory has `reserveInventory`; packages have nothing equivalent. Tags: quality-M2.

**M6 — Migration harness is still a string-match stub, but P2 status cites it as passed validation.**
Location: `scripts/migration-harness.ts`. Claim: harness only `readFile`s `schema.prisma` and string-matches `provider = "postgresql"` and `model StaffUser`. No `prisma migrate deploy`, no disposable DB, no drift detection. The P2 migration `20260727172758_p2_domain_core` is never exercised by this harness — only `smoke:p2` runs it. Violates anti-hallucination ("Do not claim 'fixed/passed/working' without tool output") and R-141. Tags: rules-M1.

**M7 — Two concurrency-control patterns for the same concern in P2.**
Location: `lib/orders.ts:16-45` (`finalizeOrder`), `lib/inventory.ts:4-31` (`reserveInventory`). Claim: both functions solve safe concurrent mutation of versioned domain rows using different strategies — `finalizeOrder` does `SELECT ... FOR UPDATE` + `updateMany` with `version` predicate; `reserveInventory` does a single atomic conditional `UPDATE ... WHERE ... RETURNING`. Both correct in isolation, but two competing patterns for the same concern. Violates "One state management pattern per project" and anti-AI-tics "extract the pattern." Tags: cleancode-M1.

**M8 — Three different error-handling patterns across P1+P2.**
Location: `lib/orders.ts` (throw `Error`), `lib/inventory.ts` (return `boolean`), `lib/staff-store.ts` (return `{ ok, reason, status }`). Claim: P2 introduces two new failure patterns that do not match the P1 result-object pattern. Three patterns for "operation failed" across the same codebase; callers cannot write one consistent handler. Violates "One error-handling approach per project." Tags: cleancode-M3.

### P1 residual (carried forward, major-class — relevant to P2 trust boundary)

**R1 — All staff-management and audit API routes remain unauthenticated.**
Location: `app/api/staff/route.ts`, `app/api/staff/[staffId]/route.ts`, `app/api/audit/route.ts`, `app/api/setup/route.ts`, `app/api/admin/security/route.ts`, `proxy.ts`. Claim: P1 blockers (unauthenticated staff CRUD, spoofable `?actor=` identity, unauthenticated manager invitation, IDOR on staff mutation) are still present in the tree P2 built on. P2 added no new API surface, so no new exploit, but the trust boundary P5/P6 will rely on to gate `finalizeOrder`/`reserveInventory` is still absent. P1 finding carried forward, not a P2 regression. Tags: security-R1.

### Minors (useful, fix if time allows)

**m1 — `finalizeOrder` does not enforce season `OPEN` status.** `lib/orders.ts:16-45`. Engine reads `Season.nextOrderNumber` under `FOR UPDATE` but never checks `season.status === "OPEN"`; an order attached to a `CLOSED` season can be finalized. P3 will enforce at the route layer (R-002); engine provides no defense-in-depth. Tags: security-m1.

**m2 — Customer dedupe is bypassable via nullable unique columns (customer may have neither email nor phone).** `prisma/schema.prisma:200-211` (and 202-203). `emailNormalized`/`phoneNormalized` are `String? @unique`; Postgres allows multiple NULLs, so partial-null customers evade dedupe. No CHECK forces at least one identifier. Tags: security-m2, quality-L4.

**m3 — `Order.draftReference` has no anti-enumeration strategy and no generator helper.** `prisma/schema.prisma:253`, `prisma/seed.ts:60-67`, `tests/domain-core.test.ts:34-40`. Plain unique string with no `@default`, no minimum entropy, no `createDraftReference()` helper (Rule of 2 already met via seed + test). Seed hardcodes `"DRAFT-SEED-2026"`. R-121 (P5) inherits an enumeration vector at the data layer. Tags: security-m3, cleancode-m3.

**m4 — Unvalidated `Json` columns accept arbitrary structured data.** `prisma/schema.prisma:254,284,353,101,495`. Five `Json` columns (`Order.wireFormat`, `OrderLine.optionSnapshot`, `PackageAudit.details`, `AuditEvent.details`, `CronRunLog.details`) written with no Zod parse and no size cap; audit trails are PII-bearing. Tags: security-m4.

**m5 — No non-negative CHECK constraints on money or quantity columns.** `prisma/schema.prisma:448-449,255-258,366`. Engine enforces non-negative in `WHERE`, but schema has no `CHECK (quantityOnHand >= 0)` / `CHECK (amountCents >= 0)`. A direct write (seed, backfill, future unguarded route) can persist negative values. Tags: security-m5.

**m6 — Grouping engine test only varies `greeting`.** `tests/domain-core.test.ts:8-18`. Test asserts identical-key merge and greeting-split, but never asserts that differing `recipientKey`, `addressId`, or `fulfillmentMethodId` each produce a separate group. A regression dropping one field from the key would not be caught. Tags: quality-L1.

**m7 — `smoke-p2.ts` prints "passed" without asserting outcomes (S1 proof does not verify seed entities exist).** `scripts/smoke-p2.ts:3-13` (and 7-12). Unconditionally logs "S1 migrations and seed passed." after running commands; never queries the DB to confirm Season/Product/Customer/Order exist. Violates anti-hallucination. Tags: quality-L2, cleancode-m5.

**m8 — `InventoryReservation` has no link to `OrderLine`; `reserveInventory` cannot link an add-on reservation to its `OrderLineAddOn`.** `prisma/schema.prisma:462-474`, `lib/inventory.ts:4-31`. Schema defines `orderLineAddOnId` (nullable FK) and the `InventoryItem` XOR CHECK, but `reserveInventory` only accepts `inventoryItemId, quantity, orderId` — never sets `orderLineAddOnId`. Add-on reservations are written with null `orderLineAddOnId`; main-product reservations cannot tie to a specific order line. Asymmetry will complicate per-line release in P5. Tags: quality-L3, rules-m2.

**m9 — Greeting case-folding is a silent business decision in the grouping key.** `lib/packages.ts:8-15`. `createPackageGroupingKey` lowercases `recipientKey` but only trims `greeting`; "Happy Purim" and "happy purim" split into two packages for the same recipient/address/method. Plan says key is "recipient/address/method/greeting"; whether greeting is case-folded is a domain rule chosen silently. Tags: rules-m3.

**m10 — Error messages state what went wrong but not the expected state.** `lib/orders.ts:12,19,26,36,49`, `lib/inventory.ts:10`. Five P2 error strings state only the failure (no allowed set, no expected version, no range). Violates clean-code Error Handling rule. Tags: rules-m4.

**m11 — Seed clobbers `quantityReserved` to 0 on re-run.** `prisma/seed.ts:69-73`. `inventoryItem.upsert`'s update branch sets `quantityReserved: 0` while `InventoryReservation` rows are untouched; outstanding reservations become orphaned from the on-hand count. Tags: rules-m5.

**m12 — Seed hand-rolls a normalized address with a magic delimiter and no helper (`normalizeAddress` missing).** `lib/foundation.ts:14-20`, `prisma/seed.ts:40,50`. Literal `"1 seed street|brooklyn|ny|11201|us"` duplicated inline; `foundation.ts` ships `normalizeEmail`/`normalizePhone` only. `Address.normalizedAddress` is `@unique` + `@@unique([customerId, normalizedAddress])` — load-bearing format, undefined. Tags: rules-m6, cleancode-m2.

**m13 — `settings.ts` is an in-memory static map, not the typed key-value `AppSetting` store.** `lib/settings.ts:1-19`. `getSetting`/`setSetting` read/mutate a module-level constant; no `prisma.appSetting` call. P2 relies on it for `seasonTimezone` (auto-flip open question 7) — non-persistent. Violates R-161 and single-source-of-truth. Tags: rules-m7.

**m14 — `prisma/schema.prisma` is 541 lines and mixes 12 concerns (god-file trajectory).** `prisma/schema.prisma:1-541`. 24 models spanning identity, settings, catalog, customer, order, package, payment, shipping, inventory, geocode, cron, BOM. Not yet over the 500-line threshold but trajectory is clear; Prisma `prismaSchemaFolder` preview feature supports multi-file split. Tags: cleancode-m1.

**m15 — `groupPackageCandidates` returns the JSON-stringified key as `key` (leaky serialization).** `lib/packages.ts:8-31`. `key` is a raw JSON string; callers needing structured fields must re-parse, and `Package.groupingKey` stores it, coupling storage format to grouping logic. `JSON.stringify` is fragile w.r.t. `undefined` vs `null`. A typed return with separate `serializeGroupingKey()` would be clearer. Tags: cleancode-m4.

**m16 — `tests/concurrency.test.ts` named generically but tests P1 staff-store, not P2.** `tests/concurrency.test.ts:1-34`. File only exercises `addStaff`/`updateStaff`; P2 concurrency tests live in `domain-core.test.ts`. Misleading filename. Tags: cleancode-m6.

**m17 — Magic year offsets in P2 tests.** `tests/domain-core.test.ts:31,51`. `300000 + Math.floor(Math.random() * 100000)` and `400000 + ...` used as season years; unexplained magic numbers, no named constant or comment. Tags: cleancode-m7.

## Notes

- All findings within P2 deliverables; no out-of-phase scope introduced. P2 did not add new API surface, so M2 and R1 are latent trust-boundary gaps rather than live exploits.
- The four-source `discardOrder` overlap (M1) is the single highest-leverage fix: it collapses a security, quality, rules, and clean-code finding into one code change.
- Security blockers rule: none present in P2 (security review reported 0 blockers); all security findings are Major or Minor and survive dedupe on their own merits.
- No new findings introduced during aggregation.
