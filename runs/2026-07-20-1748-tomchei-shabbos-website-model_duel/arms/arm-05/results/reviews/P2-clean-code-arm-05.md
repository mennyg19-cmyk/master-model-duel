# P2 Clean-code Review — arm-05

Reviewer: clean-code specialist (blind).
Scope: P2 only — domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine.
Reference rules: `arms/arm-05/.cursor/rules/clean-code.mdc`.
Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |

---

## Major

### M1 — Two concurrency-control patterns for the same concern in P2

**Location:** `lib/orders.ts:16-45` (`finalizeOrder`), `lib/inventory.ts:4-31` (`reserveInventory`)

**Claim:** Both functions solve the same problem — safe concurrent mutation of versioned domain rows — using two different strategies. `finalizeOrder` does a `SELECT ... FOR UPDATE` on the Season row via raw SQL, then an `updateMany` with a `version` predicate on the Order. `reserveInventory` does a single atomic conditional `UPDATE ... WHERE ... RETURNING` on InventoryItem. Both are correct in isolation, but P2 introduces two competing patterns for the same concern (concurrent mutation safety). Violates "One state management pattern per project" / "One error-handling approach per project" from the consistency rule, and the anti-AI-tics rule "No copy-paste patterns with minor variations — extract the pattern."

**Evidence:**

```16:45:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/orders.ts
export async function finalizeOrder(orderId: string) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order was not found.");
    assertOrderTransition(order.status, "FINALIZED");

    const seasons = await transaction.$queryRaw<{ nextOrderNumber: number }[]>(
      Prisma.sql`SELECT "nextOrderNumber" FROM "Season" WHERE "id" = ${order.seasonId} FOR UPDATE`,
    );
    const season = seasons[0];
    if (!season) throw new Error("Order season was not found.");

    const claimed = await transaction.order.updateMany({
      where: { id: orderId, status: "DRAFT", version: order.version },
      data: {
        status: "FINALIZED",
        orderNumber: season.nextOrderNumber,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw new Error("Order changed before it could be finalized.");
```

```13:31:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/inventory.ts
  return prisma.$transaction(async (transaction) => {
    const reserved = await transaction.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        UPDATE "InventoryItem"
        SET "quantityReserved" = "quantityReserved" + ${quantity}, "version" = "version" + 1
        WHERE "id" = ${inventoryItemId}
          AND "isActive" = true
          AND "quantityOnHand" - "quantityReserved" >= ${quantity}
        RETURNING "id"
      `,
    );
    if (reserved.length !== 1) return false;

    await transaction.inventoryReservation.create({
      data: { inventoryItemId, quantity, orderId },
    });
    return true;
```

---

### M2 — `discardOrder` skips the optimistic-version check that `finalizeOrder` uses

**Location:** `lib/orders.ts:47-56`

**Claim:** `finalizeOrder` guards against concurrent modification with `updateMany({ where: { version: order.version } })` and throws "Order changed before it could be finalized." when `claimed.count !== 1`. `discardOrder` — the sibling transition on the same entity — calls `prisma.order.update` directly with no version predicate. A concurrent `finalizeOrder` can land between `discardOrder`'s `findUnique` read and its `update`, and the discard will silently overwrite the finalized order's status without detecting the conflict. Same file, same entity, two different concurrency strategies. Violates "Inconsistent patterns — pick one, apply everywhere" and is a correctness risk on the state machine the plan calls out as keystone (arm-02 risk #1).

**Evidence:**

```47:56:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/orders.ts
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

---

### M3 — Three different error-handling patterns across P1+P2

**Location:** `lib/orders.ts` (throw `Error`), `lib/inventory.ts` (return `boolean`), `lib/staff-store.ts` (return `{ ok, reason, status }`)

