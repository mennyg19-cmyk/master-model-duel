# P2 Security Review — arm-01 (blind)

**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Scope reviewed:** `prisma/schema.prisma`, `prisma/migrations/20260720210000_p2_domain_core/migration.sql`, `prisma/seed.ts`, `src/domain/order-engine.ts`, `src/domain/package-stage.ts`, `src/domain/inventory.ts`, `src/domain/package-grouping.ts`, `tests/domain-core.test.ts`, `scripts/concurrency-smoke.ts`, `.env`, `.env.example`, `.gitignore`
**Method:** Findings only — no fixes. No new scope beyond P2.
**Reviewer family:** Security specialist (blind to model name).

## Summary

P2 is schema + engine only (no UI, no API surface), so the attack surface is small. The grouping engine, order state machine, and inventory reservation engine are well-built with optimistic versioning and serializable isolation. The main gaps are missing DB-level integrity constraints on monetary columns and a few forward-looking concerns deferred to later phases.

## Findings

### S1 — Medium — No DB-level CHECK constraints on monetary totals

**Location:** `prisma/migrations/20260720210000_p2_domain_core/migration.sql` (lines 132–150, 236–250, 253–265, 268–282)

The migration adds `CHECK` constraints for `OrderLine.quantity`/`unitPriceCentsSnapshot`, `OrderLineAddOn.quantity`/`unitPriceCentsSnapshot`, and `InventoryItem` quantities, but adds **none** for:
- `Order.subtotalCents`, `Order.totalCents`
- `Payment.amountCents`
- `StripePaymentIntent.amountCents`
- `ShippingQuote.amountCents`
- `Season.nextOrderNumber`

Negative or zero monetary amounts can be persisted at the DB layer. A negative `Payment.amountCents` is a fraud surface (a posted "payment" that reduces balance); a negative `Order.totalCents` breaks downstream money math. Defense-in-depth for a payments schema should enforce `>= 0` (or `> 0` where appropriate) at the DB layer, not only in application code that may not yet exist (P5).

### S2 — Low — `Payment` lacks optimistic versioning and status guard

**Location:** `prisma/schema.prisma` lines 419–434; migration lines 236–250

`Payment` has no `version` column and no DB-level guard that a `POSTED` payment cannot be re-posted or a `VOIDED` payment voided twice. Concurrent staff actions (post + void, or two voids) can both succeed, with the second overwriting `voidedAt`/`voidedByStaffId` and producing duplicate audit rows. The plan defers payment lifecycle logic to P5, but the schema landed in P2 without a `version` column; adding one now would let P5 enforce single-winner transitions the same way `Package` and `InventoryItem` do.

### S3 — Low — `Order.draftReference` is a predictable sequential wire format

**Location:** `src/domain/order-engine.ts` lines 15–21; `prisma/schema.prisma` line 302 (`draftReference @unique`)

`formatDraftReference` emits `D-` + zero-padded sequence (`D-00000001`, `D-00000042`). The column is `@unique` and is the only client-facing order handle defined in P2. If exposed to guest checkout clients it is trivially enumerable. The plan defers anti-enumeration to P5 (R-121 guest checkout tokens), but the P2 schema stores only the sequential reference — there is no unguessable draft-access token column. Flag now so P5 adds an opaque token and never routes guest draft access through `draftReference` alone.

### S4 — Low — Untyped JSONB columns hold PII-bearing snapshots and settings

**Location:** `prisma/schema.prisma` — `Package.addressSnapshot` (line 378), `PickupLocation.address` (line 473), `AppSetting.value` (line 137), `AuditLog.metadata` (line 148), `PackageAudit.metadata` (line 413)

These are untyped `Json`/`JSONB` with no DB-level shape validation. `addressSnapshot` and `PickupLocation.address` carry recipient PII; `AppSetting.value` could be misused to store secrets; audit `metadata` can absorb arbitrary PII or secrets if a future logger is careless. Lack of structure risks inconsistent snapshots and makes PII minimization / retention harder. Consider a typed address shape and a "no secrets in AppSetting" rule.

### S5 — Informational — `SEED_DEMO_STAFF` provisions a Manager with a hardcoded Clerk user ID

**Location:** `prisma/seed.ts` lines 163–176

When `SEED_DEMO_STAFF=true`, the seed creates an active `MANAGER` `StaffUser` with `clerkUserId: "seed_manager"`. If this flag is enabled outside test/CI, any party that controls the Clerk account mapped to `seed_manager` gets Manager access to the org. The flag is env-gated and not set in `.env`, but there is no hard guard preventing it from being flipped in a non-test deployment. Ensure the flag is hard-scoped to test/CI (e.g., fail-fast when `NODE_ENV=production`).

### S6 — Informational — `concurrency-smoke.ts` writes an active STAFF user directly to the DB

**Location:** `scripts/concurrency-smoke.ts` lines 6–16

The smoke script upserts an active `STAFF` `StaffUser` (`concurrency@example.test`) against the live `DATABASE_URL`. If executed against a non-disposable database it provisions a standing staff account. Ensure smoke scripts are scoped to disposable/test databases only (the plan's disposable migration harness is the intended home).

### S7 — Informational — Real local DB credential present in workspace `.env`

**Location:** `arms/arm-01/workspace/.env` line 1

`.env` contains `DATABASE_URL=postgresql://postgres:tomchei_local_p1@127.0.0.1:4101/...`. `.gitignore` excludes `.env*` (except `.env.example`), so it will not be committed, but the file is present in the run archive tree. The password is weak and org-identifying. If the run archive is shared/zipped outside git the credential leaks. Rotate on any sharing. (P1 env-hygiene concern surfacing through P2 seed/migration runs.)

### S8 — Informational — `Season.nextOrderNumber` has no floor constraint

**Location:** `prisma/schema.prisma` line 183; migration line 42

`nextOrderNumber` defaults to 1 and is incremented atomically by `claimOrderNumber`, but there is no DB-level `CHECK (nextOrderNumber >= 1)`. Direct DB manipulation or a future buggy code path could drive it to 0 or negative, producing order numbers ≤ 0. Defense-in-depth only.

## Positive observations (no action)

- `reserveInventory` uses Prisma's tagged-template raw SQL — `${quantity}` and `${inventoryItemId}` are parameterized; no string interpolation, no injection vector.
- `InventoryItem` XOR (`productId`/`addOnId`) and quantity (`onHand >= 0`, `reserved >= 0`, `reserved <= onHand`) CHECK constraints are correctly enforced at the DB layer.
- `claimOrderNumber` uses `Serializable` isolation, atomic `season.nextOrderNumber` increment, and a conditional `updateMany` (`status: DRAFT, orderNumber: null`) so only one concurrent finalization wins; retries on `P2034`.
- `advancePackageStage` and `discardDraft` use conditional `updateMany` with `count` assertions, preventing lost updates and double-discards.
- `Package.recipientAddressId ON DELETE SET NULL` plus `addressSnapshot Json?` preserves fulfillment audit even if an address is deleted.
- `StaffInvite.tokenHash` and `SessionStamp.ipHash` store hashes, not raw tokens/IPs (P1, but carried forward cleanly).
- `StripePaymentIntent.stripePaymentIntentId` and `idempotencyKey` are `@unique`, supporting webhook idempotency.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Informational | 3 |
| **Total** | **8** |
