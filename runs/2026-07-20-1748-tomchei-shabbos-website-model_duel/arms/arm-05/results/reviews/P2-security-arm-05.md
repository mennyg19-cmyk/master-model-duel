# P2 Security Review — arm-05 (blind)

**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Scope:** trust boundaries, auth, secrets, IDOR, injection on P2 domain/schema/engines. Findings only — no fixes.
**Evidence base:** `arms/arm-05/workspace/` (`prisma/schema.prisma`, `prisma/migrations/20260727172758_p2_domain_core/migration.sql`, `lib/orders.ts`, `lib/packages.ts`, `lib/inventory.ts`, `prisma/seed.ts`, `tests/domain-core.test.ts`, `scripts/smoke-p2.ts`, `.scratch/PHASE-P2-STATUS.md`, `.scratch/PHASE-P2-SMOKE.md`).

## Summary counts

- Blockers: 0
- Major: 4
- Minor: 5
- P1 residual (still open, relevant): 1

---

## Major

### M1 — `discardOrder` has a TOCTOU race with no optimistic version guard

**Location:** `lib/orders.ts:47-56`
**Claim:** `discardOrder` reads the order, runs `assertOrderTransition` against the snapshot, then issues a plain `prisma.order.update({ where: { id: orderId }, data: { status: "DISCARDED", version: { increment: 1 } } })`. The update carries no `status`/`version` predicate, so a concurrent `finalizeOrder` that commits between the read and the update will be silently overwritten by the discard, producing an illegal `FINALIZED → DISCARDED` transition that the state machine is supposed to reject.
**Evidence:**

```47:56:lib/orders.ts
export async function discardOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order was not found.");
  assertOrderTransition(order.status, "DISCARDED");

  return prisma.order.update({
    where: { id: orderId },
    data: { status: "DISCARDED", version: { increment: 1 } },
  });
}
```

`finalizeOrder` (lines 28-35) protects itself with `updateMany` + `version` predicate; `discardOrder` does not. The state-machine unit test (`tests/domain-core.test.ts:20-25`) only exercises the synchronous `assertOrderTransition` path, not the race.

### M2 — Engine functions accept raw IDs with no authz or ownership scoping (IDOR-ready)

**Location:** `lib/orders.ts:16` (`finalizeOrder(orderId)`), `lib/orders.ts:47` (`discardOrder(orderId)`), `lib/inventory.ts:4-31` (`reserveInventory(inventoryItemId, quantity, orderId?)`)
**Claim:** Every P2 engine entrypoint trusts the caller to supply arbitrary entity IDs and performs no staff-permission, customer-ownership, or season-tenancy check. Any future route that forwards a path/body parameter to these functions becomes an IDOR by construction. `reserveInventory` additionally accepts an `orderId` it does not verify belongs to the caller, so a network caller can pin reservations to another customer's order.
**Evidence:** None of the three functions import or call `authorize`, `hasStaffPermission`, `findStaffByClerkUserId`, or any ownership predicate. The `InventoryReservation` row is written with the supplied `orderId` verbatim (`lib/inventory.ts:26-28`). P2 ships no API surface, so this is a latent trust-boundary gap rather than a live exploit, but the engine is the boundary P5/P6 will wrap — there is no defensive layer here.

### M3 — Deleting a customer or address silently orphans orders and packages, breaking ownership chains

**Location:** `prisma/schema.prisma:261` (`Order.customer` `onDelete: SetNull`), `prisma/schema.prisma:322` (`Package.address` `onDelete: SetNull`), `prisma/schema.prisma:228` (`Address.customer` `onDelete: Cascade`)
**Claim:** `Order.customerId` and `Package.addressId` are nullable with `onDelete: SetNull`. Deleting a `Customer` cascades to their `Address` rows, which in turn nullifies `Package.addressId` for every package built from those addresses, while `Order.customerId` is also nullified. After deletion, orders and packages carry no ownership pointer, so any later phase that enforces "customer may only read their own orders/packages" (R-042, R-043) cannot reconstruct ownership and must either deny legitimate access or admit unowned rows to everyone.
**Evidence:**

