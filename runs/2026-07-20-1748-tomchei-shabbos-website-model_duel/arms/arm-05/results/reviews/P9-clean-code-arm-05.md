# P9 Clean-code Review — arm-05

**Phase:** P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Reviewer specialist:** Clean-code (blind — no model names)
**Scope:** `arms/arm-05/workspace/` P9 deliverables only. Findings, no fixes.

## Summary counts

| Severity | Count |
|---|---|
| Medium | 6 |
| Low | 10 |
| **Total** | **16** |

## Findings

### 1. God file — `lib/delivery.ts` mixes 7+ concerns in 456 lines
- **Severity:** medium
- **Location:** `lib/delivery.ts:1-456`
- **Claim:** Single file mixes route CRUD, driver magic-link auth/PIN throttling, geocode caching, method switch + reroute, pickup lifecycle, bulk delivery scheduling, and payment-reminder cron logic. The clean-code rule says split when >500 lines, mixed concerns, or a refactor command. The file is at 456 lines with at least seven distinct concerns; the next P9 touch will push it over 500.
- **Evidence:** `hashSecret`/`timingSafeMatches` (auth, lines 25-33), `geocodeAddress`/`fixtureCoordinates`/`isWithinHalfMile` (geo, lines 43-93), `createRoute`/`listRoutes`/`reassignRoute`/`routePdf` (route CRUD, 147-229), `loadDriverLink`/`readDriverRoute`/`startDriverRoute`/`deliverDriverStop` (driver, 118-290), `switchPackageMethod`/`nearbyShippingPackages`/`confirmReroute` (reroute, 292-363), `scheduleBulkDelivery` (bulk, 365-383), `pickupEligibility`/`markPickupReady`/`pickupDoorList`/`stampPickedUp`/`expirePickupPackages` (pickup, 385-440), `sendPaymentReminders` (cron, 442-455).

### 2. Duplicated `geocodeCache` upsert with divergent TTLs across files
- **Severity:** medium
- **Location:** `lib/delivery.ts:62-77` vs `lib/order-builder.ts:187-197`
- **Claim:** Two separate upsert implementations against the same `GeocodeCache` table, with different TTLs and providers, no shared helper. Rule of 2 met — two real call sites now. Schema/type drift risk: delivery uses a 30-day TTL with `"fixture"` provider; order-builder uses a 90-day TTL with `"postal-centroid"` provider. Same cache, two expiry policies.
- **Evidence:** `lib/delivery.ts:69` and `:75` — `expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)`. `lib/order-builder.ts:194` and `:196` — `expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)`.

### 3. `switchPackageMethod` audit records a string where cents are promised
- **Severity:** medium
- **Location:** `lib/delivery.ts:314-320`
- **Claim:** UR-002 requires "charge preserved + who/when audit." The audit field `preservedCustomerChargeCents` is set to the literal string `"checkout_snapshot_unchanged"` (or `null`), never the actual preserved amount. The field name promises a number; the value is a label. Verification of charge preservation requires joining to the order instead of reading the audit row.
- **Evidence:** Line 318: `preservedCustomerChargeCents: packageRecord.orderId ? "checkout_snapshot_unchanged" : null`. `lib/shipping.ts:checkoutChargeForPackage` (42-66) already extracts the real cents value and is reusable here.

### 4. `confirmReroute` re-scans all shipping packages then re-validates inside `switchPackageMethod` — TOCTOU + redundant work
- **Severity:** medium
- **Location:** `lib/delivery.ts:351-363`
- **Claim:** `confirmReroute` calls `nearbyShippingPackages(routeId)` (which scans every shipping package and geocodes them) to validate one package is eligible, then calls `switchPackageMethod` which independently re-fetches the same package and re-checks `status === "SENT"`. The nearby scan is O(all shipping packages) just to validate one ID, and the two-step creates a time-of-check/time-of-use window between the eligibility scan and the method switch.
- **Evidence:** Line 352 `await nearbyShippingPackages(routeId)`, line 353 membership check, line 356 `await switchPackageMethod(packageId, "DELIVERY", actorId)` re-fetches at lines 293-301 and re-validates at 297.