**Claim:** P2 introduces two new error-handling patterns that do not match the existing P1 result-object pattern. `finalizeOrder`/`discardOrder` throw plain `Error` on not-found and conflict. `reserveInventory` returns `true`/`false` and throws nothing on conflict. `addStaff`/`updateStaff` (P1) return `{ ok: false, status, reason }`. Three patterns for "operation failed" across the same codebase. Violates "One error-handling approach per project." Callers cannot write one consistent handler.

**Evidence:**

```9:11:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/inventory.ts
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Inventory reservation quantity must be a positive whole number.");
  }
```

```24:24:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/inventory.ts
    if (reserved.length !== 1) return false;
```

```19:19:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/orders.ts
    if (!order) throw new Error("Order was not found.");
```

```173:178:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/staff-store.ts
  if (outcome.count === 0) {
    const staffMember = await prisma.staffUser.findUnique({ where: { id: staffId } });
    return staffMember
      ? { ok: false as const, status: 409, reason: "This staff record changed. Refresh before saving." }
      : { ok: false as const, status: 404, reason: "Staff account was not found." };
  }
```

---

## Minor

### m1 — `prisma/schema.prisma` is 541 lines and mixes 12 concerns (god-file trajectory)

**Location:** `prisma/schema.prisma:1-541`

**Claim:** The schema file carries identity, settings, catalog, customer, order, package, payment, shipping, inventory, geocode, cron, and BOM models in one file. At 541 lines after P2 with 10 phases still to land, this is on track to exceed the 500-line god-file threshold the rule sets ("split when >500 lines, mixed concerns"). Prisma supports multi-file schemas via the `prismaSchemaFolder` preview feature. Not yet over the line but the trajectory is clear and the concerns are already separable.

**Evidence:** See schema — 24 models spanning 12 domain concerns in a single file.

---

### m2 — `normalizeAddress` helper missing while `normalizeEmail` and `normalizePhone` exist

**Location:** `lib/foundation.ts:14-20`, `prisma/seed.ts:40,50`

**Claim:** `foundation.ts` exposes `normalizeEmail` and `normalizePhone` but no `normalizeAddress`, even though `Address.normalizedAddress` is a `@unique` column whose format the seed inlines as `"1 seed street|brooklyn|ny|11201|us"`. The normalization format (lowercase, pipe-delimited) is implicit and duplicated in the seed. The P2 deliverable (R-144) calls for normalized dedupe; address normalization is required for the unique constraint but has no helper. Future checkout (P4) will need the same format and will reinvent or diverge. Violates "Centralize … single source of truth" and the established normalization pattern.

**Evidence:**

```14:20:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/foundation.ts
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^1/, "");
}
```

```40:50:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/prisma/seed.ts
        normalizedAddress: "1 seed street|brooklyn|ny|11201|us",
      },
    },
    update: { recipientName: "Seed Customer" },
  });
```

---

### m3 — `Order.draftReference` has no generator helper (Rule of 2 already met)

**Location:** `prisma/seed.ts:60-67`, `tests/domain-core.test.ts:34-40`

**Claim:** The plan (R-047) calls for "draft reference numbers + wire format." The seed hardcodes `DRAFT-SEED-2026`; tests inline `DRAFT-FINALIZE-${crypto.randomUUID()}-${suffix}`. `lib/foundation.ts` already has `createPublicId(prefix)` for the same shape of need. Two call sites exist in P2 and checkout (P4) will be the third, so Rule of 2 is satisfied. No `createDraftReference()` helper exists, so each caller invents a format and the column's contract is implicit.

**Evidence:**

```60:67:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/prisma/seed.ts
  await prisma.order.upsert({
    where: { draftReference: "DRAFT-SEED-2026" },
    create: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: "DRAFT-SEED-2026",
      wireFormat: { version: 1, lines: [] },
    },
```

```34:40:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/tests/domain-core.test.ts
    ["one", "two"].map((suffix) => prisma.order.create({
      data: {
        seasonId: season.id,
        draftReference: `DRAFT-FINALIZE-${crypto.randomUUID()}-${suffix}`,
        wireFormat: { version: 1 },
      },
    })),
```

---

