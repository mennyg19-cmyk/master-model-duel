# P2 Security Review — arm-06 (blind)

Reviewer: external security reviewer
Scope: `arms/arm-06/workspace/` only — Test 4 P2 (Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory)
Reference: `shared/phases/PHASE-P2-EXPECTED.md`
Mode: Findings only — no fixes. Severity: Blocker / Major / Minor. File cites are absolute paths under the arm.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 10 |

P2 adds no new HTTP surface — the engines live in `lib/` and are exercised only by `prisma/seed.ts` and the `scripts/test-*.mts` suite. There is therefore no IDOR, injection, or auth-bypass finding on new endpoints; the P1 authN/authZ layer (HMAC session, server-side `AuthSession` with expiry/revocation, role + override + impersonation-rank checks, audit trail with impersonator attribution) carries over unchanged and is sound. The findings below are trust-boundary and integrity gaps in the new domain engines and schema, measured against the P2 EXPECTED items. The most serious are the customer phone-dedupe race (M1), the `discardOrder` TOCTOU that can clobber a finalized order and orphan an order number (M2), and the `createDraftOrder` engine trusting caller-supplied prices/identities instead of snapshotting the catalog (M3).

---

## Major

### M1. Customer phone dedupe is broken under concurrency
**Files:**
- `arms/arm-06/workspace/prisma/schema.prisma` (`Customer.normalizedPhone` has `@@index([normalizedPhone])` but no `@unique`)
- `arms/arm-06/workspace/lib/customers/dedupe.ts` (`findFirst` then `create` — read-then-write, no transaction/lock)

EXPECTED item 2 mandates "normalized phone/email dedupe". The email arm is backed by `Customer.email @unique`, so the second of two concurrent signups with the same email fails on `P2002`. The phone arm has only a non-unique index, so two concurrent signups with different emails but the same normalized phone both pass the `findFirst` (neither sees the other's uncommitted row) and both `create` succeeds — producing two `Customer` rows sharing `normalizedPhone`. Dedupe is silently defeated for the phone path under concurrent signups/checkout, which is the exact scenario P2's race tests cover for inventory and order numbers but not for dedupe.

### M2. `discardOrder` has a TOCTOU race that can clobber a finalized order
**File:** `arms/arm-06/workspace/lib/orders/state-machine.ts` (`discardOrder`, lines 55–65)

`finalizeOrder` is safe: it claims the order number, then uses `tx.order.updateMany({ where: { id, status: "DRAFT" } })` so a second concurrent finalizer is a no-op (`count === 0 → throw → rollback`). `discardOrder` is inconsistent: it does `findUnique` → `assertTransition(DRAFT, DISCARDED)` → `tx.order.update({ where: { id } })` with **no status or version predicate** on the update. A concurrent sequence —
1. T2 `discardOrder` reads the order as `DRAFT` (before T1 commits);
2. T1 `finalizeOrder` claims order number N, flips `DRAFT → FINALIZED` via `updateMany WHERE status=DRAFT`, commits;
3. T2 `assertTransition` already passed, so `tx.order.update` overwrites `FINALIZED → DISCARDED`, `version++`.

— leaves the order `DISCARDED` while order number N was consumed from `seasons.lastOrderSeq` (a permanent gap in the per-season sequence) and the finalized state is lost. This violates EXPECTED item 8 (concurrency on order mutations) and is the same class of bug the `finalizeOrder` guard exists to prevent; `discardOrder` should use the identical `updateMany WHERE status=DRAFT` (or `version = expectedVersion`) pattern.

### M3. `createDraftOrder` trusts caller-supplied prices and product/option/add-on identities
**File:** `arms/arm-06/workspace/lib/orders/create-draft.ts` (lines 20–60)

EXPECTED item 3 requires "OrderLine tree with price snapshots". The engine instead accepts `unitPriceCents`, `optionPriceDeltaCents`, `productName`, `optionLabel`, `addOnId`, `parentLineId` directly from its caller and writes them to the snapshot without any cross-check against `Product.basePriceCents`, `ProductOptionValue.priceDeltaCents`, `AddOn.priceCents`, the product's `allowedAddOns`, or even that `productId`/`optionValueId`/`addOnId` exist. `OrderLine.productId`/`optionValueId`/`addOnId` are plain `String?` with no FK relation, so the DB cannot catch a fabricated id either. The engine is the natural trust boundary for "snapshot the catalog's price, not the caller's"; as written, any future checkout route that forwards client input to `createDraftOrder` is a price-injection and product-spoofing vulnerability (free orders, arbitrary `productName` text, add-ons attached to products that don't allow them). The P2 EXPECTED explicitly defers checkout UI, but the engine that checkout will call is the one shipped this phase, so the gap is scored here.