```261:261:prisma/schema.prisma
  customer              Customer?              @relation(fields: [customerId], references: [id], onDelete: SetNull)
```

```322:322:prisma/schema.prisma
  address             Address?          @relation("PackageAddress", fields: [addressId], references: [id], onDelete: SetNull)
```

```228:228:prisma/schema.prisma
  customer          Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### M4 — Audit attribution is silently nullified on staff deletion

**Location:** `prisma/schema.prisma:98` (`AuditEvent.actor` `onDelete: SetNull`), `prisma/schema.prisma:355` (`PackageAudit.actor` `onDelete: SetNull`), `prisma/schema.prisma:110` (`SessionLoginStamp` `onDelete: Cascade`)
**Claim:** The security audit trail (`AuditEvent`) and the package-level audit trail (`PackageAudit`) both retain their `actorId` only as a nullable FK with `onDelete: SetNull`. Revoking or deleting a staff user (P1 supports both) severs the link between historical audit rows and the actor, allowing a malicious manager-class actor to erase attribution of past actions by deleting the implicated staff record. `SessionLoginStamp` is worse: `onDelete: Cascade` deletes the login history outright on staff deletion.
**Evidence:**

```98:98:prisma/schema.prisma
  actor     StaffUser? @relation("AuditActor", fields: [actorId], references: [id])
```

```355:355:prisma/schema.prisma
  actor     StaffUser? @relation(fields: [actorId], references: [id], onDelete: SetNull)
```

```110:110:prisma/schema.prisma
  staff     StaffUser @relation(fields: [staffId], references: [id], onDelete: Cascade)
```

`actor` on `AuditEvent` (line 98) omits an explicit `onDelete`, so Prisma defaults to `SetNull` for optional relations — same effect.

---

## Minor

### m1 — `finalizeOrder` does not enforce season `OPEN` status

**Location:** `lib/orders.ts:16-45`
**Claim:** The finalize engine reads `Season.nextOrderNumber` under `FOR UPDATE` but never checks `season.status === "OPEN"`. An order attached to a `CLOSED` season can be finalized and claim a sequence number. P3 is slated to enforce closure at the route layer (R-002), but the engine itself is the last trust boundary and provides no defense-in-depth.
**Evidence:** No reference to `SeasonStatus` or `season.status` appears in `lib/orders.ts`. `assertOrderTransition` only validates `OrderStatus`.

### m2 — Customer dedupe is bypassable via nullable unique columns

**Location:** `prisma/schema.prisma:202-203`
**Claim:** `Customer.emailNormalized` and `phoneNormalized` are `String?` with `@unique`. Postgres allows multiple `NULL` rows on a unique index, so customers created without an email (or without a phone) are never deduped against each other. The plan (R-144) calls for normalized phone/email dedupe; partial-null customers silently evade it.
**Evidence:**

```202:203:prisma/schema.prisma
  emailNormalized String?            @unique
  phoneNormalized String?            @unique