### 5. Admin delivery page requires staff to paste raw package CUIDs — pattern drift vs every other admin screen
- **Severity:** medium
- **Location:** `app/admin/delivery/page.tsx:44, 63-65`
- **Claim:** The "Build a route" form asks staff to type comma-separated package CUIDs into a textarea. Every other admin screen in the workspace uses clickable rows from a list (operations page lines 89-97, packages page). The delivery UI is the only one that demands staff know internal IDs. UI consistency rule: "New screens must reuse existing header, theme, and navigation patterns." No package picker, no list of eligible delivery packages.
- **Evidence:** Line 44 `packageIds: packageIds.split(",").map((id) => id.trim()).filter(Boolean)`; line 63 label `"Local-delivery package IDs, separated by commas"`. Compare `app/admin/operations/page.tsx:89-97` where orders are clickable rows.

### 6. `expirePickupPackages` writes "expired" audits but never marks the package expired; `skipDuplicates` is a no-op
- **Severity:** medium
- **Location:** `lib/delivery.ts:433-440`
- **Claim:** The cron writes `packageAudit` rows with `action: "pickup.expired"` but never updates `Package.status`. The packages stay in their pre-expiry status; the door list only filters them out via `pickupExpiresAt > now` (line 418), so the package board still shows them as ready. The audit says "expired" but the package state doesn't reflect it. Also `packageAudit.createMany({ skipDuplicates: true })` is misleading — `PackageAudit` has no unique constraint (schema 475-486), so `skipDuplicates` only de-duplicates generated IDs (never happens); it's dead-flag-adjacent.
- **Evidence:** Lines 434-438: `findMany` for overdue, `createMany` audits, return count — no `prisma.package.update`. `PackageAudit` schema (475-486) has no `@@unique`; `skipDuplicates: true` at line 437 is a no-op for this model.

### 7. `MAGIC_LINK_TTL_MS` named constant has a single call site — Rule of 2 borderline
- **Severity:** low
- **Location:** `lib/delivery.ts:8, 180`
- **Claim:** `MAGIC_LINK_TTL_MS` is defined once and used once. Rule of 2 says "needs 2+ real call sites right now." The 30-day geocode TTL (lines 69, 75) is the one that's actually duplicated inline — that's the value that should be named.
- **Evidence:** Line 8 `const MAGIC_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1_000;` used only at line 180. Lines 69 and 75 repeat `30 * 24 * 60 * 60 * 1_000` inline with no named constant.

### 8. Duplicated `fulfillmentMethod.upsert` pattern with minor variations
- **Severity:** low
- **Location:** `lib/delivery.ts:110-116, 302-304`; `scripts/smoke-p9.ts:13-17`
- **Claim:** The same `fulfillmentMethod.upsert({ where: { code }, create: { code, name }, update: { name } })` pattern repeats 3+ times with only the code/name varying. Rule of 2 met. The smoke script already generalizes it; the lib does not.
- **Evidence:** `lib/delivery.ts:111-115` (DELIVERY/"Local delivery"), `lib/delivery.ts:302-304` (SHIP/"Ship" inline), `scripts/smoke-p9.ts:13-17` (parametric upsert in fixture helper).

### 9. `deliveryMethod()` helper name is a noun, not a verb
- **Severity:** low
- **Location:** `lib/delivery.ts:110-116`
- **Claim:** Function names should describe what they DO. `deliveryMethod` reads as a noun (the method) not a verb; a caller can't tell from `await deliveryMethod()` whether it's a getter, a creator, or a constant. The function actually upserts the DELIVERY fulfillment method record.
- **Evidence:** `async function deliveryMethod() { return prisma.fulfillmentMethod.upsert({ where: { code: "DELIVERY" }, ... }); }` called at line 303. Compare the inline SHIP equivalent at line 304 which is anonymous. Better name: `ensureDeliveryMethod` or `upsertDeliveryMethod`.

### 10. `geocodeAddress` always writes to the address row even when nothing changed
- **Severity:** low
- **Location:** `lib/delivery.ts:51-84`
- **Claim:** When the address already has stored `latitude`/`longitude`, the function returns early with `provider: "stored"` (lines 52-54) but control still falls through to `prisma.address.update` (lines 79-82), writing the same coordinates back and bumping `updatedAt`. Anti-AI-tic: "No 'just in case' code -- every line must have a reason."
- **Evidence:** Lines 52-54 short-circuit return for stored coords; lines 79-82 unconditionally `address.update` with the same values. The stored-coords branch should skip the update.