### M4. `postPayment` does not validate the target order's status
**File:** `arms/arm-06/workspace/lib/payments/post.ts` (`postPayment`, lines 7–26; `recomputePaymentStatus`, lines 43–58)

`postPayment` creates a `Payment` row and recomputes `Order.paymentStatus` unconditionally — it never checks that the order is `FINALIZED`. A caller can post a payment against a `DRAFT` order (inflating a not-yet-submitted cart) or, worse, against a `DISCARDED` order, which then flips the discarded order's `paymentStatus` to `PARTIAL`/`PAID`/`OVERPAID`. `voidPayment` similarly only checks the payment row's own `status === POSTED`, not the order's. There is no money movement in P2 (no HTTP surface), but the engine permits a payment/state-machine combination that EXPECTED items 4–5 (order state machine + posted/voided payments with cached status) implicitly forbid, and that later phases will expose.

---

## Minor

### m1. `buildGroupingKey` uses an unescaped `|` delimiter
**File:** `arms/arm-06/workspace/lib/packages/grouping.ts` (line 18)

The key is `recipientName | address | fulfillmentMethodCode | greeting` joined with `|`. `recipientName` and `greeting` are user-controllable and are only whitespace/case-normalized — a `|` inside either field is not escaped, so two inputs with field contents that split differently across the delimiter produce the same key (e.g. recipientName=`"a|b"` + greeting=`""` vs recipientName=`"a"` + greeting=`"b"`). Result: packages that should split get merged, or vice versa. Use a separator that cannot appear in the normalized fields, or length-prefix each field.

### m2. `normalizePhone` accepts any digit length and assumes US for 10 digits
**File:** `arms/arm-06/workspace/lib/phone.ts`

A 1-character input becomes `+1`; a 7-digit local number becomes `+7digits`; any non-US 10-digit number is silently prefixed with `1` (Canada/US country code). There is no length plausibility check, so garbage strings dedupe to short keys and a malformed phone can collide with a real one. Documented as "US default" but the engine is the dedupe key producer, so the weakness flows into M1's index.

### m3. `findOrCreateCustomer` silently drops the phone on an email match
**File:** `arms/arm-06/workspace/lib/customers/dedupe.ts` (lines 17–22)

When an existing customer matches on `email` but the new input carries a different `phone`, the function returns `{ customer: existing, created: false }` and never updates `existing.phone` / `existing.normalizedPhone`. The caller's phone is silently lost. Not a security hole, but a data-integrity gap on the dedupe path that pairs with M1.

### m4. `createDraftOrder` does not validate `qty` or `unitPriceCents` are non-negative
**File:** `arms/arm-06/workspace/lib/orders/create-draft.ts` (lines 31–34, 53)

`totalCents` and `lineTotalCents` are `qty * (unitPriceCents + optionPriceDeltaCents)`. A caller-supplied `qty: -1` or `unitPriceCents: -5000` produces a negative line total and a negative order total. `reserveStock` validates `qty > 0`, but the order engine does not, so an order can be created with a negative total and only caught later (or never, if the product is not inventory-tracked). Pair with M3.

### m5. `finalizeOrder` does not re-check `season.status === "OPEN"`
**File:** `arms/arm-06/workspace/lib/orders/state-machine.ts` (`finalizeOrder`, lines 31–53); cf. `lib/orders/create-draft.ts` line 28