```

### m3 — `Order.draftReference` has no anti-enumeration strategy at the schema/engine layer

**Location:** `prisma/schema.prisma:253` (`draftReference String @unique`), `prisma/seed.ts:60-68`
**Claim:** `draftReference` is the only externally referenceable order identifier in the P2 schema. It is a plain unique string with no generation strategy, no minimum entropy, and no collision-safe generator in the engine. The seed hardcodes `"DRAFT-SEED-2026"`. R-121 (P5) is supposed to add anti-enumeration for guest draft tokens, but the P2 field itself places no constraint on predictability, so any P5 implementation that reuses a sequential or guessable reference inherits an enumeration vector at the data layer.
**Evidence:** No `@default`, no helper in `lib/orders.ts` or `lib/foundation.ts` mints a `draftReference`. The seed value is a literal.

### m4 — Unvalidated `Json` columns accept arbitrary structured data

**Location:** `prisma/schema.prisma:254` (`Order.wireFormat`), `prisma/schema.prisma:284` (`OrderLine.optionSnapshot`), `prisma/schema.prisma:353` (`PackageAudit.details`), `prisma/schema.prisma:101` (`AuditEvent.details`), `prisma/schema.prisma:495` (`CronRunLog.details`)
**Claim:** Five `Json` columns are written by the engine or seed with no schema, no Zod parse, and no size cap. `PackageAudit.details` and `AuditEvent.details` are particularly sensitive because they are intended to record PII-bearing actions; nothing prevents a future caller from persisting unbounded or sensitive payloads into the audit trail.
**Evidence:** `seed.ts:65` writes `wireFormat: { version: 1, lines: [] }` directly; no validator sits between caller and column. No `z.object` definition exists for any of these fields in `lib/`.

### m5 — No non-negative CHECK constraints on money or quantity columns

**Location:** `prisma/schema.prisma:448-449` (`InventoryItem.quantityOnHand`, `quantityReserved`), `prisma/schema.prisma:255-258` (`Order.subtotalCents`/`fulfillmentCents`/`donationCents`/`totalCents`), `prisma/schema.prisma:366` (`Payment.amountCents`)
**Claim:** `reserveInventory` enforces the non-negative invariant in its `WHERE` clause, but the schema itself places no `CHECK (quantityOnHand >= 0)` / `CHECK (amountCents >= 0)` constraint. A direct write (seed, migration backfill, or a future unguarded route) can persist negative money or negative reserved quantities that the engine logic would then treat as valid.
**Evidence:** The only CHECK in the P2 migration is the XOR target constraint on `InventoryItem` (`migration.sql:328-329`). No sign constraints on money/quantity columns.

---

## P1 residual (still open, relevant to P2 trust boundary)

### R1 — All staff-management and audit API routes remain unauthenticated

**Location:** `app/api/staff/route.ts`, `app/api/staff/[staffId]/route.ts`, `app/api/audit/route.ts`, `app/api/setup/route.ts`, `app/api/admin/security/route.ts`, `proxy.ts`
**Claim:** The P1 blockers (unauthenticated staff CRUD, spoofable `?actor=` identity, unauthenticated manager invitation, IDOR on staff mutation) are still present in the tree P2 built on. P2 did not add new API surface, so no new exploit is introduced, but the trust boundary that P5/P6 will rely on to gate `finalizeOrder` / `reserveInventory` is still absent. Wiring the P2 engine into the existing `/api/staff`-class attack surface would expose order finalization and inventory reservation to unauthenticated callers.
**Evidence:** `proxy.ts` matcher still excludes `/api/staff`, `/api/audit`, `/api/setup`. No `authorize(...)` call has been added to any P1 route. This is a P1 finding carried forward, not a P2 regression.

---

## Positive notes (out of scope, no finding)

- `lib/orders.ts` and `lib/inventory.ts` use `Prisma.sql` template literals with parameterized values for all `$queryRaw` — no string concatenation, no SQL injection vector in the engine.
- `lib/packages.ts` `createPackageGroupingKey` builds the grouping key with `JSON.stringify` of caller-supplied values; the key is stored as `TEXT` and never interpolated into SQL — no injection risk.
- The `InventoryItem` XOR CHECK constraint (`migration.sql:328-329`) correctly enforces exactly-one-target using `<>` on NULL checks, matching R-139.
- `finalizeOrder` uses `SELECT ... FOR UPDATE` on `Season` plus an optimistic `version` predicate on `Order.updateMany`, so concurrent finalizations cannot double-claim a sequence number (confirmed by `tests/domain-core.test.ts:27-45`).
- `reserveInventory` performs an atomic conditional `UPDATE ... WHERE quantityOnHand - quantityReserved >= quantity` — the last-unit race resolves to exactly one winner (confirmed by `tests/domain-core.test.ts:47-73`).