### 11. `nearbyShippingPackages` re-geocodes route stops on every call
- **Severity:** low
- **Location:** `lib/delivery.ts:326-348`
- **Claim:** `createRoute` already geocoded and persisted stop coordinates, but `nearbyShippingPackages` re-geocodes all route stops on every suggest call (line 332). Combined with finding 10, each suggest call re-writes N address rows for the route's own stops.
- **Evidence:** Line 332 `await Promise.all(routeAddresses.map((address) => geocodeAddress(address)))`. `geocodeAddress` issues an `address.update` per stop (lines 79-82) even for stored coordinates.

### 12. Inconsistent audit table split — `PackageAudit` vs `AuditEvent` — undocumented
- **Severity:** low
- **Location:** `lib/delivery.ts` (multiple); `prisma/schema.prisma:110-118, 475-486`
- **Claim:** P9 writes package-scoped audits to `PackageAudit` and route-scoped audits to `AuditEvent`. The two tables share the same column shape (id, actorId, action, details, createdAt). Whether this is "one pattern per concern" or "two competing audit patterns" is not documented in the README. Flagging as pattern-drift candidate worth a Rule Preference entry.
- **Evidence:** `packageAudit.create` in `deliverDriverStop` (278), `markPickupReady` (413), `stampPickedUp` (429), `expirePickupPackages` (435). `auditEvent.create` in `createRoute` (186), `reassignRoute` (206), `confirmReroute` (360). Schema models at 110-118 and 475-486 are near-identical.

### 13. Admin delivery page duplicates the initial fetch in `useEffect` and `load()`
- **Severity:** low
- **Location:** `app/admin/delivery/page.tsx:20-37`
- **Claim:** `load()` (20-25) fetches `/api/admin/delivery`, then a separate `useEffect` (27-37) re-implements the same fetch inline with a `cancelled` flag and different error handling. Two code paths for the initial load; the effect ignores `load()` entirely.
- **Evidence:** `load()` at 20-25 uses `setMessage` on error with no abort. `useEffect` at 27-37 re-implements the fetch with a `cancelled` flag and `setMessage` on error. Different error semantics, duplicated logic.

### 14. Driver page `request` helper has two equivalent branches and a redundant ternary
- **Severity:** low
- **Location:** `app/driver/[token]/page.tsx:18-33`
- **Claim:** `if (action?.action === "deliver") return load();` and `if (action?.action === "start") return load();` both return the same `load()` — they collapse to one `if (action) return load();` after the POST. Minor readability issue, not a bug.
- **Evidence:** Lines 29-30: two consecutive `if` statements with identical bodies.

### 15. Driver page initial message contradicts the optional-PIN design
- **Severity:** low
- **Location:** `app/driver/[token]/page.tsx:16, 43, 47`
- **Claim:** Initial state `message` says "Enter the optional route PIN to load stops." but the PIN is optional (UR-015) and the label says "Route PIN (if provided)". The message implies the PIN is required to proceed, contradicting the optional-PIN design.
- **Evidence:** Line 16 `useState("Enter the optional route PIN to load stops.")` vs line 43 label `"Route PIN (if provided)"` and line 47 button "Open stops".

### 16. `sendPaymentReminders` filters `deliveryDate <= now` — reminders fire after the delivery window
- **Severity:** low
- **Location:** `lib/delivery.ts:442-455`
- **Claim:** The cron selects schedules where `deliveryDate { lte: new Date() }` and `paymentStatus: "PENDING"`. For a payment reminder you'd expect upcoming deliveries (`deliveryDate >= now`) so reminders fire before the window, not after. The smoke test (smoke-p9.ts:107) creates a schedule with `new Date(Date.now() - 60_000)` (past) to exercise the path, which only works because the filter is backwards. Functional but semantically odd; flagging for product clarification.
- **Evidence:** Line 444 `where: { deliveryDate: { lte: new Date() }, order: { paymentStatus: "PENDING" } }`. `scripts/smoke-p9.ts:107` schedules with `new Date(Date.now() - 60_000)` to satisfy the filter.

## Scope note

Findings limited to P9 deliverables (delivery routes, driver magic links, reroute, pickup, bulk scheduling, payment-reminder cron). Files outside P9 (e.g., `lib/order-builder.ts`, `lib/shipping.ts`, `lib/package-operations.ts`, `lib/print-batches.ts`) are cited only where P9 code duplicates or depends on them.