`createDraftOrder` rejects a closed season; `finalizeOrder` does not. A draft created while the season was open can be finalized after the season is closed (UR-008's open/closed gate is "all selling" — finalization is arguably selling). Borderline business rule, but the asymmetry is a gap against EXPECTED item 1's open/closed gate.

### m6. No constraint enforcing a single OPEN season
**File:** `arms/arm-06/workspace/prisma/schema.prisma` (`Season` model, lines 175–188); `arms/arm-06/workspace/lib/seasons.ts` (`getOpenSeason`)

Two rows with `status = "OPEN"` can coexist (no partial unique index on `status WHERE status = 'OPEN'`). `getOpenSeason` returns `orderBy: createdAt desc → first`, so the older open season silently stops receiving orders. EXPECTED item 1 implies a single open season gates selling; the schema does not enforce it.

### m7. `OrderLine` has no integrity constraint between `productId`, `addOnId`, and `parentLineId`
**File:** `arms/arm-06/workspace/prisma/schema.prisma` (`OrderLine` model, lines 319–338)

A line can have both `productId` and `addOnId` set, or neither, and an add-on line is not required to have a `parentLineId`. The `InventoryItem` XOR is enforced via CHECK; `OrderLine` has no equivalent. Engine-only today, but the schema will not catch a bad writer later.

### m8. `Package.recipientAddressId` uses `ON DELETE SET NULL`, leaving `groupingKey` stale
**File:** `arms/arm-06/workspace/prisma/schema.prisma` (`Package` model, lines 342–362; FK on line 468 of the migration)

`groupingKey` is built from `recipientAddressId` (among other fields). If the address is deleted, the FK nulls `recipientAddressId` but `groupingKey` keeps the old address id baked in, so any future regrouping via `buildGroupingKey` would produce a different key for the same package. Stored grouping key and recomputed key diverge silently.

### m9. `StripePaymentIntent.clientSecret` and `raw` webhook payload stored in plaintext
**File:** `arms/arm-06/workspace/prisma/schema.prisma` (`StripePaymentIntent` model, lines 414–428)

`clientSecret` is a sensitive payment credential and `raw` is the full webhook payload (may carry PII/card-brand data). Both are stored as plaintext columns. Schema-only this phase (no Stripe integration code ships in P2), but the schema design bakes in plaintext storage that later phases will inherit. Note for the migration, not a live leak.

### m10. `FulfillmentMethod.stages` is unvalidated `Json`
**File:** `arms/arm-06/workspace/prisma/schema.prisma` (`FulfillmentMethod.stages`, line 370); `arms/arm-06/workspace/lib/packages/stages.ts` (`canAdvanceStage`, lines 21–29)

`stages` is `Json` with no check that it is a non-empty array of valid `PackageStage` values. `canAdvanceStage` uses `indexOf`, so an invalid `to` is rejected, but an empty `stages` array makes every advance throw `IllegalStageTransitionError` for a method that should be usable. A bad seed/admin write bricks fulfillment for that method with no clear error.

---

## Out of scope (noted, not scored)

- The P1 auth/session/impersonation/audit layer is unchanged in P2 and was reviewed under P1; the P1 findings (constant-time compare, session expiry, invite TTL, impersonation rank, audit attribution, `x-forwarded-for` sanitization, `AUTH_SECRET` length, `/api/health` disclosure, `/api/client-error` rate limiting) are all resolved in the current tree. Re-scoring them is out of scope.
- No new P2 API routes exist, so there is no IDOR, CSRF, or injection surface on new endpoints to assess. When checkout/admin routes are wired to `createDraftOrder`, `postPayment`, `reserveStock`, and `advancePackageStage` in later phases, each must apply `requireApiPermission` and pass server-validated inputs (see M3/M4).
- BOM/ingredient/assembly-batch tables are schema-only by design (UR-016 hidden at launch) and carry no security-relevant logic this phase.
- `/api/client-error` rate limiter is per-process in-memory (`recentHits` array) — a single abuser can starve the global 30/min budget and a restart resets the window. This was noted in P1 and is no worse in P2; leaving as a hygiene note rather than a new finding.