### m4 — `groupPackageCandidates` returns the JSON-stringified key as `key` (leaky serialization)

**Location:** `lib/packages.ts:8-31`

**Claim:** `createPackageGroupingKey` builds the key via `JSON.stringify([...])` and `groupPackageCandidates` returns `{ key, candidates }` where `key` is that raw JSON string. Callers needing the structured fields must re-parse. The Package entity's `groupingKey` column then stores this JSON string, coupling storage format to grouping logic. `JSON.stringify` is also fragile — `addressId` is `string | null`; a caller passing `undefined` serializes as `null` and collides with explicit `null`. A typed return (`{ recipientKey, addressId, fulfillmentMethodId, greeting }`) with a separate `serializeGroupingKey()` for storage would be clearer.

**Evidence:**

```8:15:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/packages.ts
export function createPackageGroupingKey(candidate: PackageCandidate) {
  return JSON.stringify([
    candidate.recipientKey.trim().toLowerCase(),
    candidate.addressId,
    candidate.fulfillmentMethodId,
    candidate.greeting.trim(),
  ]);
}
```

---

### m5 — `scripts/smoke-p2.ts` prints "passed" without asserting outcomes

**Location:** `scripts/smoke-p2.ts:7-12`

**Claim:** After each `runWithLocalDatabase` call the script unconditionally logs `"S1 migrations and seed passed."`, `"S2 grouping engine passed."`, etc. The lines are printed even if the underlying command partially succeeded or no-oped. There is no assertion that the seed actually created the expected rows, that grouping tests ran (vs. being skipped via `skip: !process.env.DATABASE_URL`), or that the order-number race actually executed. Violates the anti-hallucination rule: "Do not claim 'fixed/passed/working' without tool output or running-app evidence."

**Evidence:**

```7:12:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/scripts/smoke-p2.ts
  await runWithLocalDatabase("tsx", ["--test", "tests/domain-core.test.ts"]);
  console.log("S1 migrations and seed passed.");
  console.log("S2 grouping engine passed.");
  console.log("S3 order state machine passed.");
  console.log("S4 concurrent order numbers passed.");
  console.log("S5 inventory reservation race passed.");
```

---

### m6 — `tests/concurrency.test.ts` named generically but tests P1 staff-store, not P2

**Location:** `tests/concurrency.test.ts:1-34`

**Claim:** The file is named `concurrency.test.ts` (suggesting it owns the concurrency suite) but only exercises `addStaff`/`updateStaff` from `lib/staff-store` (P1). P2's actual concurrency tests (concurrent order-number finalization, inventory race) live in `domain-core.test.ts`. The name is misleading — a reader looking for P2 concurrency tests will not find them under the obvious filename. Either rename the file to scope it to staff, or move the P2 concurrency tests in.

**Evidence:**

```3:3:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/tests/concurrency.test.ts
import { addStaff, updateStaff } from "../lib/staff-store";
```

```27:33:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/tests/concurrency.test.ts
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      updateStaff(actor.id, created.staffMember.id, 1, { role: "STAFF", overrides: {} }),
    ),
  );
  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
```

---

### m7 — Magic year offsets in P2 tests

**Location:** `tests/domain-core.test.ts:31,51`

**Claim:** `300000 + Math.floor(Math.random() * 100000)` and `400000 + Math.floor(Math.random() * 100000)` are used as season years for test isolation. The offsets are unexplained magic numbers — a future reader has no idea why year 300000+ is chosen or whether colliding with real season years (e.g. 2026) is intentional. No named constant, no comment explaining the intent (avoid colliding with the seeded 2026 season and the `@unique` year constraint).

**Evidence:**

```31:31:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/tests/domain-core.test.ts
    data: { name: "Finalization fixture", year: 300000 + Math.floor(Math.random() * 100000) },
```

```51:51:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/tests/domain-core.test.ts
    data: { name: "Inventory fixture", year: 400000 + Math.floor(Math.random() * 100000) },
```
